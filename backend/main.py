from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List
import os
import time
import hashlib
import requests
from database import SessionLocal, engine
import models, strava_utils
from dotenv import load_dotenv
from segment_engine_v2 import SegmentRequestV2

load_dotenv()

from sqlalchemy import text

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="SherloTracks API")

@app.on_event("startup")
def migrate_db():
    db = SessionLocal()
    try:
        db.execute(text("ALTER TABLE activities ADD COLUMN IF NOT EXISTS type VARCHAR;"))
        db.execute(text("ALTER TABLE activities ADD COLUMN IF NOT EXISTS moving_time INTEGER;"))
        db.execute(text("ALTER TABLE activities ADD COLUMN IF NOT EXISTS average_speed FLOAT;"))
        db.execute(text("ALTER TABLE activities ADD COLUMN IF NOT EXISTS max_speed FLOAT;"))
        
        # Creamos la función para snapping iterativo secuencial.
        # Esto previene OOM al no materializar los pasos intermedios en un CTE recursivo.
        db.execute(text("""
            CREATE OR REPLACE FUNCTION snap_and_union_sequential(geoms geometry[], snap_tolerance double precision)
            RETURNS geometry AS $$
            DECLARE
                cum_union geometry;
                g geometry;
            BEGIN
                IF geoms IS NULL OR array_length(geoms, 1) IS NULL OR array_length(geoms, 1) = 0 THEN
                    RETURN NULL;
                END IF;
                
                FOR i IN 1 .. array_length(geoms, 1) LOOP
                    g := geoms[i];
                    IF g IS NOT NULL THEN
                        IF cum_union IS NULL THEN
                            cum_union := g;
                        ELSE
                            -- 1. Snapping unidireccional extremadamente eficiente (O(N) lineal) para absorber 
                            --    los tracks masivos sin esfuerzo computacional.
                            -- 2. ST_SnapToGrid(..., 0.0000001): Resolvemos el 'Error de Precisión de GEOS' 
                            --    alineando todo a una rejilla invisible de 1 centímetro. Esto fuerza a que 
                            --    los vértices coincidan EXACTAMENTE a nivel binario y ST_UnaryUnion solde
                            --    los cruces y tramos paralelos perfectamente.
                            cum_union := ST_UnaryUnion(
                                ST_SnapToGrid(
                                    ST_Collect(cum_union, ST_Snap(g, cum_union, snap_tolerance)),
                                    0.0000001
                                )
                            );
                        END IF;
                    END IF;
                END LOOP;
                
                RETURN cum_union;
            END;
            $$ LANGUAGE plpgsql IMMUTABLE;
        """))
        
        db.commit()
    except Exception as e:
        print(f"Migration info: {e}")
    finally:
        db.close()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_strava_client_info():
    return {
        "id": os.getenv("STRAVA_CLIENT_ID"),
        "secret": os.getenv("STRAVA_CLIENT_SECRET"),
        "redirect": os.getenv("STRAVA_REDIRECT_URI")
    }

@app.get("/auth/login")
def login():
    info = get_strava_client_info()
    scope = "read,activity:read_all"
    url = f"https://www.strava.com/oauth/authorize?client_id={info['id']}&redirect_uri={info['redirect']}&response_type=code&scope={scope}"
    return RedirectResponse(url)

@app.get("/auth/callback")
def callback(code: str, db: Session = Depends(get_db)):
    info = get_strava_client_info()
    response = requests.post(
        "https://www.strava.com/oauth/token",
        data={
            "client_id": info["id"],
            "client_secret": info["secret"],
            "code": code,
            "grant_type": "authorization_code"
        }
    )
    data = response.json()
    
    # Persistir tokens
    token_record = db.query(models.StravaToken).first()
    if not token_record:
        token_record = models.StravaToken()
    
    token_record.access_token = data["access_token"]
    token_record.refresh_token = data["refresh_token"]
    token_record.expires_at = data["expires_at"]
    
    db.add(token_record)
    db.commit()
    
    return RedirectResponse("/")

