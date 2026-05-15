from sqlalchemy import create_engine, text
import sys

engine = create_engine('postgresql://user:password@db:5432/sherlotracks')
with engine.connect() as db:
    # We create two parallel lines:
    # Line 1: (0 0, 1 0)
    # Line 2: (0 0.0001, 1 0.0001)
    # We want to see if ST_Snap and ST_UnaryUnion can merge them into ONE line.
    sql = text("""
        WITH lines AS (
            SELECT ST_GeomFromText('LINESTRING(0 0, 1 0)', 4326) as geom, 1 as id
            UNION ALL
            SELECT ST_GeomFromText('LINESTRING(0 0.0001, 1 0.0001)', 4326) as geom, 2 as id
        ),
        -- Method A: parallel snapping (current approach)
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
        ),
        
        -- Method B: self-snapping the collection
        coll_b AS (
            SELECT ST_Collect(geom) as geom FROM lines
        ),
        snapped_b AS (
            SELECT ST_Snap(geom, geom, 0.0002) as geom FROM coll_b
        ),
        union_b AS (
            SELECT ST_UnaryUnion(geom) as geom FROM snapped_b
        ),
        dump_b AS (
            SELECT (ST_Dump(geom)).geom as geom FROM union_b
        ),

        -- Method C: Snap to the longest line (reference-based snapping)
        longest AS (
            SELECT geom FROM lines ORDER BY ST_Length(geom) DESC LIMIT 1
        ),
        snapped_c AS (
            SELECT ST_Snap(l.geom, ref.geom, 0.0002) as geom
            FROM lines l, longest ref
        ),
        union_c AS (
            SELECT ST_UnaryUnion(ST_Collect(geom)) as geom FROM snapped_c
        ),
        dump_c AS (
            SELECT (ST_Dump(geom)).geom as geom FROM union_c
        )
        
        SELECT 
            (SELECT count(*) FROM dump_a) as count_a,
            (SELECT count(*) FROM dump_b) as count_b,
            (SELECT count(*) FROM dump_c) as count_c
    """)
    res = db.execute(sql).fetchone()
    print(f"METHOD A (parallel): {res[0]} lines")
    print(f"METHOD B (self-snap): {res[1]} lines")
    print(f"METHOD C (ref-snap): {res[2]} lines")
