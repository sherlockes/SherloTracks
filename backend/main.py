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
        
        db.execute(text("ALTER TABLE cruces ADD COLUMN IF NOT EXISTS nombre VARCHAR;"))
        db.execute(text("ALTER TABLE cruces ADD COLUMN IF NOT EXISTS radio_influencia INTEGER DEFAULT 25;"))

        
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

class CruceCreate(BaseModel):
    lat: float
    lon: float

class CruceUpdate(BaseModel):
    lat: float = None
    lon: float = None
    nombre: str = None
    radio_influencia: int = None

class CruceImportItem(BaseModel):
    lat: float
    lon: float

class CruceBulkImportRequest(BaseModel):
    cruces: List[CruceImportItem]

class DeleteZoneRequest(BaseModel):
    min_lat: float
    min_lon: float
    max_lat: float
    max_lon: float

@app.post("/cruces")
def create_cruce(req: CruceCreate, db: Session = Depends(get_db)):
    from sqlalchemy import func
    import json
    try:
        db_cruce = models.Cruce(
            geom=f"SRID=4326;POINT({req.lon} {req.lat})",
            radio_influencia=25
        )
        db.add(db_cruce)
        db.commit()
        db.refresh(db_cruce)
        
        # Asignar nombre por defecto basado en su ID si está vacío
        if not db_cruce.nombre:
            db_cruce.nombre = f"Cruce #{db_cruce.id}"
            db.commit()
            db.refresh(db_cruce)
        
        geojson_query = db.query(func.ST_AsGeoJSON(db_cruce.geom)).scalar()
        geojson = json.loads(geojson_query) if geojson_query else {}
        
        return {
            "type": "Feature",
            "geometry": geojson,
            "properties": {
                "id": db_cruce.id,
                "nombre": db_cruce.nombre,
                "radio_influencia": db_cruce.radio_influencia
            }
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/cruces/bulk-import")
def bulk_import_cruces(req: CruceBulkImportRequest, db: Session = Depends(get_db)):
    from sqlalchemy import text
    try:
        imported_count = 0
        skipped_count = 0
        for item in req.cruces:
            # Comprobamos si ya existe un cruce a menos de ~1.1 metros (0.00001 grados)
            existing = db.execute(
                text("SELECT id FROM cruces WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), 0.00001) LIMIT 1"),
                {"lon": item.lon, "lat": item.lat}
            ).fetchone()
            
            if existing:
                skipped_count += 1
                continue
                
            db_cruce = models.Cruce(
                geom=f"SRID=4326;POINT({item.lon} {item.lat})"
            )
            db.add(db_cruce)
            imported_count += 1
            
        db.commit()
        return {"status": "success", "imported": imported_count, "skipped": skipped_count}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/cruces/delete-zone")
def delete_cruces_zone(req: DeleteZoneRequest, db: Session = Depends(get_db)):
    from sqlalchemy import text
    try:
        sql = text("""
            DELETE FROM cruces 
            WHERE geom && ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326)
        """)
        result = db.execute(sql, {
            "min_lon": req.min_lon,
            "min_lat": req.min_lat,
            "max_lon": req.max_lon,
            "max_lat": req.max_lat
        })
        db.commit()
        return {"status": "success", "count": result.rowcount}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/cruces")
def get_cruces(db: Session = Depends(get_db)):
    from sqlalchemy import func
    import json
    
    results = db.query(
        models.Cruce.id,
        models.Cruce.nombre,
        models.Cruce.radio_influencia,
        func.ST_AsGeoJSON(models.Cruce.geom).label("geojson")
    ).all()
    
    features = []
    for r in results:
        geojson = json.loads(r.geojson) if r.geojson else {"coordinates": []}
        features.append({
            "type": "Feature",
            "geometry": geojson,
            "properties": {
                "id": r.id,
                "nombre": r.nombre if r.nombre is not None else f"Cruce #{r.id}",
                "radio_influencia": r.radio_influencia if r.radio_influencia is not None else 25
            }
        })
        
    return {
        "type": "FeatureCollection",
        "features": features
    }

@app.delete("/cruces/{id}")
def delete_cruce(id: int, db: Session = Depends(get_db)):
    db_cruce = db.query(models.Cruce).filter(models.Cruce.id == id).first()
    if not db_cruce:
        raise HTTPException(status_code=404, detail="Cruce not found")
    try:
        db.delete(db_cruce)
        db.commit()
        return {"status": "success", "id": id}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/cruces/{id}")
def update_cruce(id: int, req: CruceUpdate, db: Session = Depends(get_db)):
    db_cruce = db.query(models.Cruce).filter(models.Cruce.id == id).first()
    if not db_cruce:
        raise HTTPException(status_code=404, detail="Cruce not found")
    try:
        if req.lat is not None and req.lon is not None:
            db_cruce.geom = f"SRID=4326;POINT({req.lon} {req.lat})"
        if req.nombre is not None:
            db_cruce.nombre = req.nombre
        if req.radio_influencia is not None:
            db_cruce.radio_influencia = req.radio_influencia
        db.commit()
        db.refresh(db_cruce)
        
        from sqlalchemy import func
        import json
        geojson_query = db.query(func.ST_AsGeoJSON(db_cruce.geom)).scalar()
        geojson = json.loads(geojson_query) if geojson_query else {}
        
        return {
            "status": "success",
            "id": id,
            "type": "Feature",
            "geometry": geojson,
            "properties": {
                "id": db_cruce.id,
                "nombre": db_cruce.nombre,
                "radio_influencia": db_cruce.radio_influencia
            }
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/activities/random")
def get_random_activity(
    min_lat: float = None, 
    min_lon: float = None, 
    max_lat: float = None, 
    max_lon: float = None, 
    db: Session = Depends(get_db)
):
    from sqlalchemy import func, or_
    import json
    
    query = db.query(
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
    )
    
    if min_lat is not None and min_lon is not None and max_lat is not None and max_lon is not None:
        envelope = func.ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326)
        query = query.filter(
            func.ST_Intersects(models.Activity.geom, envelope)
        )
        
    r = query.order_by(func.random()).first()
    
    if not r:
        raise HTTPException(
            status_code=404, 
            detail="No se encontraron rutas que pasen por la zona delimitada de la pantalla"
        )
        
    geojson = json.loads(r.geojson) if r.geojson else {"coordinates": []}
    return {
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
    }

class ExportMinisiteRequest(BaseModel):
    cruces: list
    tramos: list
    tolerance: int = 20

class TramoClassifyItem(BaseModel):
    id: str
    points: List[List[float]]

class ClassifyTramosRequest(BaseModel):
    tramos: List[TramoClassifyItem]
    tolerance: int = 20

def sync_osm_roads_for_bbox(db: Session, min_lat: float, min_lon: float, max_lat: float, max_lon: float):
    url = "https://overpass-api.de/api/interpreter"
    headers = {"User-Agent": "SherloTracksBot/1.0 (contact@sherlotracks.com)"}
    overpass_query = f"""
    [out:json][timeout:25];
    (
      way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service)(_link)?$"]({min_lat},{min_lon},{max_lat},{max_lon});
    );
    out geom;
    """
    try:
        response = requests.post(url, data={"data": overpass_query}, headers=headers, timeout=30)
        if response.status_code == 200:
            data = response.json()
            elements = data.get("elements", [])
            for el in elements:
                if el.get("type") == "way" and "geometry" in el:
                    way_id = el["id"]
                    # Check if already exists in DB
                    existing = db.execute(
                        text("SELECT id FROM osm_roads WHERE id = :id"),
                        {"id": way_id}
                    ).fetchone()
                    if existing:
                        continue
                    
                    tags = el.get("tags", {})
                    name = tags.get("name")
                    highway = tags.get("highway")
                    geom_pts = el["geometry"]
                    
                    if len(geom_pts) < 2:
                        continue
                    
                    # Convert to PostGIS geometry
                    line_wkt = "LINESTRING(" + ",".join([f"{pt['lon']} {pt['lat']}" for pt in geom_pts]) + ")"
                    try:
                        db.execute(
                            text("INSERT INTO osm_roads (id, name, highway, geom) VALUES (:id, :name, :highway, ST_GeomFromText(:wkt, 4326))"),
                            {"id": way_id, "name": name, "highway": highway, "wkt": line_wkt}
                        )
                    except Exception as ins_e:
                        print(f"Skipping way {way_id}: {ins_e}")
            db.commit()
    except Exception as e:
        print(f"Error syncing OSM roads: {e}")

@app.post("/tramos/classify")
def classify_tramos(req: ClassifyTramosRequest, db: Session = Depends(get_db)):
    lats = []
    lons = []
    for tramo in req.tramos:
        for pt in tramo.points:
            lons.append(pt[0])
            lats.append(pt[1])
            
    if lats and lons:
        min_lat = min(lats) - 0.01
        max_lat = max(lats) + 0.01
        min_lon = min(lons) - 0.01
        max_lon = max(lons) + 0.01
        sync_osm_roads_for_bbox(db, min_lat, min_lon, max_lat, max_lon)
        
    results = {}
    for tramo in req.tramos:
        pts = tramo.points
        if len(pts) < 2:
            results[tramo.id] = False
            continue
            
        start_pt = pts[0]
        end_pt = pts[-1]
        mid_pt = pts[len(pts) // 2]
        
        # Check if start and end are within tolerance of the SAME road, and midpoint is within tolerance of SOME road
        query = text("""
            SELECT EXISTS (
                SELECT 1 
                FROM osm_roads 
                WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_Point(:start_lon, :start_lat), 4326)::geography, :tolerance)
                  AND ST_DWithin(geom::geography, ST_SetSRID(ST_Point(:end_lon, :end_lat), 4326)::geography, :tolerance)
            ) AND EXISTS (
                SELECT 1 
                FROM osm_roads 
                WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_Point(:mid_lon, :mid_lat), 4326)::geography, :tolerance)
            )
        """)
        try:
            is_road = db.execute(query, {
                "start_lon": start_pt[0], "start_lat": start_pt[1],
                "end_lon": end_pt[0], "end_lat": end_pt[1],
                "mid_lon": mid_pt[0], "mid_lat": mid_pt[1],
                "tolerance": req.tolerance
            }).scalar()
            results[tramo.id] = bool(is_road)
        except Exception as e:
            print(f"Error in 3-point road check: {e}")
            results[tramo.id] = False
            
    return results

@app.post("/export-minisite")
def export_minisite(req: ExportMinisiteRequest, db: Session = Depends(get_db)):
    import json
    try:
        # Classify tramos before exporting
        lats = []
        lons = []
        for tramo in req.tramos:
            if "points" in tramo:
                for pt in tramo["points"]:
                    lons.append(pt[0])
                    lats.append(pt[1])
        
        if lats and lons:
            min_lat = min(lats) - 0.01
            max_lat = max(lats) + 0.01
            min_lon = min(lons) - 0.01
            max_lon = max(lons) + 0.01
            sync_osm_roads_for_bbox(db, min_lat, min_lon, max_lat, max_lon)
            
        for tramo in req.tramos:
            pts = tramo.get("points", [])
            if len(pts) < 2:
                tramo["isRoad"] = False
                continue
                
            start_pt = pts[0]
            end_pt = pts[-1]
            mid_pt = pts[len(pts) // 2]
            
            query = text("""
                SELECT EXISTS (
                    SELECT 1 
                    FROM osm_roads 
                    WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_Point(:start_lon, :start_lat), 4326)::geography, :tolerance)
                      AND ST_DWithin(geom::geography, ST_SetSRID(ST_Point(:end_lon, :end_lat), 4326)::geography, :tolerance)
                ) AND EXISTS (
                    SELECT 1 
                    FROM osm_roads 
                    WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_Point(:mid_lon, :mid_lat), 4326)::geography, :tolerance)
                )
            """)
            try:
                is_road = db.execute(query, {
                    "start_lon": start_pt[0], "start_lat": start_pt[1],
                    "end_lon": end_pt[0], "end_lat": end_pt[1],
                    "mid_lon": mid_pt[0], "mid_lat": mid_pt[1],
                    "tolerance": req.tolerance
                }).scalar()
                tramo["isRoad"] = bool(is_road)
            except Exception as e:
                print(f"Error classifying exported tramo {tramo.get('id')}: {e}")
                tramo["isRoad"] = False

        # Asegurarnos de que el directorio /public existe en la raíz (mapeado al volumen del host)
        os.makedirs("/public", exist_ok=True)
        
        # Guardar cruces de la zona visibles en /public/minisite_cruces.json
        with open("/public/minisite_cruces.json", "w", encoding="utf-8") as f:
            json.dump(req.cruces, f, indent=2, ensure_ascii=False)
            
        # Guardar tramos de la zona visibles en /public/minisite_tramos.json
        with open("/public/minisite_tramos.json", "w", encoding="utf-8") as f:
            json.dump(req.tramos, f, indent=2, ensure_ascii=False)
            
        return {"status": "success", "message": "Archivos del minisite exportados correctamente en la carpeta /public."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


