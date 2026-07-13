from fastapi import FastAPI, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List
import os
import time
import hashlib
import requests
from database import SessionLocal, engine
import models, garmin_utils
from dotenv import load_dotenv

load_dotenv()

from sqlalchemy import text

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="SherloTracks API")

@app.get("/minisite")
def redirect_minisite_slash():
    return Response(status_code=307, headers={"Location": "/minisite/"})

app.mount("/minisite", StaticFiles(directory="/public", html=True), name="minisite")

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



@app.get("/activities/sync")
def sync_activities(db: Session = Depends(get_db), full: bool = False):
    try:
        new_count = garmin_utils.sync_garmin_activities(db, full)
        return {"status": "synced", "count": new_count}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error al sincronizar con Garmin: {str(e)}")

@app.get("/activities")
def get_activities(time_filter: str = "Year", db: Session = Depends(get_db)):
    from sqlalchemy import func
    import json
    from datetime import datetime, timedelta
    
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
        func.ST_AsGeoJSON(func.ST_Simplify(models.Activity.geom, 0.00005)).label("geojson")
    )
    
    now = datetime.utcnow()
    if time_filter == "Month":
        limit_date = now - timedelta(days=30)
        query = query.filter(models.Activity.start_date >= limit_date)
    elif time_filter == "ThreeMonths":
        limit_date = now - timedelta(days=90)
        query = query.filter(models.Activity.start_date >= limit_date)
    elif time_filter == "SixMonths":
        limit_date = now - timedelta(days=180)
        query = query.filter(models.Activity.start_date >= limit_date)
    elif time_filter == "Year":
        limit_date = now - timedelta(days=365)
        query = query.filter(models.Activity.start_date >= limit_date)
        
    results = query.order_by(models.Activity.start_date.desc()).all()
    
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
            "start_date": r.start_date.isoformat() if r.start_date else None,
            "points": geojson["coordinates"]
        })
    
    from fastapi.responses import JSONResponse
    return JSONResponse(content=activities)

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
        func.ST_AsGeoJSON(func.ST_Simplify(models.Activity.geom, 0.00005)).label("geojson")
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
    act_data = {
        "id": r.id,
        "name": r.name,
        "type": r.type,
        "distance": r.distance,
        "moving_time": r.moving_time,
        "average_speed": r.average_speed,
        "max_speed": r.max_speed,
        "total_elevation_gain": r.total_elevation_gain,
        "start_date": r.start_date.isoformat() if r.start_date else None,
        "points": geojson["coordinates"]
    }
    from fastapi.responses import JSONResponse
    return JSONResponse(content=act_data)

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
        # Asegurarnos de que el directorio /public existe en la raíz (mapeado al volumen del host)
        os.makedirs("/public", exist_ok=True)
        
        # Guardar cruces de la zona visibles en /public/minisite_cruces.json
        with open("/public/minisite_cruces.json", "w", encoding="utf-8") as f:
            json.dump(req.cruces, f, indent=2, ensure_ascii=False)
            
        # Guardar tramos de la zona visibles en /public/minisite_tramos.json
        with open("/public/minisite_tramos.json", "w", encoding="utf-8") as f:
            json.dump(req.tramos, f, indent=2, ensure_ascii=False)
            
        git_pushed = False
        git_error_detail = None
        # Auto push al repositorio si el volumen /repo está montado
        if os.path.exists("/repo"):
            import subprocess
            try:
                # Comprobar si hay cambios para evitar commits vacíos
                status = subprocess.run(
                    ["git", "-c", "safe.directory=/repo", "status", "--porcelain", "public/minisite_cruces.json", "public/minisite_tramos.json"],
                    cwd="/repo", capture_output=True, text=True
                )
                if status.returncode == 0 and status.stdout.strip():
                    # Configuración básica en caso de no existir .gitconfig
                    subprocess.run(["git", "-c", "safe.directory=/repo", "config", "user.name", "SherloTracks Bot"], cwd="/repo")
                    subprocess.run(["git", "-c", "safe.directory=/repo", "config", "user.email", "bot@sherlotracks.es"], cwd="/repo")
                    
                    subprocess.run(["git", "-c", "safe.directory=/repo", "add", "public/minisite_cruces.json", "public/minisite_tramos.json"], cwd="/repo")
                    
                    commit_res = subprocess.run(
                        ["git", "-c", "safe.directory=/repo", "commit", "-m", "data: exportacion automatica de datos del minisite"],
                        cwd="/repo", capture_output=True, text=True
                    )
                    
                    if commit_res.returncode == 0:
                        push_res = subprocess.run(["git", "-c", "safe.directory=/repo", "push"], cwd="/repo", capture_output=True, text=True)
                        if push_res.returncode == 0:
                            git_pushed = True
                        else:
                            git_error_detail = f"git push falló: {push_res.stderr.strip()}"
                    else:
                        git_error_detail = f"git commit falló: {commit_res.stderr.strip()}"
            except Exception as git_err:
                git_error_detail = str(git_err)
                print(f"Error al hacer push al repositorio: {git_err}")

        msg = "Archivos del minisite exportados correctamente en la carpeta /public."
        if git_pushed:
            msg += " Cambios subidos automáticamente al repositorio Git."
        elif git_error_detail:
            msg += f" Sin embargo, no se pudo subir al repositorio Git: {git_error_detail}"

        return {"status": "success", "message": msg}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/minisite/cruces")
