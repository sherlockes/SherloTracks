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
        collapsed_parallel AS (
            SELECT DISTINCT ON (p1, p2)
                geom
            FROM (
                SELECT 
                    geom,
                    least(ST_StartPoint(geom), ST_EndPoint(geom)) as p1,
                    greatest(ST_StartPoint(geom), ST_EndPoint(geom)) as p2
                FROM filtered_spurs
            ) t
            ORDER BY p1, p2, ST_Length(geom) DESC
        ),
        merge_pass_2 AS (
            SELECT ST_LineMerge(ST_Collect(geom)) as geom
            FROM collapsed_parallel
        ),
        dump_final AS (
            SELECT row_number() over () as id, (ST_Dump(geom)).geom as geom
            FROM merge_pass_2
        ),
        endpoints_raw AS (
            SELECT id, ST_StartPoint(geom) as pt, 'start' as pos FROM dump_final
            UNION ALL
            SELECT id, ST_EndPoint(geom) as pt, 'end' as pos FROM dump_final
        ),
        clustered_nodes AS (
            SELECT 
                id, pos, pt,
                ST_ClusterDBSCAN(pt, 0.0002, 1) over () as cid
            FROM endpoints_raw
        ),
        cluster_centroids AS (
            SELECT 
                cid,
                ST_Centroid(ST_Collect(pt)) as new_pt
            FROM clustered_nodes
            GROUP BY cid
        ),
        updated_endpoints AS (
            SELECT cn.id, cn.pos, cc.new_pt
            FROM clustered_nodes cn
            JOIN cluster_centroids cc ON cn.cid = cc.cid
        ),
        snapped_junctions AS (
            SELECT 
                d.id,
                ST_SetPoint(
                    ST_SetPoint(d.geom, 0, s.new_pt),
                    ST_NPoints(d.geom) - 1,
                    e.new_pt
                ) as geom
            FROM dump_final d
            JOIN updated_endpoints s ON d.id = s.id AND s.pos = 'start'
            JOIN updated_endpoints e ON d.id = e.id AND e.pos = 'end'
        ),
        final_merge AS (
            SELECT ST_LineMerge(ST_Collect(geom)) as geom
            FROM snapped_junctions
        ),
        dump_post_junction AS (
            SELECT (ST_Dump(geom)).geom as geom
            FROM final_merge
        )
        SELECT count(*) FROM dump_post_junction
    """)
    
    print("Running PARALLEL EDGE COLLAPSE on REAL dataset...")
    t0 = time.time()
    try:
        res = db.execute(sql).fetchone()
        t1 = time.time()
        print(f"SUCCESS! Yielded {res[0]} segments in {t1 - t0:.3f} seconds.")
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)
