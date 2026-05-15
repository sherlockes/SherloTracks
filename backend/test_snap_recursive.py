from sqlalchemy import create_engine, text
import sys

engine = create_engine('postgresql://user:password@db:5432/sherlotracks')
with engine.connect() as db:
    sql = text("""
        WITH RECURSIVE lines AS (
            SELECT ST_GeomFromText('LINESTRING(0 0, 1 0)', 4326) as geom, 1 as id
            UNION ALL
            SELECT ST_GeomFromText('LINESTRING(0 0.0001, 1 0.0001)', 4326) as geom, 2 as id
            UNION ALL
            SELECT ST_GeomFromText('LINESTRING(0.5 0.00005, 1.5 0.00005)', 4326) as geom, 3 as id
        ),
        ordered_lines AS (
            SELECT row_number() over () as rn, geom FROM lines
        ),
        -- Recursive Snapping:
        -- State: (rn, snapped_geom, cumulative_union)
        recursive_snap AS (
            -- Base Case: First line
            SELECT 
                CAST(1 AS BIGINT) as rn, 
                geom as snapped_geom, 
                geom as cumulative_union
            FROM ordered_lines WHERE rn = 1
            
            UNION ALL
            
            -- Recursive Step: Snap next line to the accumulated union
            SELECT 
                o.rn,
                ST_Snap(o.geom, r.cumulative_union, 0.0002) as snapped_geom,
                ST_UnaryUnion(ST_Collect(r.cumulative_union, ST_Snap(o.geom, r.cumulative_union, 0.0002))) as cumulative_union
            FROM ordered_lines o
            JOIN recursive_snap r ON o.rn = r.rn + 1
        ),
        -- We want the final accumulated union at the very end
        final_union AS (
            SELECT cumulative_union as geom FROM recursive_snap ORDER BY rn DESC LIMIT 1
        ),
        dump_d AS (
            SELECT (ST_Dump(geom)).geom as geom FROM final_union
        ),
        -- Compare with Method A (parallel)
        coll_a AS (
            SELECT ST_Collect(geom) as geom FROM lines
        ),
        snapped_a AS (
            SELECT ST_Snap(l.geom, c.geom, 0.0002) as geom
            FROM lines l, coll_a c
        ),
        union_a AS (
            SELECT ST_UnaryUnion(ST_Collect(geom)) as geom FROM snapped_a
        ),
        dump_a AS (
            SELECT (ST_Dump(geom)).geom as geom FROM union_a
        )
        
        SELECT 
            (SELECT count(*) FROM dump_a) as count_a,
            (SELECT count(*) FROM dump_d) as count_d
    """)
    res = db.execute(sql).fetchone()
    print(f"METHOD A (parallel): {res[0]} lines")
    print(f"METHOD D (recursive snap): {res[1]} lines")
