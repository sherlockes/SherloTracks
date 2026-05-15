from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, ARRAY
from sqlalchemy.sql import func
from geoalchemy2 import Geometry
from database import Base

class StravaToken(Base):
    __tablename__ = "strava_tokens"
    id = Column(Integer, primary_key=True, index=True)
    access_token = Column(String, nullable=False)
    refresh_token = Column(String, nullable=False)
    expires_at = Column(Integer, nullable=False)

class Activity(Base):
    __tablename__ = "activities"
    id = Column(String, primary_key=True)
    name = Column(String)
    type = Column(String)
    distance = Column(Float)
    moving_time = Column(Integer)
    average_speed = Column(Float)
    max_speed = Column(Float)
    total_elevation_gain = Column(Float)
    start_date = Column(DateTime)
    geom = Column(Geometry(geometry_type='LINESTRING', srid=4326))

class NetworkTile(Base):
    __tablename__ = "network_tiles"
    tile_id = Column(Integer, primary_key=True, autoincrement=True)
    bbox_4326 = Column(Geometry(geometry_type='POLYGON', srid=4326), nullable=False)
    bbox_m = Column(Geometry(geometry_type='POLYGON', srid=3857), nullable=False)
    status = Column(String(20), default='dirty')
    last_processed_at = Column(DateTime(timezone=True))
    error_log = Column(String)

class NetworkNode(Base):
    __tablename__ = "network_nodes"
    node_id = Column(Integer, primary_key=True, autoincrement=True)
    geom_m = Column(Geometry(geometry_type='POINT', srid=3857), nullable=False, index=True)
    geom_4326 = Column(Geometry(geometry_type='POINT', srid=4326), nullable=False, index=True)
    degree = Column(Integer, default=0)
    confidence = Column(Float, default=1.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class NetworkEdge(Base):
    __tablename__ = "network_edges"
    edge_id = Column(Integer, primary_key=True, autoincrement=True)
    source = Column(Integer, ForeignKey("network_nodes.node_id"), index=True)
    target = Column(Integer, ForeignKey("network_nodes.node_id"), index=True)
    
    geom_m = Column(Geometry(geometry_type='LINESTRING', srid=3857), nullable=False, index=True)
    geom_4326 = Column(Geometry(geometry_type='LINESTRING', srid=4326), nullable=False, index=True)
    geom_simplified_4326 = Column(Geometry(geometry_type='LINESTRING', srid=4326))
    
    length_m = Column(Float, nullable=False)
    sport_types = Column(ARRAY(String), nullable=False)
    usage_count = Column(Integer, default=0)
    unique_users_count = Column(Integer, default=1)
    
    forward_usage_count = Column(Integer, default=0)
    backward_usage_count = Column(Integer, default=0)
    
    lateral_deviation_p50 = Column(Float)
    lateral_deviation_p95 = Column(Float)
    confidence = Column(Float, nullable=False, default=1.0)
    
    cost = Column(Float, nullable=False)
    reverse_cost = Column(Float, nullable=False)
    
    status = Column(String(20), default='active', index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
