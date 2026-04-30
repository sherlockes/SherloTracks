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

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="SherloTracks API")

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
def sync_activities(db: Session = Depends(get_db)):
    # 1. Obtener y validar token
    token = db.query(models.StravaToken).first()
    if not token:
        raise HTTPException(status_code=401, detail="No token found. Please login.")
    
    # Background Check: Refrescar si expiró
    if time.time() > token.expires_at - 300: # 5 min margin
        info = get_strava_client_info()
        new_data = strava_utils.refresh_strava_token(info["id"], info["secret"], token.refresh_token)
        token.access_token = new_data["access_token"]
        token.refresh_token = new_data["refresh_token"]
        token.expires_at = new_data["expires_at"]
        db.commit()

    # 2. Obtener actividades de Strava (pedimos las últimas 100)
    headers = {"Authorization": f"Bearer {token.access_token}"}
    resp = requests.get("https://www.strava.com/api/v3/athlete/activities?per_page=100", headers=headers)
    activities_data = resp.json()

    # 3. Procesar y Guardar
    new_count = 0
    for act in activities_data:
        if db.query(models.Activity).filter(models.Activity.id == str(act["id"])).first():
            continue
        
        poly = act.get("map", {}).get("summary_polyline")
        if not poly: continue
        
        geom = strava_utils.decode_polyline(poly)
        if not geom: continue

        db_activity = models.Activity(
            id=str(act["id"]),
            name=act["name"],
            distance=act["distance"],
            total_elevation_gain=act.get("total_elevation_gain", 0),
            start_date=act["start_date"],
            geom=geom
        )
        db.add(db_activity)
        new_count += 1
    
    db.commit()
    return {"status": "synced", "count": new_count}

@app.get("/activities")
def get_activities(db: Session = Depends(get_db)):
    from sqlalchemy import func
    import json
    from datetime import datetime, timedelta
    
    # Calculamos la fecha de hace un año
    one_year_ago = datetime.now() - timedelta(days=365)
    
    # Filtramos por fecha y quitamos el límite
    results = db.query(
        models.Activity.id,
        models.Activity.name,
        models.Activity.distance,
        models.Activity.start_date,
        func.ST_AsGeoJSON(models.Activity.geom).label("geojson")
    ).filter(models.Activity.start_date >= one_year_ago).order_by(models.Activity.start_date.desc()).all()
    
    activities = []
    for r in results:
        geojson = json.loads(r.geojson)
        activities.append({
            "id": r.id,
            "name": r.name,
            "distance": r.distance,
            "start_date": r.start_date,
            "points": geojson["coordinates"]
        })
    return activities