@app.get("/activities/sync")
def sync_activities(db: Session = Depends(get_db), full: bool = False):
    token = db.query(models.StravaToken).first()
    if not token:
        raise HTTPException(status_code=401, detail="No token found. Please login.")
    
    if time.time() > token.expires_at - 300:
        info = get_strava_client_info()
        new_data = strava_utils.refresh_strava_token(info["id"], info["secret"], token.refresh_token)
        token.access_token = new_data["access_token"]
        token.refresh_token = new_data["refresh_token"]
        token.expires_at = new_data["expires_at"]
        db.commit()

    new_count = 0
    page = 1
    per_page = 100
    
    print(f"DEBUG: Iniciando sync. Full={full}")
    
    while True:
        print(f"DEBUG: Solicitando página {page}...")
        headers = {"Authorization": f"Bearer {token.access_token}"}
        resp = requests.get(f"https://www.strava.com/api/v3/athlete/activities?per_page={per_page}&page={page}", headers=headers)
        activities_data = resp.json()
        
        if not isinstance(activities_data, list):
            print(f"DEBUG: Error en respuesta de Strava: {activities_data}")
            break

        if not activities_data or len(activities_data) == 0:
            print("DEBUG: No hay más actividades en Strava.")
            break

        print(f"DEBUG: Recibidas {len(activities_data)} actividades de Strava.")
        page_new = 0
        for act in activities_data:
            existing = db.query(models.Activity).filter(models.Activity.id == str(act["id"])).first()
            if existing:
                if not existing.type:
                    existing.type = act.get("type")
                if not existing.moving_time:
                    existing.moving_time = act.get("moving_time", 0)
                if existing.average_speed is None or existing.average_speed == 0:
                    existing.average_speed = act.get("average_speed", 0)
                if existing.max_speed is None or existing.max_speed == 0:
                    existing.max_speed = act.get("max_speed", 0)
                continue
            
            poly = act.get("map", {}).get("summary_polyline")
            if not poly: 
                print(f"DEBUG: Actividad {act['id']} sin mapa (saltada).")
                continue
            
            geom = strava_utils.decode_polyline(poly)
            if not geom: continue

            db_activity = models.Activity(
                id=str(act["id"]),
                name=act["name"],
                type=act.get("type"),
                distance=act["distance"],
                moving_time=act.get("moving_time", 0),
                average_speed=act.get("average_speed", 0),
                max_speed=act.get("max_speed", 0),
                total_elevation_gain=act.get("total_elevation_gain", 0),
                start_date=act["start_date"],
                geom=geom
            )
            db.add(db_activity)
            new_count += 1
            page_new += 1
        
        db.commit()
        print(f"DEBUG: Página {page} procesada. Nuevas en esta página: {page_new}")
        
        # Si no es un sync completo y no encontramos nada nuevo en esta página, paramos
        if not full and page_new == 0:
             print("DEBUG: Sync normal finalizado (no hay más novedades).")
             break
        
        if len(activities_data) < per_page:
            print("DEBUG: Fin del histórico (última página recibida).")
            break
            
        page += 1
        time.sleep(0.5)

    print(f"DEBUG: Sync finalizado. Total nuevas: {new_count}")
    return {"status": "synced", "count": new_count}

@app.get("/activities")
def get_activities(db: Session = Depends(get_db)):
    from sqlalchemy import func
    import json
    
    results = db.query(
        models.Activity.id,
        models.Activity.name,
        models.Activity.type,
        models.Activity.distance,
        models.Activity.moving_time,
        models.Activity.average_speed,
        models.Activity.max_speed,
        models.Activity.total_elevation_gain,
        models.Activity.start_date,
        func.ST_AsGeoJSON(models.Activity.geom).label("geojson")
    ).order_by(models.Activity.start_date.desc()).all()
    
    activities = []
    for r in results:
        geojson = json.loads(r.geojson) if r.geojson else {"coordinates": []}
        activities.append({
            "id": r.id,
            "name": r.name,
            "type": r.type,
            "distance": r.distance,
            "moving_time": r.moving_time,
            "average_speed": r.average_speed,
            "max_speed": r.max_speed,
            "total_elevation_gain": r.total_elevation_gain,
            "start_date": r.start_date,
            "points": geojson["coordinates"]
        })
    return activities

class SegmentRequest(BaseModel):
    min_lat: float
    min_lon: float
    max_lat: float
    max_lon: float
    activity_ids: List[str]
    simplify_tolerance: float = 0.0001
    snap_tolerance: float = 0.0002
    min_length: float = 0.0001
    intersection_tolerance: float = 0.0002