def get_minisite_cruces():
    from fastapi.responses import JSONResponse
    path = "/public/minisite_cruces.json"
    content = []
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            try:
                content = json.load(f)
            except Exception:
                content = []
    return JSONResponse(
        content=content,
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
    )

@app.get("/minisite/tramos")
def get_minisite_tramos():
    from fastapi.responses import JSONResponse
    path = "/public/minisite_tramos.json"
    content = []
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            try:
                content = json.load(f)
            except Exception:
                content = []
    return JSONResponse(
        content=content,
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
    )

def distance_meters(lon1, lat1, lon2, lat2):
    import math
    # Formula de Haversine
    R = 6371000.0  # Radio de la Tierra en metros
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2.0)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0)**2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c

def get_endpoint_id(pt, cruces_list):
    for c in cruces_list:
        dist = distance_meters(c["coords"][0], c["coords"][1], pt[0], pt[1])
        if dist <= 5.0:
            return f"cruce_{c['id']}"
    return f"coord_{pt[0]:.5f}_{pt[1]:.5f}"

def get_path_length(points):
    total_len = 0.0
    for i in range(len(points) - 1):
        total_len += distance_meters(points[i][0], points[i][1], points[i+1][0], points[i+1][1])
    return total_len

@app.get("/historical/calculate")
def calculate_historical(
    years: int, 
    min_lat: float = None, 
    min_lon: float = None, 
    max_lat: float = None, 
    max_lon: float = None, 
    db: Session = Depends(get_db)
):
    from datetime import datetime, timedelta
    from sqlalchemy import func
    from fastapi.responses import StreamingResponse
    import json
    import time
    
    view_min_lat = min_lat
    view_min_lon = min_lon
    view_max_lat = max_lat
    view_max_lon = max_lon
    
    def event_generator():
        try:
            # 1. Obtener los cruces de la base de datos (filtrados espacialmente si hay límites)
            cruce_query = db.query(
                models.Cruce.id,
                models.Cruce.nombre,
                models.Cruce.radio_influencia,
                func.ST_AsGeoJSON(models.Cruce.geom).label("geojson")
            )
            
            if view_min_lat is not None and view_min_lon is not None and view_max_lat is not None and view_max_lon is not None:
                envelope = func.ST_MakeEnvelope(view_min_lon, view_min_lat, view_max_lon, view_max_lat, 4326)
                cruce_query = cruce_query.filter(func.ST_Intersects(models.Cruce.geom, envelope))
                
            cruce_results = cruce_query.all()
            
            cruces_list = []
            cruces_geojson = []
            for r in cruce_results:
                geojson = json.loads(r.geojson) if r.geojson else {"coordinates": []}
                cLon, cLat = geojson["coordinates"]
                cruces_list.append({
                    "id": r.id,
                    "coords": [cLon, cLat],
                    "radio_influencia": r.radio_influencia if r.radio_influencia is not None else 25
                })
                cruces_geojson.append({
                    "type": "Feature",
                    "geometry": geojson,
                    "properties": {
                        "id": r.id,
                        "nombre": r.nombre if r.nombre is not None else f"Cruce #{r.id}",
                        "radio_influencia": r.radio_influencia
                    }
                })
                
            # 2. Obtener todas las actividades dentro del limite de años (filtradas espacialmente si hay límites)
            now = datetime.utcnow()
            limit_date = now - timedelta(days=years * 365)
            
            activity_query = db.query(
                models.Activity.id,
                models.Activity.name,
                models.Activity.distance,
                func.ST_AsGeoJSON(models.Activity.geom).label("geojson")
            ).filter(models.Activity.start_date >= limit_date)
            
            if view_min_lat is not None and view_min_lon is not None and view_max_lat is not None and view_max_lon is not None:
                envelope = func.ST_MakeEnvelope(view_min_lon, view_min_lat, view_max_lon, view_max_lat, 4326)
                activity_query = activity_query.filter(func.ST_Intersects(models.Activity.geom, envelope))
                
            activity_results = activity_query.all()
            
            activities_data = []
            total_kms = 0.0
            for r in activity_results:
                geojson = json.loads(r.geojson) if r.geojson else {"coordinates": []}
                if geojson.get("type") == "LineString":
                    dist_m = r.distance if r.distance is not None else 0.0
                    activities_data.append({
                        "id": r.id,
                        "name": r.name,
                        "distance": dist_m,
                        "points": geojson["coordinates"]
                    })
                    total_kms += dist_m / 1000.0
            
            total_activities = len(activities_data)
            
            # Enviar metadatos iniciales
            yield json.dumps({
                "type": "info",
                "total": total_activities,
                "totalKms": total_kms
            }) + "\n"
            
            # 3. Procesar tramos divididos por cruces
            valid_sub_paths = []
            processed_kms = 0.0
            
            for idx, act in enumerate(activities_data):
                # Pequeño retardo para suavizar la barra de progreso y evitar batching en React
                time.sleep(0.04)
                
                points = act["points"]
                dist_km = act["distance"] / 1000.0
                processed_kms += dist_km
                
                # Enviar progreso en tiempo real
                yield json.dumps({
                    "type": "progress",
                    "index": idx + 1,
                    "total": total_activities,
                    "name": act["name"],
                    "kms": processed_kms
                }) + "\n"
                
                if len(points) < 2:
                    continue
                    
                current_points = list(points)
                
                # Filtro rapido de cruces por caja delimitadora (bbox)
                lons = [p[0] for p in current_points]
                lats = [p[1] for p in current_points]
                min_lon, max_lon = min(lons), max(lons)
                min_lat, max_lat = min(lats), max(lats)
                
                pad = 0.005 # aprox 500m
                candidate_crossings = []
                for c in cruces_list:
                    c_lon, c_lat = c["coords"]
                    if min_lon - pad <= c_lon <= max_lon + pad and min_lat - pad <= c_lat <= max_lat + pad:
                        candidate_crossings.append(c)
                        
                if not candidate_crossings:
                    continue
                    
                for cruce in candidate_crossings:
                    c_lon, c_lat = cruce["coords"]
                    influence = cruce["radio_influencia"]
                    
                    # Identificar segmentos en zona de influencia
                    segments_in_influence = []
                    for i in range(len(current_points) - 1):
                        pA = current_points[i]
                        pB = current_points[i + 1]
                        
                        dx = pB[0] - pA[0]
                        dy = pB[1] - pA[1]
                        len2 = dx * dx + dy * dy
                        
                        t = 0.0
                        if len2 > 0:
                            t = ((c_lon - pA[0]) * dx + (c_lat - pA[1]) * dy) / len2
                            t = max(0.0, min(1.0, t))
                            
                        proj_lon = pA[0] + t * dx
                        proj_lat = pA[1] + t * dy
                        
                        dist = distance_meters(c_lon, c_lat, proj_lon, proj_lat)
                        if dist <= influence:
                            segments_in_influence.append({
                                "index": i,
                                "distance": dist
                            })
                            
                    if not segments_in_influence:
                        continue
                        
                    # Agrupar segmentos consecutivos
                    groups = []
                    current_group = []
                    for item in segments_in_influence:
                        if not current_group:
                            current_group.append(item)
                        else:
                            last_item = current_group[-1]
                            if item["index"] - last_item["index"] <= 2:
                                current_group.append(item)
                            else:
                                groups.append(current_group)
                                current_group = [item]
                    if current_group:
                        groups.append(current_group)
                        
                    # Procesar cada pase/grupo
                    indices_to_remove = set()
                    replacements = {}
                    insertions = {}
                    
                    for group in groups:
                        min_seg_idx = group[0]["index"]
                        max_seg_idx = group[-1]["index"]
                        
                        vertices_in_pass = []
                        for idx_pass in range(min_seg_idx, max_seg_idx + 2):
                            if idx_pass >= len(current_points):
                                continue
                            pt = current_points[idx_pass]
                            dist = distance_meters(c_lon, c_lat, pt[0], pt[1])
                            vertices_in_pass.append({
                                "index": idx_pass,
                                "point": pt,
                                "distance": dist
                            })
                            
                        interior_vertices = []
                        for v in vertices_in_pass:
                            if v["distance"] > influence:
                                continue
                            is_other = False
                            for oc in candidate_crossings:
                                if oc["id"] == cruce["id"]:
                                    continue
                                if abs(v["point"][0] - oc["coords"][0]) < 0.000001 and abs(v["point"][1] - oc["coords"][1]) < 0.000001:
                                    is_other = True
                                    break
                            if not is_other:
                                interior_vertices.append(v)
                                
                        if interior_vertices:
                            interior_vertices.sort(key=lambda x: x["distance"])
                            keeper = interior_vertices[0]
                            replacements[keeper["index"]] = [c_lon, c_lat]
                            for i in range(1, len(interior_vertices)):
                                indices_to_remove.add(interior_vertices[i]["index"])
                        else:
                            group.sort(key=lambda x: x["distance"])
                            best_seg = group[0]
                            insertions[best_seg["index"]] = [c_lon, c_lat]
                            
                    # Reconstruir puntos
                    next_points = []
                    for i in range(len(current_points)):
                        if i in indices_to_remove:
                            continue
                        if i in replacements:
                            next_points.append(replacements[i])
                        else:
                            next_points.append(current_points[i])
                        if i in insertions:
                            next_points.append(insertions[i])
                    current_points = next_points
                    
                # Dividir ruta en sub-paths en las coordenadas de los cruces exactos
                if len(current_points) >= 2:
                    current_sub_path = [current_points[0]]
                    for i in range(1, len(current_points)):
                        pt = current_points[i]
                        current_sub_path.append(pt)
                        
                        matched_cruce = None
                        for c in candidate_crossings:
                            if abs(pt[0] - c["coords"][0]) < 0.000001 and abs(pt[1] - c["coords"][1]) < 0.000001:
                                matched_cruce = c
                                break
                                
                        if matched_cruce is not None:
                            if len(current_sub_path) >= 2:
                                valid_sub_paths.append({
                                    "points": current_sub_path,
                                    "activity_id": act["id"],
                                    "activity_name": act["name"]
                                })
                            current_sub_path = [pt]
                    if len(current_sub_path) >= 2:
                        valid_sub_paths.append({
                            "points": current_sub_path,
                            "activity_id": act["id"],
                            "activity_name": act["name"]
                        })
                        
            # 4. Agrupar sub-paths por sus extremos (unordered startId/endId)
            tramos_by_endpoints = {}
            for sp in valid_sub_paths:
                start_id = get_endpoint_id(sp["points"][0], cruces_list)
                end_id = get_endpoint_id(sp["points"][-1], cruces_list)
                
                if start_id.startswith("cruce_") and end_id.startswith("cruce_") and start_id != end_id:
                    key = tuple(sorted([start_id, end_id]))
                    if key not in tramos_by_endpoints:
                        tramos_by_endpoints[key] = []
                    tramos_by_endpoints[key].append({
                        "points": sp["points"],
                        "startId": start_id,
                        "endId": end_id,
                        "activity_name": sp["activity_name"],
                        "activity_id": sp["activity_id"]
                    })
                    
            # 5. Generar tramos finales (único por par de cruces, el más corto de todos)
            final_tramos = []
            idx = 0
            for key, sp_list in tramos_by_endpoints.items():
                with_lengths = []
                for sp in sp_list:
                    length = get_path_length(sp["points"])
                    with_lengths.append((sp, length))
                    
                with_lengths.sort(key=lambda x: x[1])
                shortest_sp, shortest_length = with_lengths[0]
                
                act_names = list(set([sp["activity_name"] for sp in sp_list]))
                
                final_tramos.append({
                    "id": f"tramo_{idx}",
                    "points": shortest_sp["points"],
                    "startId": shortest_sp["startId"],
                    "endId": shortest_sp["endId"],
                    "activityNames": act_names,
                    "count": len(sp_list),
                    "isRoad": False
                })
                idx += 1
                
            yield json.dumps({
                "type": "result",
                "cruces": cruces_geojson,
                "tramos": final_tramos
            }) + "\n"
            
        except Exception as e:
            import traceback
            traceback.print_exc()
            yield json.dumps({
                "type": "error",
                "detail": str(e)
            }) + "\n"
            
    return StreamingResponse(
        event_generator(),
        media_type="application/x-ndjson",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
        }
    )


