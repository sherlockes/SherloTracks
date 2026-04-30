from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import os
import time
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
        # PostgreSQL syntax for adding column if not exists is tricky in 15-, 
        # so we just try and catch.
        db.execute(text("ALTER TABLE activities ADD COLUMN IF NOT EXISTS type VARCHAR;"))
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
    
    return {"message": "Authenticated successfully"}

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
    from datetime import datetime, timedelta
    
    # Retornamos todas las actividades de la base de datos
    results = db.query(
        models.Activity.id,
        models.Activity.name,
        models.Activity.type,
        models.Activity.distance,
        models.Activity.start_date,
        func.ST_AsGeoJSON(models.Activity.geom).label("geojson")
    ).order_by(models.Activity.start_date.desc()).all()
    
    activities = []
    for r in results:
        geojson = json.loads(r.geojson)
        activities.append({
            "id": r.id,
            "name": r.name,
            "type": r.type,
            "distance": r.distance,
            "start_date": r.start_date,
            "points": geojson["coordinates"]
        })
    return activities