@app.post("/activities/segments")
def get_segments(
    req: SegmentRequest,
    db: Session = Depends(get_db)
):
    from sqlalchemy import text
    import json
    
    # Logger de emergencia persistente a disco (visible vía SFTP)
    try:
        with open("debug_log.txt", "a") as f:
            f.write(f"REQ: Simpl={req.simplify_tolerance}, Snap={req.snap_tolerance}, MinLen={req.min_length}, Intersect={req.intersection_tolerance}\n")
    except:
        pass
        
    if not req.activity_ids:
        return {
            "type": "FeatureCollection",
            "features": []
        }
    
    # Definimos la tolerancia. 
    # 0.00015 grados equivale aproximadamente a 16 metros.
    # Esto es suficiente para absorber el ruido del GPS en un mismo camino sin fusionar calles paralelas.
    tolerance = 0.00015
    
    # Consulta PostGIS:
    # 1. Filtramos actividades por bbox y enviadas.
    # 2. ST_Snap(geom, colección): Al hacer esto ANTES de simplificar, usamos la enorme densidad de puntos del GPS original
    #    para que los tracks paralelos se moldeen y peguen perfectamente unos a otros (como velcro) sin inventar puntos.
    # 3. Simplificamos (ST_Simplify) las líneas ya pegadas para limpiar el ruido y dejar segmentos rectos limpios.
    # 4. ST_UnaryUnion para fusionar las líneas solapadas y crear los nodos verdaderos en los cruces.
    # 5. ST_LineMerge para coser segmentos consecutivos.
    # 6. ST_Dump para extraer geometrías independientes.
    # 7. Filtramos por longitud mínima y bbox.
    
    sql = text("""
        WITH bbox AS (
            SELECT ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326) as geom
        ),
        intersected_geom AS (
            -- Recortamos las trazas exactamente al rectángulo de la vista.
            -- Al 'guillotinar' las rutas al borde de la pantalla, forzamos a que todas las líneas paralelas 
            -- que salgan del mapa tengan extremos artificiales a ras de borde (separados por centímetros).
            -- Esto desencadena el poder total de nuestro motor de clustering final, obligándolo a 
            -- fusionar tramos paralelos infinitos que antes se ignoraban porque sus inicios/finales reales 
            -- estaban a kilómetros de distancia.
            SELECT ST_CollectionExtract(ST_Intersection(ST_MakeValid(a.geom), b.geom), 2) as geom
            FROM activities a
            CROSS JOIN bbox b
            WHERE ST_Intersects(a.geom, b.geom)
              AND a.id IN :activity_ids
        ),
        pre_simplified AS (
            SELECT 
                ST_SimplifyPreserveTopology(geom, 0.00001) as geom
            FROM intersected_geom
            WHERE ST_GeometryType(geom) = 'ST_LineString' OR ST_GeometryType(geom) = 'ST_MultiLineString'
            -- Priorizamos tracks con MAYOR conteo de puntos (máxima definición espacial).
            -- Esto garantiza que las trazas densas y curvas actúen como molde inmóvil de anclaje en ST_Snap,
            -- obligando a los tracks de pocos puntos (rectas baratas) a amoldarse a las curvas en lugar de aplanarlas.
            ORDER BY ST_NPoints(geom) DESC
        ),
        aggregated_geom AS (
            -- Forzamos explícitamente el ORDER BY interno en array_agg() para asegurar que el bucle PL/pgSQL 
            -- reciba primero las trazas de máxima fidelidad, sirviendo de molde sólido.
            SELECT array_agg(geom ORDER BY ST_NPoints(geom) DESC) as geoms
            FROM pre_simplified
        ),
        union_lines AS (
            -- Usamos la función PL/pgSQL en lugar de un CTE recursivo.
            -- Esto mantiene una complejidad de memoria O(N) en vez de O(N^2) eliminando el riesgo de OOM.
            SELECT snap_and_union_sequential(geoms, :snap_tolerance) as geom 
            FROM aggregated_geom
        ),
        merge_pass_1 AS (
            -- Primer cosido: Une segmentos consecutivos de grado 2 para consolidar caminos largos antes de filtrar.
            SELECT ST_LineMerge(ST_CollectionExtract(geom, 2)) as geom
            FROM union_lines
        ),
        dump_pass_1_raw AS (
            SELECT (ST_Dump(geom)).geom as geom
            FROM merge_pass_1
        ),
        dump_pass_1 AS (
            SELECT row_number() over () as id, geom
            FROM dump_pass_1_raw
        ),
        endpoints AS (
            -- Extraemos los extremos (puntos inicio/fin) de cada segmento.
            SELECT id, ST_StartPoint(geom) as pt FROM dump_pass_1
            UNION ALL
            SELECT id, ST_EndPoint(geom) as pt FROM dump_pass_1
        ),
        node_degrees AS (
            -- Calculamos el grado de conectividad de cada nodo físico (punto).
            SELECT pt, count(*) as degree FROM endpoints GROUP BY pt
        ),
        segment_degrees AS (
            -- Identificamos qué segmentos son "espuelas" (tienen al menos un extremo ciego de grado 1).
            SELECT 
                d.geom,
                bool_or(n.degree = 1) as is_dangle
            FROM dump_pass_1 d
            JOIN endpoints e ON d.id = e.id
            JOIN node_degrees n ON e.pt = n.pt
            GROUP BY d.id, d.geom
        ),
        filtered_spurs AS (
            -- Filtramos ÚNICAMENTE aquellas espuelas ciegas que sean más cortas que min_length.
            -- Preservamos SIEMPRE la conectividad interna de la red (bucles, puentes), evitando que las carreteras se corten.
            SELECT geom 
            FROM segment_degrees
            WHERE NOT (is_dangle AND ST_Length(geom) < :min_length)
        ),
        collapsed_parallel AS (
            -- Colapsamos caminos redundantes o paralelos (los famosos "ojos de aguja" generados por el entretejido de tracks).
            -- Si varios segmentos conectan la misma pareja exacta de nodos finales, nos quedamos con el más largo.
            -- Al eliminar el duplicado artificial, los extremos pasan de grado 3 a grado 2, liberando al siguiente ST_LineMerge.
            SELECT DISTINCT ON (p1, p2)
                geom
            FROM (
                SELECT 
                    geom,
                    least(ST_StartPoint(geom), ST_EndPoint(geom)) as p1,
                    greatest(ST_StartPoint(geom), ST_EndPoint(geom)) as p2
                FROM filtered_spurs
            ) t
            ORDER BY p1, p2, ST_Length(geom) DESC
        ),
        merge_pass_2 AS (
            -- Segundo cosido: Consolida los tramos continuos tras eliminar redundancias paralelas
            SELECT ST_LineMerge(ST_Collect(geom)) as geom
            FROM collapsed_parallel
        ),
        dump_final_raw AS (
            SELECT (ST_Dump(geom)).geom as geom
            FROM merge_pass_2
        ),
        dump_final AS (
            -- Numeramos cada línea individual para indexar sus extremos en el clustering
            SELECT row_number() over () as id, geom
            FROM dump_final_raw
        ),
        endpoints_raw AS (
            -- Extraemos los puntos de inicio y final de cada línea
            SELECT id, ST_StartPoint(geom) as pt, 'start' as pos FROM dump_final
            UNION ALL
            SELECT id, ST_EndPoint(geom) as pt, 'end' as pos FROM dump_final
        ),
        clustered_nodes AS (
            -- Agrupamos los extremos que estén a una distancia dada en un mismo cluster espacial.
            -- Garantizamos que los puntos que no formen clúster (ruido) no sean NULL sino que hereden un ID negativo único para conservarse.
            SELECT 
                id, pos, pt,
                COALESCE(ST_ClusterDBSCAN(pt, :intersection_tolerance, 1) over (), -row_number() over ()) as cid
            FROM endpoints_raw
        ),
        cluster_centroids AS (
            -- Calculamos el centroide aritmético exacto de cada zona de cruce
            SELECT 
                cid,
                ST_Centroid(ST_Collect(pt)) as new_pt
            FROM clustered_nodes
            GROUP BY cid
        ),
        updated_endpoints AS (
            SELECT cn.id, cn.pos, cc.new_pt
            FROM clustered_nodes cn
            JOIN cluster_centroids cc ON cn.cid = cc.cid
        ),
        snapped_junctions AS (
            -- Redefinimos los extremos de cada línea forzándolos a conectarse al centroide de su cruce
            SELECT 
                d.id,
                ST_SetPoint(
                    ST_SetPoint(d.geom, 0, s.new_pt),
                    ST_NPoints(d.geom) - 1,
                    e.new_pt
                ) as geom
            FROM dump_final d
            JOIN updated_endpoints s ON d.id = s.id AND s.pos = 'start'
            JOIN updated_endpoints e ON d.id = e.id AND e.pos = 'end'
        ),
        final_merge AS (
            -- Tercer cosido: Al forzar que los extremos coincidan físicamente en el centroide,
            -- líneas que estaban separadas por milímetros ahora se fusionan topológicamente.
            SELECT ST_LineMerge(ST_Collect(geom)) as geom
            FROM snapped_junctions
        ),
        dump_post_junction AS (
            SELECT (ST_Dump(geom)).geom as geom
            FROM final_merge
        ),
        final_simplified AS (
            -- Simplificación final conservando la topología unificada limpia
            SELECT ST_SimplifyPreserveTopology(geom, :simplify_tolerance) as geom
            FROM dump_post_junction
        ),
        final_numbered AS (
            -- Numeramos cada tramo final para la posterior comparación cruzada
            SELECT 
                row_number() over () as id, 
                geom, 
                ST_Length(geom) as len
            FROM final_simplified
            WHERE geom IS NOT NULL
        ),
        final_deduplicated AS (
            -- Refinamiento Científico Definitivo: Deduplicación por Cobertura de Buffer.
            -- Si un segmento f1 corre COMPLETAMENTE dentro del colchón de influencia (:snap_tolerance)
            -- de otro segmento f2 más largo o idéntico, entonces f1 es 100% redundante y se descarta.
            -- Esto elimina de un plumazo las líneas dobles paralelas, incluso si una de ellas se cortó en 
            -- un cruce y la otra no (cuyos extremos son diferentes y burlaban a los filtros anteriores).
            SELECT f1.geom, f1.len
            FROM final_numbered f1
            WHERE NOT EXISTS (
                SELECT 1 FROM final_numbered f2
                WHERE f2.id <> f1.id
                  -- Comprobamos si el segmento f1 está totalmente cubierto por el buffer del segmento f2.
                  -- Utilizamos el radio del 'Imán' (:snap_tolerance) como colchón de confianza.
                  AND ST_Covers(ST_Buffer(f2.geom, :snap_tolerance, 'endcap=flat join=round'), f1.geom)
                  -- Desempate: Si f2 lo cubre, solo descartamos f1 si f2 es más largo o idéntico (menor ID).
                  AND (
                      f2.len > f1.len 
                      OR (f2.len = f1.len AND f2.id < f1.id)
                  )
            )
        ),
        final_stitched AS (
            -- Cosido Topológico Definitivo:
            -- Al borrar espuelas y ramificaciones falsas con el filtro 'Basura', lo que antes eran 
            -- cruces verdaderos de 3 caminos se convierten en simples continuaciones lineales de 2 caminos.
            -- Ejecutamos un ST_LineMerge sobre la colección final para suturar y soldar de por vida 
            -- estos segmentos adyacentes en una única y elegante línea continua.
            SELECT (ST_Dump(ST_LineMerge(ST_Collect(geom)))).geom as geom
            FROM final_deduplicated
        )
        SELECT 
            ST_AsGeoJSON(geom) as geojson,
            ST_Length(geom) as length_deg
        FROM final_stitched
        WHERE geom IS NOT NULL
    """)
    
    try:
        results = db.execute(sql, {
            "min_lon": req.min_lon,
            "min_lat": req.min_lat,
            "max_lon": req.max_lon,
            "max_lat": req.max_lat,
            "simplify_tolerance": req.simplify_tolerance,
            "snap_tolerance": req.snap_tolerance,
            "min_length": req.min_length,
            "intersection_tolerance": req.intersection_tolerance,
            "activity_ids": tuple(req.activity_ids)
        }).fetchall()
        
        segments = []
        for i, r in enumerate(results):
            geojson_str = r[0]
            geojson_geom = json.loads(geojson_str)
            
            # Generar un ID 100% estable basado exclusivamente en el hash de la geometría.
            # Ya no usamos el índice de fila i para que el ID sea robusto e independiente del encuadre del mapa.
            geom_hash = hashlib.md5(geojson_str.encode('utf-8')).hexdigest()[:16]
            seg_id = f"seg_{geom_hash}"
            
            segments.append({
                "id": seg_id,
                "type": "Feature",
                "geometry": geojson_geom,
                "properties": {
                    "id": seg_id,
                    "length": r[1]
                }
            })
            
        return {
            "type": "FeatureCollection",
            "features": segments
        }
    except Exception as e:
        print(f"Error calculando segmentos: {e}")
        raise HTTPException(status_code=500, detail=f"Error interno procesando geometría: {str(e)}")


