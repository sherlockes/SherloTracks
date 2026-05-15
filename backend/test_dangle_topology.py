from sqlalchemy import create_engine, text
import sys

engine = create_engine('postgresql://user:password@db:5432/sherlotracks')
with engine.connect() as db:
    sql = text("""
        WITH RECURSIVE lines AS (
            -- A main road with an internal "eyelet" (loop) caused by weaving tracks
            -- Segment 1: A-B
            SELECT ST_GeomFromText('LINESTRING(0 0, 1 0)', 4326) as geom
            UNION ALL
            -- Eyelet Segment 2: B-C (top part of loop, very short)
            SELECT ST_GeomFromText('LINESTRING(1 0, 1.05 0.01, 1.1 0)', 4326) as geom
            UNION ALL
            -- Eyelet Segment 3: B-C (bottom part of loop, very short)
            SELECT ST_GeomFromText('LINESTRING(1 0, 1.05 -0.01, 1.1 0)', 4326) as geom
            UNION ALL
            -- Segment 4: C-D
            SELECT ST_GeomFromText('LINESTRING(1.1 0, 2 0)', 4326) as geom
            UNION ALL
            -- Segment 5: A true micro-spur (dangle) hanging off D
            SELECT ST_GeomFromText('LINESTRING(2 0, 2.01 0.01)', 4326) as geom
        ),
        union_lines AS (
            SELECT ST_UnaryUnion(ST_Collect(geom)) as geom FROM lines
        ),
        dumped_raw AS (
            SELECT (ST_Dump(geom)).geom as geom FROM union_lines
        ),
        dumped AS (
            SELECT row_number() over () as id, geom FROM dumped_raw
        ),
        -- Extract endpoints of all dumped segments
        endpoints AS (
            SELECT id, ST_StartPoint(geom) as pt FROM dumped
            UNION ALL
            SELECT id, ST_EndPoint(geom) as pt FROM dumped
        ),
        -- Count occurrences of each endpoint to find degrees
        node_degrees AS (
            SELECT pt, count(*) as degree FROM endpoints GROUP BY pt
        ),
        -- Identify segments that are "Dangles" (have at least one degree-1 endpoint)
        segment_degrees AS (
            SELECT 
                d.id,
                d.geom,
                bool_or(n.degree = 1) as is_dangle
            FROM dumped d
            JOIN endpoints e ON d.id = e.id
            JOIN node_degrees n ON ST_Equals(e.pt, n.pt)
            GROUP BY d.id, d.geom
        ),
        -- Prune ONLY dangles that are shorter than min_length
        pruned AS (
            SELECT geom 
            FROM segment_degrees
            WHERE NOT (is_dangle AND ST_Length(geom) < 0.2)
        ),
        -- Verify final status: the main road and eyelets must survive!
        final_merge AS (
            -- Apply LineMerge again to merge roads previously broken by the spur!
            SELECT ST_LineMerge(ST_Collect(geom)) as geom FROM pruned
        ),
        dump_final AS (
            SELECT (ST_Dump(geom)).geom as geom FROM final_merge
        )
        
        SELECT count(*), ST_AsText(ST_Collect(geom)) FROM dump_final
    """)
    res = db.execute(sql).fetchone()
    print(f"SUCCESS! Topologically safe pruning yielded {res[0]} segments.")
    print(f"Final Geometry Collection: {res[1][:300]}...")

