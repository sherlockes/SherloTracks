from sqlalchemy import Column, Integer, String, Float, DateTime
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
    total_elevation_gain = Column(Float)
    start_date = Column(DateTime)
    geom = Column(Geometry(geometry_type='LINESTRING', srid=4326))
