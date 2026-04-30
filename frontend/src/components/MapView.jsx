import React, { useEffect } from 'react';
import { MapContainer, TileLayer, useMap, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Componente para dibujar las líneas de las rutas
const RouteLines = ({ activities }) => {
  if (!activities || activities.length === 0) return null;

  return (
    <>
      {activities.map((act) => {
        if (!act.points || act.points.length < 2) return null;
        
        // Convertimos [lon, lat] del backend a [lat, lon] de Leaflet
        const path = act.points.map(p => [p[1], p[0]]);
        
        return (
          <Polyline 
            key={act.id}
            positions={path}
            pathOptions={{ 
                color: '#FC4C02', 
                weight: 2, 
                opacity: 0.4,
                lineJoin: 'round'
            }}
          />
        );
      })}
    </>
  );
};

// Componente para auto-centrar el mapa
const AutoCenter = ({ activities }) => {
    const map = useMap();
    useEffect(() => {
        if (activities && activities.length > 0) {
            try {
                const allPoints = activities
                    .flatMap(a => a.points || [])
                    .filter(p => Array.isArray(p) && p.length >= 2)
                    .map(p => [p[1], p[0]]);
                
                if (allPoints.length > 0) {
                    const bounds = L.latLngBounds(allPoints);
                    map.fitBounds(bounds, { padding: [50, 50], animate: true });
                }
            } catch (e) {
                console.error("AutoCenter error:", e);
            }
        }
    }, [activities, map]);
    return null;
};

const MapView = ({ activities }) => {
  return (
    <div 
        style={{ height: '650px', width: '100%', borderRadius: '24px', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}
        className="border border-white/10 relative bg-[#0a0a0a]"
    >
      <div className="absolute top-4 right-4 z-[1000] bg-black/70 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 text-xs flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-strava animate-pulse" />
        {activities.length > 0 ? `Visualizando ${activities.length} recorridos` : 'Cargando...'}
      </div>
      
      <MapContainer 
        center={[40.4168, -3.7038]} 
        zoom={6} 
        scrollWheelZoom={true}
        style={{ height: '100%', width: '100%', background: '#0a0a0a' }}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; CARTO'
        />
        <RouteLines activities={activities} />
        <AutoCenter activities={activities} />
      </MapContainer>
    </div>
  );
};

export default MapView;
