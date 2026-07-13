import os
import time
import xml.etree.ElementTree as ET
from datetime import datetime
from garminconnect import Garmin
from sqlalchemy.orm import Session
from shapely.geometry import LineString
from geoalchemy2.shape import from_shape

import models

def parse_gpx_points(gpx_bytes):
    try:
        root = ET.fromstring(gpx_bytes)
        ns = ""
        if root.tag.startswith("{"):
            ns = root.tag.split("}")[0] + "}"
            
        points = []
        for trkpt in root.findall(f".//{ns}trkpt"):
            lat = float(trkpt.attrib["lat"])
            lon = float(trkpt.attrib["lon"])
            points.append((lon, lat))
            
        if len(points) < 2:
            return None
        return from_shape(LineString(points), srid=4326)
    except Exception as e:
        print(f"Error parsing GPX points: {e}")
        return None

def normalize_activity_type(type_key):
    if not type_key:
        return "Ride"
    tk = type_key.lower()
    if "cycling" in tk or "biking" in tk or "ride" in tk:
        return "Ride"
    if "running" in tk or "run" in tk:
        return "Run"
    if "hiking" in tk or "hike" in tk:
        return "Hike"
    if "walking" in tk or "walk" in tk:
        return "Walk"
    return type_key.capitalize()

def sync_garmin_activities(db: Session, full: bool = False):
    email = os.getenv("GARMIN_EMAIL")
    password = os.getenv("GARMIN_PASSWORD")
    
    if not email or not password or email == "usuario_garmin@ejemplo.com":
        raise ValueError("GARMIN_EMAIL or GARMIN_PASSWORD not configured or left at default in .env file")
        
    print(f"DEBUG: Conectando a Garmin Connect para {email}...")
    tokenstore_path = "/app/.garminconnect"
    os.makedirs(tokenstore_path, exist_ok=True)
    client = Garmin(email, password)
    client.login(tokenstore=tokenstore_path)
    
    # We fetch in batches of 100.
    batch_size = 100
    start = 0
    new_count = 0
    
    # Keep fetching until we find an activity that already exists in our DB,
    # or we reach a hard limit of 2000 activities, or Garmin returns no more.
    max_total_limit = 2000
    
    while start < max_total_limit:
        print(f"DEBUG: Obteniendo actividades de Garmin (offset={start}, limit={batch_size})...")
        activities = client.get_activities(start, batch_size)
        if not activities:
            print("DEBUG: No se obtuvieron más actividades de Garmin.")
            break
            
        # Check if the oldest activity in this batch already exists in the database.
        # If it exists, we know we have caught up to the historical sync point,
        # so this will be the last batch we need to fetch.
        last_activity_id = str(activities[-1]["activityId"])
        has_reached_end = db.query(models.Activity).filter(models.Activity.id == last_activity_id).first() is not None
        
        batch_new_count = 0
        for act in activities:
            act_id = str(act["activityId"])
            
            # Check if already exists in DB
            existing = db.query(models.Activity).filter(models.Activity.id == act_id).first()
            if existing:
                continue
                
            # Only keep bicycle activities (Ride)
            act_type = normalize_activity_type(act.get("activityType", {}).get("typeKey"))
            if act_type != "Ride":
                print(f"DEBUG: Saltando actividad {act_id} de tipo {act_type} (no es Ride)")
                continue
                
            print(f"DEBUG: Descargando GPX para actividad {act_id}...")
            try:
                # Download GPX file
                gpx_data = client.download_activity(act_id, dl_fmt=client.ActivityDownloadFormat.GPX)
                geom = parse_gpx_points(gpx_data)
                if not geom:
                    print(f"DEBUG: No se pudo obtener la geometría para {act_id} (puede ser una actividad indoor o sin GPS)")
                    continue
                    
                # Parse start date
                start_date_str = act.get("startTimeGMT") or act.get("startTimeLocal")
                start_date = None
                if start_date_str:
                    try:
                        start_date = datetime.strptime(start_date_str, "%Y-%m-%d %H:%M:%S")
                    except Exception:
                        try:
                            start_date = datetime.fromisoformat(start_date_str.replace("Z", "+00:00"))
                        except Exception:
                            start_date = datetime.now()
                else:
                    start_date = datetime.now()
                    
                # Create Activity
                db_activity = models.Activity(
                    id=act_id,
                    name=act.get("activityName", "Actividad Garmin"),
                    type=normalize_activity_type(act.get("activityType", {}).get("typeKey")),
                    distance=act.get("distance", 0.0),
                    moving_time=int(act.get("movingDuration", act.get("duration", 0))),
                    average_speed=act.get("averageSpeed", 0.0),
                    max_speed=act.get("maxSpeed", 0.0),
                    total_elevation_gain=act.get("elevationGain", 0.0),
                    start_date=start_date,
                    geom=geom
                )
                
                db.add(db_activity)
                batch_new_count += 1
                new_count += 1
                
                # Commit periodically to save progress
                if new_count % 10 == 0:
                    db.commit()
                    
                # Sleep slightly to prevent hitting Garmin rate limits
                time.sleep(0.5)
                
            except Exception as e:
                print(f"DEBUG: Error procesando actividad {act_id}: {e}")
                continue
                
        db.commit()
        
        # If we reached the end (historical sync boundary) or didn't add anything new, we can stop.
        if has_reached_end or batch_new_count == 0:
            print("DEBUG: Sincronización al día. No es necesario buscar actividades más antiguas.")
            break
            
        start += batch_size
        
    print(f"DEBUG: Garmin sync finalizado. Total nuevas: {new_count}")
    return new_count
