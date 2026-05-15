from sqlalchemy import create_engine, text
import time
import sys

engine = create_engine('postgresql://user:password@db:5432/sherlotracks')
with engine.connect() as db:
    sql = text("""
        WITH RECURSIVE bbox AS (
            SELECT ST_MakeEnvelope(-10.0, 30.0, 10.0, 50.0, 4326) as geom
        ),
        intersected_geom AS (
            SELECT a.geom as geom, a.id
            FROM activities a
            WHERE ST_Intersects(a.geom, (SELECT geom FROM bbox))
            LIMIT 30
        ),
        pre_simplified AS (
            SELECT 
                row_number() over () as rn,
                ST_SimplifyPreserveTopology(geom, 0.00001) as geom
            FROM intersected_geom
            WHERE ST_GeometryType(geom) = 'ST_LineString' OR ST_GeometryType(geom) = 'ST_MultiLineString'
        ),
        recursive_snap AS (
            SELECT 
                CAST(1 AS BIGINT) as rn,
                geom as cumulative_union
            FROM pre_simplified WHERE rn = 1
            
            UNION ALL
            
            SELECT 
                p.rn,
                ST_UnaryUnion(ST_Collect(r.cumulative_union, ST_Snap(p.geom, r.cumulative_union, 0.0002))) as cumulative_union
            FROM pre_simplified p
            JOIN recursive_snap r ON p.rn = r.rn + 1
        ),
        union_lines AS (
            SELECT cumulative_union as geom 
            FROM recursive_snap 
            ORDER BY rn DESC LIMIT 1
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
        SELECT count(*) FROM final_simplified WHERE geom IS NOT NULL
    """)
    
    print("Running REAL dataset recursive snapping on 30 activities...")
    t0 = time.time()
    try:
        res = db.execute(sql).fetchone()
        t1 = time.time()
        print(f"SUCCESS! Found {res[0]} segments in {t1 - t0:.3f} seconds.")
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)
