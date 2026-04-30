import polyline
from geoalchemy2.shape import from_shape
from shapely.geometry import LineString
import requests

def decode_polyline(encoded_path):
    if not encoded_path:
        return None
    try:
        points = polyline.decode(encoded_path)
        # Convert (lat, lon) to (lon, lat) for PostGIS
        points = [(p[1], p[0]) for p in points]
        if len(points) < 2:
            return None
        return from_shape(LineString(points), srid=4326)
    except Exception:
        return None

def refresh_strava_token(client_id, client_secret, refresh_token):
    response = requests.post(
        "https://www.strava.com/oauth/token",
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token
        }
    )
    response.raise_for_status()
    return response.json()
