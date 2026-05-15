from sqlalchemy import create_engine, text
import json
import hashlib
import sys

engine = create_engine('postgresql://user:password@db:5432/sherlotracks')
with engine.connect() as db:
    sql = text("""
        WITH bbox AS (
            SELECT ST_MakeEnvelope(-10.0, 30.0, 10.0, 50.0, 4326) as geom
        ),
        intersected_geom AS (
            SELECT a.geom as geom, a.id
            FROM activities a
            WHERE ST_Intersects(a.geom, (SELECT geom FROM bbox))
        ),
        pre_simplified AS (
            SELECT ST_SimplifyPreserveTopology(geom, 0.00001) as geom
            FROM intersected_geom
            WHERE ST_GeometryType(geom) = 'ST_LineString' OR ST_GeometryType(geom) = 'ST_MultiLineString'
        ),
        collection AS (
            SELECT ST_Collect(geom) as geom FROM pre_simplified
        ),
        snapped AS (
            SELECT ST_Snap(s.geom, c.geom, 0.0002) as geom
            FROM pre_simplified s, collection c
        ),
        union_lines AS (
            SELECT ST_UnaryUnion(ST_Collect(geom)) as geom
            FROM snapped
        ),
        merged_lines AS (
            SELECT ST_LineMerge(ST_CollectionExtract(geom, 2)) as geom
            FROM union_lines
        ),
        dumped AS (
            SELECT (ST_Dump(geom)).geom as geom
            FROM merged_lines
        ),
        final_simplified AS (
            SELECT ST_SimplifyPreserveTopology(geom, 0.00015) as geom
            FROM dumped
        )
        SELECT ST_AsGeoJSON(geom), ST_Length(geom) FROM final_simplified WHERE geom IS NOT NULL
    """)
    try:
        res = db.execute(sql).fetchall()
        print(f"SUCCESS: Found {len(res)} segments")
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)
