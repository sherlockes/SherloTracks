from sqlalchemy import create_engine, text
import sys

engine = create_engine('postgresql://user:password@db:5432/sherlotracks')
with engine.connect() as db:
    sql = text("""
        WITH RECURSIVE lines AS (
            -- Segment 1: A-B
            SELECT ST_GeomFromText('LINESTRING(0 0, 1 0)', 4326) as geom
            UNION ALL
            -- Eyelet Segment 2: B-C (top part of loop)
            SELECT ST_GeomFromText('LINESTRING(1 0, 1.05 0.01, 1.1 0)', 4326) as geom
            UNION ALL
            -- Eyelet Segment 3: B-C (bottom part of loop)
            SELECT ST_GeomFromText('LINESTRING(1 0, 1.05 -0.01, 1.1 0)', 4326) as geom
            UNION ALL
            -- Segment 4: C-D
            SELECT ST_GeomFromText('LINESTRING(1.1 0, 2 0)', 4326) as geom
        ),
        union_lines AS (
            SELECT ST_UnaryUnion(ST_Collect(geom)) as geom FROM lines
        ),
        dumped_raw AS (
            SELECT (ST_Dump(geom)).geom as geom FROM union_lines
        ),
        
        -- Compute unordered endpoints and select ONLY ONE segment per endpoint pair!
        deduplicated AS (
            SELECT DISTINCT ON (p1, p2)
                geom
            FROM (
                SELECT 
                    geom,
                    least(ST_StartPoint(geom), ST_EndPoint(geom)) as p1,
                    greatest(ST_StartPoint(geom), ST_EndPoint(geom)) as p2
                FROM dumped_raw
            ) t
            ORDER BY p1, p2, ST_Length(geom) DESC
        ),
        
        -- Now run ST_LineMerge on the deduplicated network
        final_merge AS (
            SELECT ST_LineMerge(ST_Collect(geom)) as geom FROM deduplicated
        ),
        dump_final AS (
            SELECT (ST_Dump(geom)).geom as geom FROM final_merge
        )
        
        SELECT count(*), ST_AsText(ST_Collect(geom)) FROM dump_final
    """)
    res = db.execute(sql).fetchone()
    print(f"SUCCESS! Parallel Edge Collapse yielded {res[0]} segment(s).")
    print(f"Final Geometry Collection: {res[1]}")
