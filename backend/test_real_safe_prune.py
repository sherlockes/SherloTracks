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
            SELECT a.geom as geom
            FROM activities a
            WHERE ST_Intersects(a.geom, (SELECT geom FROM bbox))
            LIMIT 30
        ),
        pre_simplified AS (
            SELECT 
                row_number() over (ORDER BY ST_Length(geom) DESC) as rn,
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
        merge_pass_1 AS (
            SELECT ST_LineMerge(ST_CollectionExtract(geom, 2)) as geom
            FROM union_lines
        ),
        dump_pass_1_raw AS (
            SELECT (ST_Dump(geom)).geom as geom
            FROM merge_pass_1
        ),
        dump_pass_1 AS (
            SELECT row_number() over () as id, geom
            FROM dump_pass_1_raw
        ),
        endpoints AS (
            SELECT id, ST_StartPoint(geom) as pt FROM dump_pass_1
            UNION ALL
            SELECT id, ST_EndPoint(geom) as pt FROM dump_pass_1
        ),
        node_degrees AS (
            SELECT pt, count(*) as degree FROM endpoints GROUP BY pt
        ),
        segment_degrees AS (
            SELECT 
                d.geom,
                bool_or(n.degree = 1) as is_dangle
            FROM dump_pass_1 d
            JOIN endpoints e ON d.id = e.id
            JOIN node_degrees n ON e.pt = n.pt
            GROUP BY d.id, d.geom
        ),
        filtered_spurs AS (
            SELECT geom 
            FROM segment_degrees
            WHERE NOT (is_dangle AND ST_Length(geom) < 0.00015)
        ),
        merge_pass_2 AS (
            SELECT ST_LineMerge(ST_Collect(geom)) as geom
            FROM filtered_spurs
        ),
        dump_final AS (
            SELECT (ST_Dump(geom)).geom as geom
            FROM merge_pass_2
        )
        SELECT count(*) FROM dump_final
    """)
    
    print("Running topologically safe pruning on REAL dataset...")
    t0 = time.time()
    try:
        res = db.execute(sql).fetchone()
        t1 = time.time()
        print(f"SUCCESS! Yielded {res[0]} segments in {t1 - t0:.3f} seconds.")
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)
