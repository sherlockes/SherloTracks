import numpy as np
import pandas as pd
from typing import List, Dict, Any
from shapely.geometry import LineString, Point
from sklearn.cluster import DBSCAN
from pydantic import BaseModel

class SegmentRequestV2(BaseModel):
    activity_ids: List[str]
    min_lat: float
    min_lon: float
    max_lat: float
    max_lon: float
    # Parámetros en metros reales para el Método II
    resample_dist_m: float = 5.0
    cluster_dist_m: float = 8.0
    cluster_angle_deg: float = 15.0
    endpoint_snap_m: float = 10.0
    min_length_m: float = 20.0
    simplify_m: float = 0.5

class SegmentEngineV2:
    """
    Motor de Extracción Topológica de Nueva Generación (Método II)
    Calcula redes limpias 'tipo LEGO' a partir de tracks ruidosos 100% en sistema métrico.
    """

    @staticmethod
    def resample_track(coords_metric: np.ndarray, interval_m: float = 5.0) -> List[Point]:
        """
        Fase 3: Re-muestrea el track a intervalos métricos regulares exactos.
        Evita sesgos de densidad de muestreo de dispositivos de alta frecuencia.
        """
        line = LineString(coords_metric)
        length = line.length
        if length < interval_m:
            return [Point(coords_metric[0]), Point(coords_metric[-1])]
        
        num_points = int(np.floor(length / interval_m))
        resampled = [
            line.interpolate(i * interval_m) 
            for i in range(num_points + 1)
        ]
        return resampled

    @staticmethod
    def create_microsegments(resampled_points: List[Point], track_id: str) -> List[Dict[str, Any]]:
        """
        Fase 4: Construye pequeños vectores direccionales con cálculo de Azimuth canónico modulo PI
        para unificar idas y vueltas como el mismo camino físico.
        """
        micro_segments = []
        for i in range(len(resampled_points) - 1):
            p1, p2 = resampled_points[i], resampled_points[i+1]
            dx = p2.x - p1.x
            dy = p2.y - p1.y
            azimuth = np.arctan2(dx, dy)
            
            # Normalización a [0, PI) para ignorar el sentido temporal
            dir_canonical = azimuth % np.pi 
            
            midpoint = Point((p1.x + p2.x) / 2, (p1.y + p2.y) / 2)
            micro_segments.append({
                'geom': LineString([p1, p2]),
                'midpoint': midpoint,
                'dir_canonical': dir_canonical,
                'track_id': track_id,
                'length': Point(p1).distance(Point(p2))
            })
        return micro_segments

    @staticmethod
    def cluster_microsegments(micro_segments: List[Dict[str, Any]], eps_m: float = 8.0) -> np.ndarray:
        """
        Fase 6: Ejecuta DBSCAN combinando proximidad espacial euclídea 2D.
        Agrupa trazas paralelas que pertenecen al mismo corredor.
        """
        if not micro_segments:
            return np.array([])
            
        coords = np.array([[s['midpoint'].x, s['midpoint'].y] for s in micro_segments])
        
        # DBSCAN métrico sobre coordenadas UTM proyectadas
        db = DBSCAN(eps=eps_m, min_samples=1, metric='euclidean')
        labels = db.fit_predict(coords)
        
        return labels

    @staticmethod
    def calculate_robust_centerline(cluster_segments: List[Dict[str, Any]], bin_size_m: float = 5.0) -> LineString:
        """
        Fase 7: Genera la línea central representativa robusta ante outliers.
        Usa división longitudinal y la MEDIANA de la desviación transversal para aplanar
        el ruido y saltos fortuitos de GPS.
        """
        all_coords = []
        for seg in cluster_segments:
            all_coords.extend(list(seg['geom'].coords))
            
        df = pd.DataFrame(all_coords, columns=['x', 'y'])
        
        # Simplificación para el esqueleto: asumimos avance principal en X.
        # En implementación final, se rota la nube de puntos mediante PCA sobre el eje principal.
        x_min, x_max = df['x'].min(), df['x'].max()
        x_bins = np.arange(x_min, x_max, bin_size_m)
        
        center_coords = []
        for i in range(len(x_bins) - 1):
            subset = df[(df['x'] >= x_bins[i]) & (df['x'] < x_bins[i+1])]
            if not subset.empty:
                median_y = subset['y'].median()
                center_coords.append(( (x_bins[i] + x_bins[i+1])/2, median_y ))
                
        if len(center_coords) < 2:
            # Fallback simple si hay pocos datos
            return LineString([all_coords[0], all_coords[-1]])
            
        return LineString(center_coords)
        
    def process_network_v2(self, request: SegmentRequestV2, db_session) -> Dict[str, Any]:
        """
        Lanzador principal del flujo del Método II.
        Orquesta la extracción híbrida:
        1. Carga de tracks proyectados (SQL).
        2. Re-muestreo y Micro-segmentación espacial (Python).
        3. Clustering direccional y Líneas centrales robustas (Python ML).
        4. Noding topológico final y consolidación (SQL).
        """
        from sqlalchemy import func, text
        from geoalchemy2.shape import to_shape
        import json
        from shapely import wkt
        from shapely.geometry import MultiLineString
        import hashlib
        from models import Activity
        
        # 1. Consultar tracks que intersecan el BBOX, transformados a métrico (SRID 3857 - Web Mercator)
        bbox_wkt = f"POLYGON(({request.min_lon} {request.min_lat}, {request.max_lon} {request.min_lat}, {request.max_lon} {request.max_lat}, {request.min_lon} {request.max_lat}, {request.min_lon} {request.min_lat}))"
        
        results = db_session.query(
            Activity.id,
            func.ST_AsText(func.ST_Transform(Activity.geom, 3857)).label("geom_wkt")
        ).filter(
            Activity.id.in_(request.activity_ids),
            func.ST_Intersects(Activity.geom, func.ST_GeomFromText(bbox_wkt, 4326))
        ).all()
        
        if not results:
            return {"type": "FeatureCollection", "features": []}
            
        # 2. Generación de Micro-segmentos re-muestreados en Python
        all_micro_segments = []
        for row in results:
            if not row.geom_wkt:
                continue
            try:
                shapely_geom = wkt.loads(row.geom_wkt)
                if shapely_geom.is_empty:
                    continue
                
                # Extraemos coordenadas métricas del track
                coords = np.array(shapely_geom.coords)
                
                # Fase 3: Re-muestrear uniformemente cada N metros (elimina sesgos de tasa de muestreo)
                points = self.resample_track(coords, interval_m=request.resample_dist_m)
                
                # Fase 4: Construir los micro-vectores con azimuth normalizado mod PI
                segments = self.create_microsegments(points, track_id=row.id)
                all_micro_segments.extend(segments)
            except Exception as e:
                print(f"[SegmentEngineV2] Error pre-procesando track {row.id}: {e}")
                
        if not all_micro_segments:
            return {"type": "FeatureCollection", "features": []}
            
        # 3. DESPLAZAMIENTO MEDIANO TRANSVERSAL LOCAL (Fase 6 y 7 Fusionadas)
        # En lugar de un clustering DBSCAN global rígido o un esqueleto ingenuo, 
        # desplazamos vectorialmente cada micro-segmento a la MEDIANA TRANSVERSAL
        # de sus trazas vecinas paralelas. Soporta trazados sinuosos y cualquier orientación.
        from scipy.spatial import cKDTree
        
        try:
            # Extraemos puntos medios y direcciones para optimizar cálculos métricos
            midpoints = np.array([[m['midpoint'].x, m['midpoint'].y] for m in all_micro_segments])
            dirs = np.array([m['dir_canonical'] for m in all_micro_segments])
            
            # Árbol KD para búsquedas de vecinos espaciales en microsegundos
            tree = cKDTree(midpoints)
            
            shifted_lines = []
            angle_tol_rad = np.radians(request.cluster_angle_deg)
            
            for i, seg in enumerate(all_micro_segments):
                geom = seg['geom']
                coords = list(geom.coords)
                if len(coords) < 2:
                    continue
                    
                p1, p2 = np.array(coords[0]), np.array(coords[1])
                vec = p2 - p1
                length = np.linalg.norm(vec)
                
                if length < 0.01:
                    continue
                
                # Base ortogonal local: unit_t (tangente) y unit_n (normal perpendicular)
                unit_t = vec / length
                unit_n = np.array([-unit_t[1], unit_t[0]])
                mid = np.array([seg['midpoint'].x, seg['midpoint'].y])
                
                # Búsqueda de vecinos en el radio "Imán de Fusión"
                idx = tree.query_ball_point(mid, request.cluster_dist_m)
                
                if not idx or len(idx) <= 1:
                    # Sin vecinos cercanos: se conserva inalterado
                    shifted_lines.append(geom)
                    continue
                
                # Filtrar por paralelismo canónico (evita colapsar cruces perpendiculares)
                neighbor_dirs = dirs[idx]
                diffs = np.abs(neighbor_dirs - seg['dir_canonical'])
                cyclic_diffs = np.minimum(diffs, np.pi - diffs)
                
                valid_mask = cyclic_diffs <= angle_tol_rad
                valid_idx = np.array(idx)[valid_mask]
                
                if len(valid_idx) <= 1:
                    shifted_lines.append(geom)
                    continue
                
                # Proyectar vecinos sobre nuestra normal para calcular la distancia lateral
                valid_mids = midpoints[valid_idx]
                d_vecs = valid_mids - mid
                lateral_offsets = d_vecs.dot(unit_n)
                
                # Aplicamos la Mediana Transversal: anula matemáticamente el ruido errático
                median_offset = np.median(lateral_offsets)
                
                # Traslación lateral rígida del micro-segmento al flujo central
                p1_shifted = p1 + median_offset * unit_n
                p2_shifted = p2 + median_offset * unit_n
                
                shifted_lines.append(LineString([p1_shifted, p2_shifted]))
            
            centerlines = shifted_lines
            
        except Exception as e:
            print(f"[SegmentEngineV2] Fallo en Median Shift, usando fallback: {e}")
            centerlines = [s['geom'] for s in all_micro_segments]
            
        if not centerlines:
            return {"type": "FeatureCollection", "features": []}
            
        # 5. Noding y Fusión Topológica (Fases 8 y 9) ejecutados eficientemente en PostGIS
        mls = MultiLineString(centerlines)
        mls_wkt = mls.wkt
        
        sql_topology = text("""
            WITH raw_lines AS (
                SELECT ST_GeomFromText(:mls_wkt, 3857) as geom
            ),
            precision_grid AS (
                -- Forzamos rejilla métrica de 0.05 metros para erradicar imprecisiones de coma flotante
                SELECT ST_ReducePrecision(geom, 0.05) as geom FROM raw_lines
            ),
            noded_network AS (
                -- Rompemos físicamente los cruces detectados compartiendo nodos
                SELECT (ST_Dump(ST_Node(ST_UnaryUnion(geom)))).geom as geom_m
                FROM precision_grid
            ),
            merged_network AS (
                -- Cosemos tramos continuos consecutivos de grado 2
                SELECT (ST_Dump(ST_LineMerge(ST_Collect(geom_m)))).geom as geom_m
                FROM noded_network
            ),
            simplified_final AS (
                -- Simplificación física conservando la topología (Douglas-Peucker en metros)
                SELECT ST_SimplifyPreserveTopology(geom_m, :simplify_m) as geom_m
                FROM merged_network
            ),
            filtered_final AS (
                -- Eliminamos espuelas cortas de baja confianza
                SELECT geom_m 
                FROM simplified_final
                WHERE ST_Length(geom_m) >= :min_length_m
            )
            SELECT 
                ST_AsGeoJSON(ST_Transform(geom_m, 4326)) as geojson_4326,
                ST_Length(geom_m) as len_m
            FROM filtered_final
            WHERE geom_m IS NOT NULL
        """)
        
        try:
            topo_results = db_session.execute(sql_topology, {
                "mls_wkt": mls_wkt,
                "simplify_m": request.simplify_m,
                "min_length_m": request.min_length_m
            }).fetchall()
        except Exception as e:
            print(f"[SegmentEngineV2] Error en postgis noding: {e}")
            return {"type": "FeatureCollection", "features": []}
            
        # 6. Formatear los resultados finales en un FeatureCollection GeoJSON estable para Leaflet
        features = []
        for r in topo_results:
            geojson_str = r[0]
            geom_json = json.loads(geojson_str)
            length_m = r[1]
            
            # Generamos un Hash MD5 de la geometría 4326 para garantizar IDs persistentes ante zoom/panning
            geom_hash = hashlib.md5(geojson_str.encode('utf-8')).hexdigest()[:16]
            seg_id = f"seg_v2_{geom_hash}"
            
            features.append({
                "id": seg_id,
                "type": "Feature",
                "geometry": geom_json,
                "properties": {
                    "id": seg_id,
                    "length_m": round(length_m, 1),
                    "length": length_m / 111319.9 # Conversión retrocompatible a grados aproximada (1 grado ~= 111.3km)
                }
            })
            
        return {
            "type": "FeatureCollection",
            "features": features
        }
