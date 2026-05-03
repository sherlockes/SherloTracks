import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, useMap, Polyline, LayersControl, Popup } from 'react-leaflet';
import L from 'leaflet';

const RouteLine = ({ act, path }) => {
  const [hover, setHover] = useState(false);

  const handleDownloadGPX = (e) => {
    e.stopPropagation();
    const safeName = act.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const gpxHeader = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="SherloTracks">\n  <trk>\n    <name>' + safeName + '</name>\n    <trkseg>\n';
    const gpxPoints = path.map(p => `      <trkpt lat="${p[0]}" lon="${p[1]}"></trkpt>\n`).join('');
    const gpxFooter = '    </trkseg>\n  </trk>\n</gpx>';

    const blob = new Blob([gpxHeader + gpxPoints + gpxFooter], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${act.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Polyline
      positions={path}
      eventHandlers={{
        mouseover: (e) => {
          setHover(true);
          e.target.bringToFront();
        },
        mouseout: () => setHover(false),
      }}
      pathOptions={{
        color: hover ? '#0ea5e9' : '#FC4C02', // Azul eléctrico en hover, Naranja Strava normal
        weight: hover ? 6 : 3,
        opacity: 1,
        lineJoin: 'round'
      }}
    >
      <Popup>
        <div className="text-sm min-w-[240px]">
          <h3 className="font-bold text-base mb-3 text-slate-800 border-b border-slate-200 pb-1">{act.name}</h3>
          <div className="flex flex-col gap-1.5 text-slate-600 mb-2">
            <div>
              <span className="font-semibold text-slate-500">{"Fecha: "}</span>
              <span>{new Date(act.start_date).toLocaleDateString()}</span>
            </div>
            <div>
              <span className="font-semibold text-slate-500">{"Distancia: "}</span>
              <span>{(act.distance / 1000).toFixed(2)} km</span>
            </div>
            <div>
              <span className="font-semibold text-slate-500">{"Vel. Media: "}</span>
              <span>{(act.average_speed * 3.6).toFixed(1)} km/h</span>
            </div>
            <div>
              <span className="font-semibold text-slate-500">{"Desnivel: "}</span>
              <span>{act.total_elevation_gain} m</span>
            </div>
            <div className="border-t border-slate-100 mt-1 pt-1 flex items-center">
              <span className="font-semibold text-slate-500">{"Archivo: "}</span>
              <button onClick={handleDownloadGPX} className="text-[#FC4C02] hover:text-[#d93f00] hover:underline font-medium bg-transparent p-0 border-none cursor-pointer ml-1">
                Descargar GPX
              </button>
            </div>
          </div>
        </div>
      </Popup>
    </Polyline>
  );
};

// Componente para dibujar las líneas de las rutas con efecto Heatmap
const RouteLines = ({ activities }) => {
  if (!activities || activities.length === 0) return null;

  return (
    <>
      {activities.map((act) => {
        if (!act.points || act.points.length < 2) return null;

        // Convertimos [lon, lat] del backend a [lat, lon] de Leaflet
        const path = act.points.map(p => [p[1], p[0]]);

        return <RouteLine key={act.id} act={act} path={path} />;
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
        preferCanvas={true} // Mucho más rápido para cientos de líneas
        style={{ height: '100%', width: '100%', background: '#f1f5f9' }}
      >
        <LayersControl position="bottomleft">
          <LayersControl.BaseLayer checked name="Satélite">
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution='Tiles &copy; Esri'
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Estándar (Claro)">
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
              attribution='&copy; CARTO'
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Estándar (Oscuro)">
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; CARTO'
            />
          </LayersControl.BaseLayer>
        </LayersControl>
        <RouteLines activities={activities} />
        <AutoCenter activities={activities} />
      </MapContainer>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    </div>
  );
};

export default MapView;
