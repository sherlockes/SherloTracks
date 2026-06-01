import json
import math

def haversine(coord1, coord2):
    # coord is [lon, lat]
    lon1, lat1 = coord1
    lon2, lat2 = coord2
    R = 6371000 # radius of Earth in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(delta_lambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

try:
    with open("public/minisite_tramos.json", "r", encoding="utf-8") as f:
        tramos = json.load(f)
    with open("public/minisite_cruces.json", "r", encoding="utf-8") as f:
        cruces = json.load(f)
        
    c_dict = {f"cruce_{c['properties']['id']}": c['properties'].get('nombre', f"Cruce {c['properties']['id']}") for c in cruces}

    print(f"Loaded {len(tramos)} tramos and {len(cruces)} cruces.")
    
    anomalies = []
    for t in tramos:
        pts = t["points"]
        if len(pts) < 2:
            continue
            
        # Check consecutive points
        max_gap = 0
        gap_idx = -1
        for i in range(len(pts) - 1):
            dist = haversine(pts[i], pts[i+1])
            if dist > max_gap:
                max_gap = dist
                gap_idx = i
                
        # If the gap is greater than 200 meters, it's a huge anomaly (especially if it crosses the river!)
        if max_gap > 200:
            anomalies.append({
                "id": t["id"],
                "startId": t["startId"],
                "endId": t["endId"],
                "startName": c_dict.get(t["startId"], "N/A"),
                "endName": c_dict.get(t["endId"], "N/A"),
                "num_points": len(pts),
                "max_gap_meters": max_gap,
                "gap_between_indices": (gap_idx, gap_idx+1),
                "pts_around_gap": (pts[gap_idx], pts[gap_idx+1])
            })
            
    print(f"\nFound {len(anomalies)} tramos with telemetry jumps (> 200 meters):")
    for idx, anom in enumerate(anomalies):
        print(f"\nAnomaly {idx+1}:")
        print(f"  Tramo ID: {anom['id']}")
        print(f"  Endpoints: {anom['startId']} ({anom['startName']}) -> {anom['endId']} ({anom['endName']})")
        print(f"  Total Points: {anom['num_points']}")
        # Format distance
        print(f"  Max GPS jump gap: {anom['max_gap_meters']:.2f} meters")
        print(f"  Between indices: {anom['gap_between_indices']}")
        print(f"  Coordinates: {anom['pts_around_gap'][0]} -> {anom['pts_around_gap'][1]}")
        
except Exception as e:
    print("Error:", e)
