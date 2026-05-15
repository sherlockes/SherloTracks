from sqlalchemy import create_engine, text
import sys

engine = create_engine('postgresql://user:password@db:5432/sherlotracks')
with engine.connect() as db:
    sql = text("""
        WITH RECURSIVE lines AS (
            -- Main road segment A-B
            SELECT ST_GeomFromText('LINESTRING(0 0, 1 0)', 4326) as geom
            UNION ALL
            -- Main road segment B-D
            SELECT ST_GeomFromText('LINESTRING(1 0, 2 0)', 4326) as geom
            UNION ALL
            -- Tiny spur B-C
            SELECT ST_GeomFromText('LINESTRING(1 0, 1 0.00002)', 4326) as geom
        ),
        union_lines AS (
            SELECT ST_UnaryUnion(ST_Collect(geom)) as geom FROM lines
        ),
        
        -- OLD METHOD: LineMerge FIRST, then dump, then filter
        old_merge AS (
            SELECT ST_LineMerge(geom) as geom FROM union_lines
        ),
        old_dumped AS (
            SELECT (ST_Dump(geom)).geom as geom FROM old_merge
        ),
        old_filtered AS (
            SELECT geom FROM old_dumped WHERE ST_Length(geom) > 0.0001
        ),
        
        -- NEW METHOD: Dump FIRST, then filter out spurs, then collect and LineMerge!
        new_dumped AS (
            SELECT (ST_Dump(geom)).geom as geom FROM union_lines
        ),
        new_filtered_spurs AS (
            SELECT geom FROM new_dumped WHERE ST_Length(geom) > 0.0001
        ),
        new_recollected AS (
            SELECT ST_Collect(geom) as geom FROM new_filtered_spurs
        ),
        new_merge AS (
            SELECT ST_LineMerge(geom) as geom FROM new_recollected
        ),
        new_final_dumped AS (
            SELECT (ST_Dump(geom)).geom as geom FROM new_merge
        )
        
        SELECT 
            (SELECT count(*) FROM old_filtered) as old_count,
            (SELECT count(*) FROM new_final_dumped) as new_count
    """)
    res = db.execute(sql).fetchone()
    print(f"OLD METHOD (Merge before filter): {res[0]} segments")
    print(f"NEW METHOD (Filter before Merge): {res[1]} segments")
