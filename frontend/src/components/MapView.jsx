import React, { useEffect } from 'react';
import { MapContainer, TileLayer, useMap, Polyline } from 'react-leaflet';
import L from 'leaflet';

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
                weight: 3, 
                opacity: 0.8,
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
        style={{ height: '100%', width: '100%' }}
        className="relative bg-white"
    >
      <div className="absolute top-4 right-4 z-[1000] bg-white/90 backdrop-blur-md px-4 py-2 rounded-full border border-slate-200 text-xs flex items-center gap-2 shadow-sm">
        <div className="w-2 h-2 rounded-full bg-strava animate-pulse" />
        <span className="font-semibold text-slate-700">
          {activities.length > 0 ? `Visualizando ${activities.length} recorridos` : 'Cargando...'}
        </span>
      </div>
      
      <MapContainer 
        center={[40.4168, -3.7038]} 
        zoom={6} 
        scrollWheelZoom={true}
        style={{ height: '100%', width: '100%', background: '#f1f5f9' }}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          attribution='&copy; CARTO'
        />
        <RouteLines activities={activities} />
        <AutoCenter activities={activities} />
      </MapContainer>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    </div>
  );
};

export default MapView;