@app.post("/activities/segments/v2")
def get_segments_v2(
    req: SegmentRequestV2,
    db: Session = Depends(get_db)
):
    """
    Endpoint de Nueva Generación (Método II): 
    Calcula segmentos topológicos limpios (Red LEGO) usando clustering métrico en Python
    y noding robusto en PostGIS.
    """
    from segment_engine_v2 import SegmentEngineV2
    engine = SegmentEngineV2()
    return engine.process_network_v2(req, db)


class PointsRequest(BaseModel):
    min_lat: float
    min_lon: float
    max_lat: float
    max_lon: float
    max_months: int = 12
    grid_size: float = 25.0


@app.post("/activities/points")
def get_points(
    req: PointsRequest,
    db: Session = Depends(get_db)
):
    from sqlalchemy import text
    import json
    
    sql = text("""
        WITH bbox AS (
            SELECT ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326) as geom
        ),
        filtered_activities AS (
            SELECT ST_MakeValid(a.geom) as geom 
            FROM activities a
            CROSS JOIN bbox b
            WHERE a.geom IS NOT NULL
              AND a.start_date >= NOW() - (:max_months * INTERVAL '1 month')
              AND ST_Intersects(a.geom, b.geom)
        ),
        intersected_activities AS (
            SELECT ST_Intersection(geom, (SELECT geom FROM bbox)) as geom
            FROM filtered_activities
        ),
        dumped_points AS (
            SELECT (ST_DumpPoints(geom)).geom as pt
            FROM intersected_activities
        ),
        projected_points AS (
            SELECT ST_Transform(pt, 3857) as pt_m
            FROM dumped_points
            WHERE pt IS NOT NULL
        ),
        snapped_points AS (
            SELECT 
                FLOOR(ST_X(pt_m) / :grid_size) as gx,
                FLOOR(ST_Y(pt_m) / :grid_size) as gy,
                ST_X(pt_m) as px,
                ST_Y(pt_m) as py
            FROM projected_points
        ),
        grid_averages AS (
            -- Calculamos el promedio inicial por celda
            SELECT 
                ST_SetSRID(ST_MakePoint(AVG(px), AVG(py)), 3857) as geom
            FROM snapped_points
            GROUP BY gx, gy
        ),
        clustered_averages AS (
            -- Agrupamos los centros de celda que queden a menos del 70% de la rejilla.
            -- Esto elimina definitivamente el artefacto de los puntos pegados en bordes de celda.
            SELECT 
                geom,
                COALESCE(
                    ST_ClusterDBSCAN(geom, :grid_size * 0.7, 1) OVER (),
                    -row_number() OVER ()
                ) as cid
            FROM grid_averages
        )
        -- Fusionamos los clusters promediando sus geometrías para obtener el punto definitivo
        SELECT 
            ST_AsGeoJSON(ST_Transform(ST_Centroid(ST_Collect(geom)), 4326)) as geojson
        FROM clustered_averages
        GROUP BY cid
    """)
    
    try:
        results = db.execute(sql, {
            "min_lon": req.min_lon,
            "min_lat": req.min_lat,
            "max_lon": req.max_lon,
            "max_lat": req.max_lat,
            "max_months": req.max_months,
            "grid_size": req.grid_size
        }).fetchall()
        
        features = []
        for r in results:
            if r[0]:
                features.append(json.loads(r[0]))
                
        return {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": f,
                    "properties": {}
                } for f in features
            ]
        }
    except Exception as e:
        print(f"Error obteniendo puntos: {e}")
        raise HTTPException(status_code=500, detail=f"Error interno obteniendo puntos: {str(e)}")




class ExportPointsRequest(BaseModel):
    points: List[dict]
    center: List[float]
    zoom: float

@app.post("/activities/points/export")
def export_points(req: ExportPointsRequest):
    import json
    import os
    
    public_dir = os.path.join(os.path.dirname(__file__), "..", "public")
    os.makedirs(public_dir, exist_ok=True)
    
    file_path = os.path.join(public_dir, "points_export.json")
    
    data = {
        "points": req.points,
        "center": req.center,
        "zoom": req.zoom
    }
    
    try:
        with open(file_path, "w") as f:
            json.dump(data, f)
        return {"status": "success", "file": "points_export.json"}
    except Exception as e:
        print(f"Error exporting points: {e}")
        raise HTTPException(status_code=500, detail=f"Error exporting points: {str(e)}")
