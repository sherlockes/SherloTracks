from sqlalchemy import create_engine, text
import sys

engine = create_engine('postgresql://user:password@db:5432/sherlotracks')
with engine.connect() as db:
    sql = text("""
        WITH RECURSIVE lines AS (
            -- Chain of 3 micro-segments (each 0.00005, total 0.00015)
            -- This simulates a road formed by partial overlapping tracks.
            SELECT ST_GeomFromText('LINESTRING(0 0, 0 0.00005)', 4326) as geom, 'chain' as grp
            UNION ALL
            SELECT ST_GeomFromText('LINESTRING(0 0.00005, 0 0.0001)', 4326) as geom, 'chain' as grp
            UNION ALL
            SELECT ST_GeomFromText('LINESTRING(0 0.0001, 0 0.00015)', 4326) as geom, 'chain' as grp
            
            UNION ALL
            
            -- Main road segments split by spur
            SELECT ST_GeomFromText('LINESTRING(1 0, 2 0)', 4326) as geom, 'spur_case' as grp
            UNION ALL
            SELECT ST_GeomFromText('LINESTRING(2 0, 3 0)', 4326) as geom, 'spur_case' as grp
            UNION ALL
            SELECT ST_GeomFromText('LINESTRING(2 0, 2 0.00005)', 4326) as geom, 'spur_case' as grp
        ),
        union_lines AS (
            SELECT ST_UnaryUnion(ST_Collect(geom)) as geom FROM lines
        ),
        
        -- PROPOSED METHOD: Double-Merge Pipeline
        -- 1. First Merge: dissolve degree-2 nodes to preserve chains
        merge1 AS (
            SELECT ST_LineMerge(ST_CollectionExtract(geom, 2)) as geom FROM union_lines
        ),
        -- 2. Dump & Filter: remove remaining isolated micro-spurs
        dump1 AS (
            SELECT (ST_Dump(geom)).geom as geom FROM merge1
        ),
        filtered AS (
            SELECT geom FROM dump1 WHERE ST_Length(geom) > 0.0001
        ),
        -- 3. Second Merge: dissolve nodes freed by deleted spurs
        merge2 AS (
            SELECT ST_LineMerge(ST_Collect(geom)) as geom FROM filtered
        ),
        dump_final AS (
            SELECT (ST_Dump(geom)).geom as geom FROM merge2
        )
        
        -- Output length of each group to verify:
        -- Chain should yield 1 segment of length 0.00015
        -- Spur case should yield 1 segment of length 2.0
        SELECT 
            ST_Length(geom) as length,
            ST_AsText(geom) as wkt
        FROM dump_final
    """)
    res = db.execute(sql).fetchall()
    print(f"SUCCESS! Found {len(res)} segments in final output.")
    for r in res:
        print(f"- Length: {r[0]:.6f} -> {r[1]}")
