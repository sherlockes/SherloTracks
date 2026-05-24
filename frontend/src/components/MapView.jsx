import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, useMap, Polyline, LayersControl, Popup, Circle, Tooltip, Marker } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import { Download, Upload, Trash2, Info, Settings, Sliders, RefreshCw, Plus, Minus, Share2 } from 'lucide-react';

const RouteLine = ({ act, path, dimmed }) => {
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
          if (dimmed) return;
          setHover(true);
          e.target.bringToFront();
        },
        mouseout: () => setHover(false),
      }}
      pathOptions={{
        color: hover ? '#0ea5e9' : '#FC4C02', // Azul eléctrico en hover, Naranja Strava normal
        weight: hover ? 6 : 3,
        opacity: dimmed ? 0.1 : 1.0,
        lineJoin: 'round'
      }}
    >
      {!dimmed && (
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
      )}
    </Polyline>
  );
};

// Componente para dibujar las líneas de las rutas con efecto Heatmap
const RouteLines = ({ activities, crucesMode, randomActivity }) => {
  if (crucesMode) {
    if (randomActivity && randomActivity.points && randomActivity.points.length >= 2) {
      const path = randomActivity.points.map(p => [p[1], p[0]]);
      return <RouteLine act={randomActivity} path={path} dimmed={false} />;
    }
    return null;
  }

  if (!activities || activities.length === 0) return null;

  return (
    <>
      {activities.map((act) => {
        if (!act.points || act.points.length < 2) return null;

        // Convertimos [lon, lat] del backend a [lat, lon] de Leaflet
        const path = act.points.map(p => [p[1], p[0]]);

        return <RouteLine key={act.id} act={act} path={path} dimmed={false} />;
      })}
    </>
  );
};

const TramoLine = ({ tramo }) => {
  const [hover, setHover] = useState(false);

  // Convertir puntos de [lon, lat] a [lat, lon]
  const path = tramo.points.map(p => [p[1], p[0]]);

  // Calcular longitud en metros del tramo
  let distance = 0;
  for (let i = 0; i < path.length - 1; i++) {
    distance += L.latLng(path[i]).distanceTo(L.latLng(path[i+1]));
  }
  const distanceStr = distance < 1000 ? `${Math.round(distance)} m` : `${(distance/1000).toFixed(2)} km`;

  // Generar un color único y armonioso basado en la clave del tramo para que sea constante pero diferenciado
  const getColor = (str) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    let h = Math.abs(hash) % 360;
    // Si cae en el rango del naranja (10 a 45 grados), desplazarlo 40 grados para salir del rango
    if (h >= 10 && h <= 45) {
      h = (h + 40) % 360;
    }
    return `hsl(${h}, 85%, 55%)`; // Colores HSL vibrantes
  };

  const tramoColor = getColor(tramo.id);

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
        color: hover ? '#38bdf8' : tramoColor, // Brillo cyan en hover
        weight: hover ? 7 : 4.5,
        opacity: hover ? 0.95 : 0.75,
        lineJoin: 'round'
      }}
    >
      <Popup>
        <div style={{ padding: '0.5rem', minWidth: '220px', fontFamily: 'sans-serif' }}>
          <h4 style={{ margin: '0 0 0.375rem 0', fontWeight: 'bold', color: '#1e293b', fontSize: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: tramoColor }}></span>
            Tramo entre Cruces
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '11px', color: '#475569' }}>
            <div>
              <span style={{ fontWeight: '600', color: '#94a3b8' }}>Origen: </span>
              <span style={{ fontFamily: 'monospace', color: '#334155', backgroundColor: '#f8fafc', padding: '0 0.25rem', borderRadius: '0.25rem' }}>{tramo.startId.replace('cruce_', '#').replace('coord_', 'Inicio/Fin ')}</span>
            </div>
            <div>
              <span style={{ fontWeight: '600', color: '#94a3b8' }}>Destino: </span>
              <span style={{ fontFamily: 'monospace', color: '#334155', backgroundColor: '#f8fafc', padding: '0 0.25rem', borderRadius: '0.25rem' }}>{tramo.endId.replace('cruce_', '#').replace('coord_', 'Inicio/Fin ')}</span>
            </div>
            <div>
              <span style={{ fontWeight: '600', color: '#94a3b8' }}>Longitud: </span>
              <span style={{ fontWeight: 'bold', color: '#0f172a' }}>{distanceStr}</span>
            </div>
            <div style={{ marginTop: '0.375rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.375rem' }}>
              <span style={{ fontWeight: '600', color: '#10b981', display: 'block', marginBottom: '0.125rem' }}>Uso por actividades ({tramo.count}):</span>
              <div style={{ maxHeight: '60px', overflowY: 'auto', fontSize: '10px', color: '#64748b', fontWeight: '500', paddingLeft: '0.25rem' }}>
                {Array.from(tramo.activityNames).map((name, idx) => (
                  <div key={idx} style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', borderLeft: '2px solid rgba(16,185,129,0.3)', paddingLeft: '0.25rem', marginBottom: '0.125rem' }} title={name}>
                    {name}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Popup>
    </Polyline>
  );
};

const TramosLayer = ({ tramos, crucesMode, creandoTrack }) => {
  if (!crucesMode || !tramos || tramos.length === 0 || creandoTrack) return null;

  return (
    <>
      {tramos.map((tr) => (
        <TramoLine key={tr.id} tramo={tr} />
      ))}
    </>
  );
};

const TrackCreatorLayer = ({
  creandoTrack,
  trackStartCruce,
  trackCurrentCruce,
  trackTramos,
  tramos,
  onSelectTramo,
  getTrackCoordinates,
  getNextAvailableTramos,
  getEquidistantPoint
}) => {
  if (!creandoTrack) return null;

  const nextTramos = getNextAvailableTramos();
  const trackCoords = getTrackCoordinates();

  return (
    <>
      {/* 1. Dibujar el track acumulado hasta el momento en azul vibrante */}
      {trackCoords.length >= 2 && (
        <Polyline
          positions={trackCoords.map(p => [p[1], p[0]])}
          pathOptions={{
            color: '#3b82f6', // Azul brillante
            weight: 6,
            opacity: 0.9,
            lineJoin: 'round'
          }}
        />
      )}

      {/* 2. Dibujar sólo los segmentos que partan del cruce extremo/actual */}
      {trackCurrentCruce && nextTramos.map((tr, index) => {
        const path = tr.points.map(p => [p[1], p[0]]);
        const num = index + 1;
        
        // Calcular el punto a distancia equidistante para poner el marcador con el número
        const markerPoint = getEquidistantPoint(tr.points, trackCurrentCruce, 70);
        
        const numIcon = L.divIcon({
          className: 'track-num-badge',
          html: `<div style="
            width: 24px;
            height: 24px;
            background-color: #8b5cf6;
            border: 2.5px solid #ffffff;
            border-radius: 50%;
            color: #ffffff;
            font-family: sans-serif;
            font-size: 11px;
            font-weight: 800;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 6px rgba(0,0,0,0.2);
            cursor: pointer;
            transition: transform 0.15s;
          " onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='scale(1)'">${num}</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });

        return (
          <React.Fragment key={`next_tramo_${tr.id}`}>
            {/* Línea del tramo disponible en color violeta vibrante y estilo dashed elegante */}
            <Polyline
              positions={path}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  onSelectTramo(tr);
                }
              }}
              pathOptions={{
                color: '#a855f7', // Violeta brillante
                weight: 5,
                opacity: 0.85,
                lineJoin: 'round',
                dashArray: '3, 6', // Punteado para indicar que es una opción elegible
                className: 'leaflet-interactive'
              }}
            />
            
            {/* Marcador numérico clickable en el medio del tramo */}
            <Marker
              position={markerPoint}
              icon={numIcon}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  onSelectTramo(tr);
                }
              }}
            />
          </React.Fragment>
        );
      })}
    </>
  );
};


// Capa para gestionar y renderizar los cruces manuales persistidos en la base de datos
const CrucesLayer = ({
  crucesMode,
  pointsParams,
  cruces,
  setCruces,
  selectedCruce,
  setSelectedCruce,
  onDeleteCruce,
  randomActivity,
  setRandomActivity,
  zoom,
  creandoTrack,
  trackStartCruce,
  setTrackStartCruce,
  trackCurrentCruce,
  setTrackCurrentCruce,
  setTrackTramos,
  tramos
}) => {
  const map = useMap();
  const [calculatedRadius, setCalculatedRadius] = useState(10); // metros

  const handleAddToTrack = (cruce) => {
    if (!randomActivity || !randomActivity.points || randomActivity.points.length === 0) {
      alert("No hay ninguna ruta cargada al azar.");
      return;
    }

    const cruceCoords = [cruce.geometry.coordinates[1], cruce.geometry.coordinates[0]]; // [lat, lon]
    const cruceLatLng = L.latLng(cruceCoords);
    const influenceRadius = pointsParams.cruceInfluence || 25;

    // 1. Identificar todos los segmentos del recorrido que entran en la zona de influencia del cruce
    const segmentsInInfluence = [];
    for (let i = 0; i < randomActivity.points.length - 1; i++) {
      const pA = randomActivity.points[i];
      const pB = randomActivity.points[i + 1];

      const cLon = cruce.geometry.coordinates[0];
      const cLat = cruce.geometry.coordinates[1];

      const dx = pB[0] - pA[0];
      const dy = pB[1] - pA[1];
      const len2 = dx * dx + dy * dy;

      let t = 0;
      if (len2 > 0) {
        t = ((cLon - pA[0]) * dx + (cLat - pA[1]) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
      }

      const projLon = pA[0] + t * dx;
      const projLat = pA[1] + t * dy;

      const projLatLng = L.latLng([projLat, projLon]);
      const dist = cruceLatLng.distanceTo(projLatLng);

      if (dist <= influenceRadius) {
        segmentsInInfluence.push({
          index: i,
          distance: dist,
          projPoint: [projLon, projLat]
        });
      }
    }

    let newPoints = [];

    // 2. Agrupar segmentos consecutivos de la ruta en pases o tránsitos independientes
    const groups = [];
    let currentGroup = [];

    for (let i = 0; i < segmentsInInfluence.length; i++) {
      const currentItem = segmentsInInfluence[i];
      if (currentGroup.length === 0) {
        currentGroup.push(currentItem);
      } else {
        const lastItem = currentGroup[currentGroup.length - 1];
        // Si el índice del segmento es contiguo (diferencia de 1) o muy cercano (tolerancia <= 2), 
        // asumimos que es el mismo pase continuo por la zona del cruce.
        if (currentItem.index - lastItem.index <= 2) {
          currentGroup.push(currentItem);
        } else {
          groups.push(currentGroup);
          currentGroup = [currentItem];
        }
      }
    }
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    // 3. Si no hay ningún segmento en la zona de influencia de forma directa (ej. radio pequeño), 
    // caemos en el comportamiento clásico de buscar el único segmento más cercano de la ruta.
    if (groups.length === 0) {
      let minSegmentDistance = Infinity;
      let bestSegmentIndex = -1;

      for (let i = 0; i < randomActivity.points.length - 1; i++) {
        const pA = randomActivity.points[i];
        const pB = randomActivity.points[i + 1];

        const cLon = cruce.geometry.coordinates[0];
        const cLat = cruce.geometry.coordinates[1];

        const dx = pB[0] - pA[0];
        const dy = pB[1] - pA[1];
        const len2 = dx * dx + dy * dy;

        let t = 0;
        if (len2 > 0) {
          t = ((cLon - pA[0]) * dx + (cLat - pA[1]) * dy) / len2;
          t = Math.max(0, Math.min(1, t));
        }

        const projLon = pA[0] + t * dx;
        const projLat = pA[1] + t * dy;

        const projLatLng = L.latLng([projLat, projLon]);
        const dist = cruceLatLng.distanceTo(projLatLng);

        if (dist < minSegmentDistance) {
          minSegmentDistance = dist;
          bestSegmentIndex = i;
        }
      }

      newPoints = [...randomActivity.points];
      if (bestSegmentIndex !== -1) {
        newPoints.splice(bestSegmentIndex + 1, 0, [cruce.geometry.coordinates[0], cruce.geometry.coordinates[1]]);
      } else {
        newPoints.push([cruce.geometry.coordinates[0], cruce.geometry.coordinates[1]]);
      }
    } else {
      // 4. Procesar cada pase independiente por la zona de influencia
      const indicesToRemove = new Set();
      const replacements = new Map();
      const insertions = new Map();

      groups.forEach(group => {
        const minSegIndex = group[0].index;
        const maxSegIndex = group[group.length - 1].index;

        // Recoger todos los vértices reales de la ruta involucrados en este pase particular
        const verticesInPass = [];
        for (let idx = minSegIndex; idx <= maxSegIndex + 1; idx++) {
          const pt = randomActivity.points[idx];
          const ptLatLng = L.latLng([pt[1], pt[0]]);
          const distance = cruceLatLng.distanceTo(ptLatLng);
          verticesInPass.push({
            index: idx,
            point: pt,
            distance: distance
          });
        }

        // Vértices del pase que caen dentro de la circunferencia de influencia
        const interiorVertices = verticesInPass.filter(v => v.distance <= influenceRadius);

        if (interiorVertices.length > 0) {
          // Si el pase tiene vértices físicos dentro de la influencia (ej. curvas lentas), 
          // reemplazamos el vértice más cercano al cruce por el cruce real y removemos el resto
          // para suavizar el trazado eliminando zigzags o dobleces redundantes.
          const sortedInteriors = [...interiorVertices].sort((a, b) => a.distance - b.distance);
          const keeper = sortedInteriors[0];

          replacements.set(keeper.index, [cruce.geometry.coordinates[0], cruce.geometry.coordinates[1]]);

          for (let i = 1; i < sortedInteriors.length; i++) {
            indicesToRemove.add(sortedInteriors[i].index);
          }
        } else {
          // Si el pase NO tiene vértices interiores (es decir, una línea recta pasa rasante a través del círculo
          // sin que ningún punto real caiga dentro de la circunferencia), buscamos el segmento que pasa más cerca 
          // del cruce e insertamos el punto de cruce en él.
          const sortedSegments = [...group].sort((a, b) => a.distance - b.distance);
          const bestSeg = sortedSegments[0];

          insertions.set(bestSeg.index, [cruce.geometry.coordinates[0], cruce.geometry.coordinates[1]]);
        }
      });

      // 5. Construir la nueva ruta aplicando las transformaciones calculadas por cada pase
      for (let i = 0; i < randomActivity.points.length; i++) {
        if (indicesToRemove.has(i)) {
          continue; // Eliminar vértice redundante de la zona de influencia
        }

        if (replacements.has(i)) {
          newPoints.push(replacements.get(i)); // Reemplazar por el cruce exacto
        } else {
          newPoints.push(randomActivity.points[i]);
        }

        if (insertions.has(i)) {
          newPoints.push(insertions.get(i)); // Insertar cruce exacto en la trayectoria rasante
        }
      }
    }

    setRandomActivity(prev => ({
      ...prev,
      points: newPoints
    }));
  };

  const handleRemoveFromTrack = (cruce) => {
    if (!randomActivity || !randomActivity.points || randomActivity.points.length === 0) {
      alert("No hay ninguna ruta cargada al azar.");
      return;
    }

    const cLon = cruce.geometry.coordinates[0];
    const cLat = cruce.geometry.coordinates[1];
    const threshold = 0.000001; // aprox. 11 cm de margen para precisión de flotantes

    const originalLength = randomActivity.points.length;
    const newPoints = randomActivity.points.filter(p => {
      const match = Math.abs(p[0] - cLon) < threshold && Math.abs(p[1] - cLat) < threshold;
      return !match;
    });

    if (newPoints.length === originalLength) {
      alert("Este cruce no está presente en el track actual.");
      return;
    }

    setRandomActivity(prev => ({
      ...prev,
      points: newPoints
    }));
  };

  // Actualizar reactivamente el radio en metros al cambiar el %, entrar al modo o realizar un cambio de zoom o paneo en el mapa
  useEffect(() => {
    if (!crucesMode || !map) return;

    const updateRadius = () => {
      const bounds = map.getBounds();
      // Medimos la anchura de la pantalla visible en metros
      const width = map.distance(bounds.getSouthWest(), bounds.getSouthEast());
      // Calculamos el radio que equivale al porcentaje (%) del ancho
      const radius = width * (pointsParams.pointSizePercent / 100);
      setCalculatedRadius(radius);
    };

    // Cálculo inicial
    updateRadius();

    // Escuchar eventos de zoom y movimiento para recalcular la métrica
    map.on('zoomend', updateRadius);
    map.on('moveend', updateRadius);
    
    return () => {
      map.off('zoomend', updateRadius);
      map.off('moveend', updateRadius);
    };
  }, [pointsParams.pointSizePercent, crucesMode, map]);

  if (!crucesMode) return null;

  const isDraggableZoom = zoom >= 17;

  const handleUpdateCrucePosition = async (id, lat, lon) => {
    try {
      const response = await axios.put(`/api/cruces/${id}`, {
        lat: lat,
        lon: lon
      });
      if (response.data) {
        setCruces(prev => prev.map(c => {
          if (c.properties.id === id) {
            return {
              ...c,
              geometry: {
                ...c.geometry,
                coordinates: [lon, lat]
              }
            };
          }
          return c;
        }));
        
        if (selectedCruce && selectedCruce.properties.id === id) {
          setSelectedCruce(prev => ({
            ...prev,
            geometry: {
              ...prev.geometry,
              coordinates: [lon, lat]
            }
          }));
        }
      }
    } catch (e) {
      console.error("Error al actualizar la posición del cruce:", e);
      alert("No se pudo actualizar la posición del cruce en el servidor.");
    }
  };

  return (
    <>
      <style>{`
        .cruce-tooltip {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          padding: 0 !important;
          color: white !important;
          font-weight: 900 !important;
          font-family: sans-serif !important;
          font-size: 14px !important;
          text-shadow: 0 0 3px rgba(0,0,0,0.8) !important;
          pointer-events: none !important;
        }
        .cruce-tooltip::before {
          display: none !important;
        }
        .leaflet-interactive-cruce {
          cursor: pointer !important;
        }
      `}</style>

      {cruces.map((c) => {
        if (!c.geometry || !c.geometry.coordinates) return null;

        // Si estamos en modo de creación de track y ya elegimos un cruce de inicio,
        // sólo mostramos el inicio, el actual, y los extremos de los siguientes tramos candidatos
        if (creandoTrack && trackStartCruce) {
          const isStart = trackStartCruce.properties.id === c.properties.id;
          const isCurrent = trackCurrentCruce.properties.id === c.properties.id;
          
          const nextTramos = tramos.filter(t => 
            t.startId === `cruce_${trackCurrentCruce.properties.id}` || 
            t.endId === `cruce_${trackCurrentCruce.properties.id}`
          );
          
          const isNextEndpoint = nextTramos.some(t => {
            const startNum = parseInt(t.startId.replace('cruce_', ''), 10);
            const endNum = parseInt(t.endId.replace('cruce_', ''), 10);
            return startNum === c.properties.id || endNum === c.properties.id;
          });
          
          if (!isStart && !isCurrent && !isNextEndpoint) {
            return null; // Ocultar
          }

          // Si es un extremo candidato del siguiente tramo pero dicho tramo es muy corto
          // (el cruce está a menos de 70 metros), ocultamos este cruce "X" porque
          // la etiqueta con el número del tramo se situará cerca de él.
          if (isNextEndpoint && !isStart && !isCurrent) {
            const cCoords = c.geometry.coordinates;
            const currentCoords = trackCurrentCruce.geometry.coordinates;
            const dist = L.latLng(cCoords[1], cCoords[0]).distanceTo(L.latLng(currentCoords[1], currentCoords[0]));
            if (dist < 70) {
              return null;
            }
          }
        }
        
        const position = [c.geometry.coordinates[1], c.geometry.coordinates[0]];
        const isSelected = selectedCruce && selectedCruce.properties.id === c.properties.id;
        const influenceRadius = pointsParams.cruceInfluence || 25;
        
        // Personalización de colores y etiquetas en modo creación
        let iconHtml = 'X';
        let bgColor = '#10b981'; // Verde por defecto
        let borderColor = isSelected ? '#f59e0b' : '#047857';
        let labelText = 'X';

        if (creandoTrack) {
          if (!trackStartCruce) {
            labelText = 'INICIO';
            iconHtml = `<div style="font-size: 7px; font-weight: 800; line-height: 1.1; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%;"><span>INICIO</span></div>`;
            bgColor = '#10b981';
            borderColor = '#ffffff';
          } else {
            const isStart = trackStartCruce.properties.id === c.properties.id;
            const isCurrent = trackCurrentCruce.properties.id === c.properties.id;
            
            if (isStart) {
              labelText = 'I';
              iconHtml = 'I';
              bgColor = '#10b981'; // Verde esmeralda para el inicio
              borderColor = '#ffffff';
            } else if (isCurrent) {
              labelText = 'E';
              iconHtml = 'E';
              bgColor = '#3b82f6'; // Azul brillante para el extremo actual
              borderColor = '#ffffff';
            } else {
              labelText = 'X';
              iconHtml = 'X';
              bgColor = '#a855f7'; // Púrpura para los siguientes candidatos
              borderColor = '#ffffff';
            }
          }
        }

        const cruceIcon = isDraggableZoom ? L.divIcon({
          className: 'custom-cruce-marker',
          html: `<div style="
            width: ${isSelected ? '24px' : '18px'};
            height: ${isSelected ? '24px' : '18px'};
            background-color: ${bgColor};
            border: ${isSelected ? '3.5px solid #f59e0b' : '1.5px solid ' + borderColor};
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #ffffff;
            font-family: sans-serif;
            font-size: ${creandoTrack && !trackStartCruce ? '7px' : '11px'};
            font-weight: 900;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            text-align: center;
            line-height: ${isSelected ? '17px' : '15px'};
            cursor: pointer;
          ">${iconHtml}</div>`,
          iconSize: isSelected ? [24, 24] : [18, 18],
          iconAnchor: isSelected ? [12, 12] : [9, 9]
        }) : null;

        return (
          <React.Fragment key={`cruce_group_${c.properties.id}`}>
            {/* Aureola circular de influencia (no interactiva) */}
            <Circle
              center={position}
              radius={influenceRadius}
              interactive={false}
              pathOptions={{
                fillColor: '#10b981',
                fillOpacity: 0.12, // Muy clara/transparente
                color: '#10b981',
                weight: 1.5,
                opacity: 0.45,
                dashArray: '5, 5' // Aureola punteada
              }}
            />

            {/* Punto central interactivo del cruce */}
            {isDraggableZoom ? (
              <Marker
                position={position}
                icon={cruceIcon}
                draggable={creandoTrack ? false : true} // Deshabilitar arrastrar durante creación
                eventHandlers={{
                  click: (e) => {
                    L.DomEvent.stopPropagation(e);
                    if (creandoTrack) {
                      if (!trackStartCruce) {
                        setTrackStartCruce(c);
                        setTrackCurrentCruce(c);
                        setTrackTramos([]);
                      }
                    } else {
                      setSelectedCruce(isSelected ? null : c);
                    }
                  },
                  dragend: async (e) => {
                    const marker = e.target;
                    const newLatLng = marker.getLatLng();
                    await handleUpdateCrucePosition(c.properties.id, newLatLng.lat, newLatLng.lng);
                  }
                }}
              >
                {!creandoTrack && (
                  <Popup
                    eventHandlers={{
                      remove: () => {
                        if (isSelected) setSelectedCruce(null);
                      }
                    }}
                  >
                    <div className="text-center p-1.5 min-w-[140px] font-sans">
                      <h4 className="font-bold text-slate-800 text-xs mb-2 border-b border-slate-100 pb-1">Cruce #{c.properties.id}</h4>
                      <button
                        onClick={(e) => {
                          L.DomEvent.stopPropagation(e);
                          handleAddToTrack(c);
                        }}
                        className="w-full flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] uppercase py-2 px-3 rounded shadow-md transition-all cursor-pointer border-none mb-1.5"
                      >
                        <Plus size={12} />
                        Añadir a track
                      </button>
                      <button
                        onClick={(e) => {
                          L.DomEvent.stopPropagation(e);
                          handleRemoveFromTrack(c);
                        }}
                        className="w-full flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] uppercase py-2 px-3 rounded shadow-md transition-all cursor-pointer border-none mb-1.5"
                      >
                        <Minus size={12} />
                        Quitar de track
                      </button>
                      <button
                        onClick={(e) => {
                          L.DomEvent.stopPropagation(e);
                          onDeleteCruce(c.properties.id);
                        }}
                        className="w-full flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white font-bold text-[10px] uppercase py-2 px-3 rounded shadow-md transition-all cursor-pointer border-none"
                      >
                        <Trash2 size={12} />
                        Borrar Cruce
                      </button>
                    </div>
                  </Popup>
                )}
              </Marker>
            ) : (
              <Circle
                center={position}
                radius={isSelected ? calculatedRadius * 1.3 : calculatedRadius}
                eventHandlers={{
                  click: (e) => {
                    L.DomEvent.stopPropagation(e);
                    if (creandoTrack) {
                      if (!trackStartCruce) {
                        setTrackStartCruce(c);
                        setTrackCurrentCruce(c);
                        setTrackTramos([]);
                      }
                    } else {
                      setSelectedCruce(isSelected ? null : c);
                    }
                  }
                }}
                interactive={true}
                pathOptions={{
                  fillColor: bgColor,
                  fillOpacity: isSelected ? 0.95 : 0.8,
                  color: borderColor,
                  weight: isSelected ? 3.5 : 1.5,
                  opacity: isSelected ? 1.0 : 0.8,
                  className: 'leaflet-interactive-cruce'
                }}
              >
                <Tooltip 
                  permanent 
                  direction="center" 
                  className="cruce-tooltip"
                  interactive={false}
                >
                  <span>{labelText}</span>
                </Tooltip>
                {!creandoTrack && (
                  <Popup
                    eventHandlers={{
                      remove: () => {
                        if (isSelected) setSelectedCruce(null);
                      }
                    }}
                  >
                    <div className="text-center p-1.5 min-w-[140px] font-sans">
                      <h4 className="font-bold text-slate-800 text-xs mb-2 border-b border-slate-100 pb-1">Cruce #{c.properties.id}</h4>
                      <button
                        onClick={(e) => {
                          L.DomEvent.stopPropagation(e);
                          handleAddToTrack(c);
                        }}
                        className="w-full flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] uppercase py-2 px-3 rounded shadow-md transition-all cursor-pointer border-none mb-1.5"
                      >
                        <Plus size={12} />
                        Añadir a track
                      </button>
                      <button
                        onClick={(e) => {
                          L.DomEvent.stopPropagation(e);
                          handleRemoveFromTrack(c);
                        }}
                        className="w-full flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] uppercase py-2 px-3 rounded shadow-md transition-all cursor-pointer border-none mb-1.5"
                      >
                        <Minus size={12} />
                        Quitar de track
                      </button>
                      <button
                        onClick={(e) => {
                          L.DomEvent.stopPropagation(e);
                          onDeleteCruce(c.properties.id);
                        }}
                        className="w-full flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white font-bold text-[10px] uppercase py-2 px-3 rounded shadow-md transition-all cursor-pointer border-none"
                      >
                        <Trash2 size={12} />
                        Borrar Cruce
                      </button>
                    </div>
                  </Popup>
                )}
              </Circle>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
};

// Componente para auto-centrar el mapa en la ruta al azar cargada
const AutoCenterRandomRoute = ({ randomActivity }) => {
  const map = useMap();
  useEffect(() => {
    if (randomActivity && randomActivity.points && randomActivity.points.length > 0) {
      try {
        const allPoints = randomActivity.points.map(p => [p[1], p[0]]);
        const bounds = L.latLngBounds(allPoints);
        map.fitBounds(bounds, { padding: [50, 50], animate: true });
      } catch (e) {
        console.error("AutoCenterRandomRoute error:", e);
      }
    }
  }, [randomActivity, map]);
  return null;
};

// Componente auxiliar para capturar y exponer la instancia del mapa al componente padre MapView
const MapReferenceTracker = ({ setMap }) => {
  const map = useMap();
  useEffect(() => {
    if (map) {
      setMap(map);
    }
  }, [map, setMap]);
  return null;
};



// Componente para persistir y restaurar la vista actual (Viewport) del mapa
const ViewportPersister = () => {
  const map = useMap();

  // Restauración en carga inicial
  useEffect(() => {
    const saved = localStorage.getItem('sherlo_mapViewport');
    if (saved) {
      try {
        const { center, zoom } = JSON.parse(saved);
        if (Array.isArray(center) && center.length === 2 && typeof zoom === 'number') {
          map.setView(center, zoom, { animate: false });
        }
      } catch (e) {
        console.error("Error al restaurar posición del mapa:", e);
      }
    }
  }, [map]);

  // Escucha de eventos para guardar cambios
  useEffect(() => {
    const saveViewport = () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      localStorage.setItem('sherlo_mapViewport', JSON.stringify({
        center: [center.lat, center.lng],
        zoom: zoom
      }));
    };

    map.on('moveend', saveViewport);
    map.on('zoomend', saveViewport);

    return () => {
      map.off('moveend', saveViewport);
      map.off('zoomend', saveViewport);
    };
  }, [map]);

  return null;
};

// Componente para auto-centrar el mapa
const AutoCenter = ({ activities }) => {
  const map = useMap();
  useEffect(() => {
    // Si el usuario ya tiene una posición guardada, NUNCA sobreescribimos su vista al recargar
    const hasSaved = localStorage.getItem('sherlo_mapViewport');
    if (hasSaved) return;

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

// Componente para capturar clicks en el mapa con Ctrl para cruces manuales
const MapClickListener = ({ crucesMode, onMapAltClick }) => {
  const map = useMap();
  useEffect(() => {
    const handleMapClick = (e) => {
      if (e.originalEvent && e.originalEvent.ctrlKey && crucesMode) {
        onMapAltClick(e.latlng);
      }
    };
    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
    };
  }, [map, crucesMode, onMapAltClick]);
  return null;
};

const MapView = ({ 
  activities, 
  crucesMode
}) => {
  const [pointsParams, setPointsParams] = useState(() => {
    const saved = localStorage.getItem('sherlo_pointsParams');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.cruceInfluence === undefined) parsed.cruceInfluence = 25;
        if (parsed.similarityTolerance === undefined) parsed.similarityTolerance = 25;
        return parsed;
      } catch (e) {
        console.error("Error cargando pointsParams:", e);
      }
    }
    return {
      pointSizePercent: 0.5, // % de la pantalla
      cruceInfluence: 25, // Radio de influencia en metros por defecto
      similarityTolerance: 25 // Tolerancia de similitud en metros por defecto
    };
  });

  useEffect(() => {
    localStorage.setItem('sherlo_pointsParams', JSON.stringify(pointsParams));
  }, [pointsParams]);
  const [showSettings, setShowSettings] = useState(false);

  const [tramos, setTramos] = useState([]);
  const [cruces, setCruces] = useState([]);
  const [selectedCruce, setSelectedCruce] = useState(null);
  const [randomActivity, setRandomActivity] = useState(null);
  const [loadingCruces, setLoadingCruces] = useState(false);
  const [map, setMap] = useState(null);
  const [zoom, setZoom] = useState(6);
  const [activationBounds, setActivationBounds] = useState(null);

  const [creandoTrack, setCreandoTrack] = useState(false);
  const [trackStartCruce, setTrackStartCruce] = useState(null);
  const [trackCurrentCruce, setTrackCurrentCruce] = useState(null);
  const [trackTramos, setTrackTramos] = useState([]);

  const getNextAvailableTramos = useCallback(() => {
    if (!creandoTrack || !trackCurrentCruce) return [];
    const currentId = `cruce_${trackCurrentCruce.properties.id}`;
    
    // 1. Filtrar los tramos que conectan con el cruce actual
    let available = tramos.filter(t => t.startId === currentId || t.endId === currentId);
    
    // 2. Si ya hay tramos en el track, el tramo por el que hemos venido (volver atrás)
    // debe colocarse siempre en primera posición para que se le asigne el número 1.
    if (trackTramos.length > 0) {
      const lastTramo = trackTramos[trackTramos.length - 1].tramo;
      const lastIndex = available.findIndex(t => 
        t.id === lastTramo.id || 
        (t.startId === lastTramo.startId && t.endId === lastTramo.endId) ||
        (t.startId === lastTramo.endId && t.endId === lastTramo.startId)
      );
      
      if (lastIndex !== -1) {
        const [backtrackTramo] = available.splice(lastIndex, 1);
        available.unshift(backtrackTramo);
      }
    }
    
    return available;
  }, [creandoTrack, trackCurrentCruce, tramos, trackTramos]);

  const handleSelectNextTramo = useCallback((tramo) => {
    if (!trackCurrentCruce) return;
    const currentId = `cruce_${trackCurrentCruce.properties.id}`;
    
    let nextCruceId = null;
    if (tramo.startId === currentId) {
      nextCruceId = tramo.endId;
    } else if (tramo.endId === currentId) {
      nextCruceId = tramo.startId;
    }
    
    if (!nextCruceId) return;
    
    const targetCruceNum = parseInt(nextCruceId.replace('cruce_', ''), 10);
    const nextCruce = cruces.find(c => c.properties.id === targetCruceNum);
    
    if (nextCruce) {
      // Determinar la orientación del tramo (reversed) comparando la distancia
      // geográfica de los extremos de points al cruce actual.
      // Esto previene que una discrepancia en la DB entre la dirección geométrica de los
      // puntos y los IDs de inicio/fin cree líneas diagonales rectas no deseadas.
      let reversed = false;
      if (tramo.points && tramo.points.length >= 2) {
        const currentCoords = trackCurrentCruce.geometry.coordinates;
        const currentLatLng = L.latLng(currentCoords[1], currentCoords[0]);
        
        const pStart = tramo.points[0];
        const pEnd = tramo.points[tramo.points.length - 1];
        
        const startDist = L.latLng(pStart[1], pStart[0]).distanceTo(currentLatLng);
        const endDist = L.latLng(pEnd[1], pEnd[0]).distanceTo(currentLatLng);
        
        if (startDist > endDist) {
          reversed = true;
        }
      } else {
        reversed = (tramo.endId === currentId);
      }

      setTrackTramos(prev => [...prev, { tramo, reversed, fromCruce: trackCurrentCruce }]);
      setTrackCurrentCruce(nextCruce);

      // Autocentrar el mapa en el cruce de destino de forma suave y elegante.
      // Retardamos ligeramente la ejecución del vuelo/paneo con setTimeout(..., 50) para dar tiempo
      // a que React realice el renderizado del nuevo tramo seleccionado en azul vibrante.
      // Así, durante todo el vuelo (flyTo), el usuario verá el recorrido del segmento ya marcado.
      if (map && nextCruce.geometry && nextCruce.geometry.coordinates) {
        const coords = nextCruce.geometry.coordinates;
        const targetLatLng = L.latLng(coords[1], coords[0]);
        
        setTimeout(() => {
          const currentBounds = map.getBounds();
          if (!currentBounds.contains(targetLatLng)) {
            map.flyTo(targetLatLng, map.getZoom(), {
              animate: true,
              duration: 2.0
            });
          } else {
            map.panTo(targetLatLng, {
              animate: true,
              duration: 0.8
            });
          }
        }, 50);
      }
    }
  }, [trackCurrentCruce, cruces, map]);

  const handleUndoLastTramo = useCallback(() => {
    if (trackTramos.length === 0) return;
    
    setTrackTramos(prev => {
      const newTramos = [...prev];
      const lastItem = newTramos.pop();
      
      // Intentamos usar la referencia directa al cruce de procedencia.
      // Si por alguna razón no existiera, recurrimos al cálculo basado en IDs.
      let targetCruce = null;
      if (lastItem.fromCruce) {
        targetCruce = lastItem.fromCruce;
      } else {
        const prevCruceIdStr = lastItem.reversed ? lastItem.tramo.endId : lastItem.tramo.startId;
        const prevCruceNum = parseInt(prevCruceIdStr.replace('cruce_', ''), 10);
        targetCruce = cruces.find(c => c.properties.id === prevCruceNum);
      }
      
      if (targetCruce) {
        setTrackCurrentCruce(targetCruce);
        if (map && targetCruce.geometry && targetCruce.geometry.coordinates) {
          const coords = targetCruce.geometry.coordinates;
          const targetLatLng = L.latLng(coords[1], coords[0]);
          
          setTimeout(() => {
            const currentBounds = map.getBounds();
            if (!currentBounds.contains(targetLatLng)) {
              map.flyTo(targetLatLng, map.getZoom(), {
                animate: true,
                duration: 2.0
              });
            } else {
              map.panTo(targetLatLng, {
                animate: true,
                duration: 0.8
              });
            }
          }, 50);
        }
      } else {
        setTrackCurrentCruce(trackStartCruce);
        if (map && trackStartCruce && trackStartCruce.geometry && trackStartCruce.geometry.coordinates) {
          const coords = trackStartCruce.geometry.coordinates;
          const targetLatLng = L.latLng(coords[1], coords[0]);
          
          setTimeout(() => {
            const currentBounds = map.getBounds();
            if (!currentBounds.contains(targetLatLng)) {
              map.flyTo(targetLatLng, map.getZoom(), {
                animate: true,
                duration: 2.0
              });
            } else {
              map.panTo(targetLatLng, {
                animate: true,
                duration: 0.8
              });
            }
          }, 50);
        }
      }
      
      return newTramos;
    });
  }, [trackTramos, cruces, trackStartCruce, map]);

  const getTrackCoordinates = useCallback(() => {
    let coords = [];
    trackTramos.forEach((item) => {
      let pts = [...item.tramo.points];
      if (item.reversed) {
        pts.reverse();
      }
      if (coords.length > 0 && pts.length > 0) {
        coords.pop(); // Evitar duplicar punto de conexión
      }
      coords.push(...pts);
    });
    return coords;
  }, [trackTramos]);

  const handleExportTrackGPX = useCallback(() => {
    const coords = getTrackCoordinates();
    if (coords.length < 2) return;

    const safeName = "Track_Creado_" + new Date().toLocaleDateString().replace(/\//g, '_');
    const gpxHeader = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="SherloTracks">\n  <trk>\n    <name>' + safeName + '</name>\n    <trkseg>\n';
    const gpxPoints = coords.map(p => `      <trkpt lat="${p[1]}" lon="${p[0]}"></trkpt>\n`).join('');
    const gpxFooter = '    </trkseg>\n  </trk>\n</gpx>';

    const blob = new Blob([gpxHeader + gpxPoints + gpxFooter], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName.toLowerCase()}.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [getTrackCoordinates]);

  const getMidpoint = (points) => {
    if (!points || points.length === 0) return [0, 0];
    const midIndex = Math.floor(points.length / 2);
    const pt = points[midIndex];
    return [pt[1], pt[0]];
  };

  const getEquidistantPoint = useCallback((points, currentCruce, targetDistance = 70) => {
    if (!points || points.length === 0 || !currentCruce) return [0, 0];

    const currentCoords = currentCruce.geometry.coordinates;
    const currentLatLng = L.latLng(currentCoords[1], currentCoords[0]);

    // 1. Convertir puntos de [lon, lat] a LatLng de Leaflet
    const latlngs = points.map(p => L.latLng(p[1], p[0]));

    // 2. Determinar si el tramo empieza o termina cerca de currentCruce
    const startDist = latlngs[0].distanceTo(currentLatLng);
    const endDist = latlngs[latlngs.length - 1].distanceTo(currentLatLng);

    // Orientar el recorrido para que empiece en el cruce actual
    const orientedPath = startDist <= endDist ? latlngs : [...latlngs].reverse();

    // Calcular la longitud total del tramo
    let totalLength = 0;
    for (let i = 0; i < orientedPath.length - 1; i++) {
      totalLength += orientedPath[i].distanceTo(orientedPath[i + 1]);
    }

    // Si el tramo es más corto que targetDistance, lo ponemos al final del segmento (ej. al 85% de su longitud)
    // en lugar del cruce en sí para indicar claramente que pertenece al tramo.
    const effectiveDistance = totalLength < targetDistance ? totalLength * 0.85 : targetDistance;

    // 3. Recorrer el camino orientado hasta encontrar el punto a la distancia efectiva
    let accumulatedDistance = 0;
    for (let i = 0; i < orientedPath.length - 1; i++) {
      const p1 = orientedPath[i];
      const p2 = orientedPath[i + 1];
      const segmentLength = p1.distanceTo(p2);

      if (accumulatedDistance + segmentLength >= effectiveDistance) {
        const remainingDistance = effectiveDistance - accumulatedDistance;
        const ratio = remainingDistance / segmentLength;
        const lat = p1.lat + (p2.lat - p1.lat) * ratio;
        const lng = p1.lng + (p2.lng - p1.lng) * ratio;
        return [lat, lng];
      }

      accumulatedDistance += segmentLength;
    }

    // Si el tramo es extremadamente corto, devolver el extremo final (el siguiente cruce)
    const lastPoint = orientedPath[orientedPath.length - 1];
    return [lastPoint.lat, lastPoint.lng];
  }, []);



  // Atajos de teclado en creación de track
  useEffect(() => {
    if (!creandoTrack || !trackCurrentCruce) return;

    const handleKeyDown = (e) => {
      if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;

      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 1 && num <= 9) {
        const nextTramos = getNextAvailableTramos();
        const tramoIndex = num - 1;
        if (tramoIndex < nextTramos.length) {
          handleSelectNextTramo(nextTramos[tramoIndex]);
        }
      } else if (e.key.toLowerCase() === 'z' && e.ctrlKey) {
        e.preventDefault();
        handleUndoLastTramo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [creandoTrack, trackCurrentCruce, getNextAvailableTramos, handleSelectNextTramo, handleUndoLastTramo]);

  useEffect(() => {
    if (!crucesMode) {
      setCreandoTrack(false);
      setTrackStartCruce(null);
      setTrackCurrentCruce(null);
      setTrackTramos([]);
    }
  }, [crucesMode]);

  useEffect(() => {
    if (!map) return;
    setZoom(map.getZoom());
    const handleZoom = () => {
      setZoom(map.getZoom());
    };
    map.on('zoomend', handleZoom);
    return () => {
      map.off('zoomend', handleZoom);
    };
  }, [map]);

  const fetchCruces = useCallback(async () => {
    setLoadingCruces(true);
    try {
      const response = await axios.get('/api/cruces');
      if (response.data && response.data.features) {
        setCruces(response.data.features);
      }
    } catch (e) {
      console.error("Error al obtener cruces:", e);
    } finally {
      setLoadingCruces(false);
    }
  }, []);

  const handleMapAltClick = async (latlng) => {
    try {
      const response = await axios.post('/api/cruces', {
        lat: latlng.lat,
        lon: latlng.lng
      });
      if (response.data) {
        setCruces(prev => [...prev, response.data]);
      }
    } catch (e) {
      console.error("Error al guardar cruce:", e);
    }
  };

  const handleDeleteCruce = async (id) => {
    try {
      await axios.delete(`/api/cruces/${id}`);
      setCruces(prev => prev.filter(c => c.properties.id !== id));
      if (selectedCruce && selectedCruce.properties.id === id) {
        setSelectedCruce(null);
      }
    } catch (e) {
      console.error("Error al borrar cruce:", e);
    }
  };

  const handleExportCruces = () => {
    if (!map) return;
    const bounds = map.getBounds();
    const visibleCruces = cruces.filter(c => {
      if (!c.geometry || !c.geometry.coordinates) return false;
      const [lon, lat] = c.geometry.coordinates;
      return bounds.contains(L.latLng(lat, lon));
    });

    if (visibleCruces.length === 0) {
      alert("No hay cruces en la zona visible para exportar.");
      return;
    }

    const exportData = {
      type: "FeatureCollection",
      features: visibleCruces
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cruces_zona_${new Date().getTime()}.geojson`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportToMinisite = async () => {
    if (!map) return;
    const bounds = map.getBounds();
    
    // Filtrar cruces visibles
    const visibleCruces = cruces.filter(c => {
      if (!c.geometry || !c.geometry.coordinates) return false;
      const [lon, lat] = c.geometry.coordinates;
      return bounds.contains(L.latLng(lat, lon));
    });

    if (visibleCruces.length === 0) {
      alert("No hay cruces en la zona visible para exportar al minisite.");
      return;
    }

    // Filtrar tramos cuyos dos extremos (startId y endId) correspondan a cruces visibles.
    // Esto garantiza un conjunto cerrado de datos autocontenido para el minisite.
    const visibleCruceIds = new Set(visibleCruces.map(c => `cruce_${c.properties.id}`));
    const visibleTramos = tramos.filter(t => {
      return visibleCruceIds.has(t.startId) && visibleCruceIds.has(t.endId);
    });

    try {
      const response = await axios.post('/api/export-minisite', {
        cruces: visibleCruces,
        tramos: visibleTramos
      });
      if (response.data && response.data.status === 'success') {
        alert(`¡Minisite exportado con éxito!\n\nSe han guardado:\n- ${visibleCruces.length} cruces en /public/minisite_cruces.json\n- ${visibleTramos.length} tramos en /public/minisite_tramos.json\n\nEl minisite de la carpeta public usará directamente estos datos.`);
      }
    } catch (err) {
      console.error("Error al exportar a minisite:", err);
      alert("Ocurrió un error al guardar los archivos del minisite en el servidor.");
    }
  };

  const handleImportCruces = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.geojson,.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const geojson = JSON.parse(event.target.result);
          let pointsToImport = [];

          if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
            geojson.features.forEach(f => {
              if (f.geometry && f.geometry.type === 'Point' && Array.isArray(f.geometry.coordinates)) {
                const [lon, lat] = f.geometry.coordinates;
                pointsToImport.push({ lat, lon });
              }
            });
          } else if (geojson.type === 'Feature' && geojson.geometry && geojson.geometry.type === 'Point' && Array.isArray(geojson.geometry.coordinates)) {
            const [lon, lat] = geojson.geometry.coordinates;
            pointsToImport.push({ lat, lon });
          }

          if (pointsToImport.length === 0) {
            alert("No se encontraron puntos de cruces válidos en el archivo GeoJSON.");
            return;
          }

          const confirmImport = window.confirm(`¿Deseas importar ${pointsToImport.length} cruces desde el archivo?`);
          if (!confirmImport) return;

          const response = await axios.post('/api/cruces/bulk-import', { cruces: pointsToImport });
          if (response.data && response.data.status === 'success') {
            alert(`Importación completada.\nImportados: ${response.data.imported}\nOmitidos (ya existentes): ${response.data.skipped}`);
            fetchCruces(); // Recargar cruces
          }
        } catch (err) {
          console.error("Error al importar cruces:", err);
          alert("Error al procesar el archivo. Asegúrate de que sea un archivo GeoJSON válido.");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleDeleteCrucesZone = async () => {
    if (!map) return;
    const bounds = map.getBounds();
    
    const visibleCruces = cruces.filter(c => {
      if (!c.geometry || !c.geometry.coordinates) return false;
      const [lon, lat] = c.geometry.coordinates;
      return bounds.contains(L.latLng(lat, lon));
    });

    if (visibleCruces.length === 0) {
      alert("No hay cruces en la zona visible para borrar.");
      return;
    }

    const confirmDelete = window.confirm(`¿Estás SEGURO de que deseas borrar los ${visibleCruces.length} cruces de la zona visible del mapa? Esta acción no se puede deshacer.`);
    if (!confirmDelete) return;

    try {
      const response = await axios.post('/api/cruces/delete-zone', {
        min_lat: bounds.getSouth(),
        min_lon: bounds.getWest(),
        max_lat: bounds.getNorth(),
        max_lon: bounds.getEast()
      });

      if (response.data && response.data.status === 'success') {
        alert(`Se han borrado ${response.data.count} cruces de la zona.`);
        fetchCruces(); // Recargar cruces
      }
    } catch (err) {
      console.error("Error al borrar cruces de la zona:", err);
      alert("Ocurrió un error al borrar los cruces.");
    }
  };

  const handleLoadRandomRoute = async () => {
    let params = {};
    if (map) {
      const bounds = map.getBounds();
      params = {
        min_lat: bounds.getSouth(),
        min_lon: bounds.getWest(),
        max_lat: bounds.getNorth(),
        max_lon: bounds.getEast()
      };
    }
    try {
      const response = await axios.get('/api/activities/random', { params });
      if (response.data) {
        setRandomActivity(response.data);
      }
    } catch (e) {
      console.error("Error al cargar ruta al azar:", e);
      if (e.response && e.response.status === 404) {
        alert("No se encontraron rutas con inicio o fin en la zona delimitada de la pantalla.");
      } else {
        alert("No se pudo cargar una ruta al azar.");
      }
    }
  };

  // Carga inicial y limpieza de cruces al alternar el modo
  useEffect(() => {
    if (crucesMode) {
      fetchCruces();
      setRandomActivity(null);
      if (map) {
        setActivationBounds(map.getBounds());
      }
    } else {
      setCruces([]);
      setSelectedCruce(null);
      setRandomActivity(null);
      setActivationBounds(null);
    }
  }, [crucesMode, fetchCruces, map]);

  const calculateTramos = useCallback(() => {
    if (!crucesMode || !activities || activities.length === 0 || cruces.length === 0) {
      setTramos([]);
      return;
    }

    const influenceRadius = pointsParams.cruceInfluence || 25;
    const similarityTolerance = pointsParams.similarityTolerance || 25;

    // 1. Obtener la lista de todos los cruces con sus coordenadas Leaflet (filtrados por las zonas visibles en la activación)
    const crucesList = cruces
      .map(c => {
        const [cLon, cLat] = c.geometry.coordinates;
        return {
          id: c.properties.id,
          latlng: L.latLng(cLat, cLon),
          coords: [cLon, cLat] // [lon, lat]
        };
      })
      .filter(c => {
        if (!activationBounds) return true;
        return activationBounds.contains(c.latlng);
      });

    if (crucesList.length === 0) {
      setTramos([]);
      return;
    }

    // Filtrar actividades: sólo buscamos segmentos en las rutas que cruzan la zona visible en la activación
    const visibleActivities = activities.filter(act => {
      if (!activationBounds) return true;
      if (!act.points || act.points.length === 0) return false;
      return act.points.some(pt => {
        const latlng = L.latLng(pt[1], pt[0]);
        return activationBounds.contains(latlng);
      });
    });

    // 2. Para cada ruta visible, ajustar e insertar los cruces por los que pasa
    const adjustedRoutes = visibleActivities.map(act => {
      if (!act.points || act.points.length < 2) return { ...act, points: [] };

      // Copiamos los puntos originales de la actividad
      let currentPoints = [...act.points];

      // Aplicamos el algoritmo de inserción multipaso para cada cruce
      crucesList.forEach(cruce => {
        const cruceLatLng = cruce.latlng;
        const [cLon, cLat] = cruce.coords;

        // Identificar segmentos en influencia
        const segmentsInInfluence = [];
        for (let i = 0; i < currentPoints.length - 1; i++) {
          const pA = currentPoints[i];
          const pB = currentPoints[i + 1];

          const dx = pB[0] - pA[0];
          const dy = pB[1] - pA[1];
          const len2 = dx * dx + dy * dy;

          let t = 0;
          if (len2 > 0) {
            t = ((cLon - pA[0]) * dx + (cLat - pA[1]) * dy) / len2;
            t = Math.max(0, Math.min(1, t));
          }

          const projLon = pA[0] + t * dx;
          const projLat = pA[1] + t * dy;

          const projLatLng = L.latLng([projLat, projLon]);
          const dist = cruceLatLng.distanceTo(projLatLng);

          if (dist <= influenceRadius) {
            segmentsInInfluence.push({
              index: i,
              distance: dist
            });
          }
        }

        if (segmentsInInfluence.length > 0) {
          // Agrupar segmentos consecutivos en pases independientes
          const groups = [];
          let currentGroup = [];

          for (let i = 0; i < segmentsInInfluence.length; i++) {
            const currentItem = segmentsInInfluence[i];
            if (currentGroup.length === 0) {
              currentGroup.push(currentItem);
            } else {
              const lastItem = currentGroup[currentGroup.length - 1];
              if (currentItem.index - lastItem.index <= 2) {
                currentGroup.push(currentItem);
              } else {
                groups.push(currentGroup);
                currentGroup = [currentItem];
              }
            }
          }
          if (currentGroup.length > 0) {
            groups.push(currentGroup);
          }

          // Procesar cada pase
          const indicesToRemove = new Set();
          const replacements = new Map();
          const insertions = new Map();

          groups.forEach(group => {
            const minSegIndex = group[0].index;
            const maxSegIndex = group[group.length - 1].index;

            const verticesInPass = [];
            for (let idx = minSegIndex; idx <= maxSegIndex + 1; idx++) {
              if (idx >= currentPoints.length) continue;
              const pt = currentPoints[idx];
              const ptLatLng = L.latLng([pt[1], pt[0]]);
              const distance = cruceLatLng.distanceTo(ptLatLng);
              verticesInPass.push({
                index: idx,
                point: pt,
                distance: distance
              });
            }

            const interiorVertices = verticesInPass.filter(v => v.distance <= influenceRadius);

            if (interiorVertices.length > 0) {
              const sortedInteriors = [...interiorVertices].sort((a, b) => a.distance - b.distance);
              const keeper = sortedInteriors[0];

              replacements.set(keeper.index, [cLon, cLat]);

              for (let i = 1; i < sortedInteriors.length; i++) {
                indicesToRemove.add(sortedInteriors[i].index);
              }
            } else {
              const sortedSegments = [...group].sort((a, b) => a.distance - b.distance);
              const bestSeg = sortedSegments[0];

              insertions.set(bestSeg.index, [cLon, cLat]);
            }
          });

          // Reconstruir puntos de la actividad con este cruce insertado
          const nextPoints = [];
          for (let i = 0; i < currentPoints.length; i++) {
            if (indicesToRemove.has(i)) continue;
            if (replacements.has(i)) {
              nextPoints.push(replacements.get(i));
            } else {
              nextPoints.push(currentPoints[i]);
            }
            if (insertions.has(i)) {
              nextPoints.push(insertions.get(i));
            }
          }
          currentPoints = nextPoints;
        }
      });

      return {
        ...act,
        points: currentPoints
      };
    });

    // 3. Dividir cada ruta ajustada en sub-paths en las coordenadas de los cruces exactos
    const subPaths = [];

    adjustedRoutes.forEach(act => {
      if (act.points.length < 2) return;

      let currentSubPath = [act.points[0]];

      for (let i = 1; i < act.points.length; i++) {
        const pt = act.points[i];
        currentSubPath.push(pt);

        // ¿Es este punto un cruce?
        const matchedCruce = crucesList.find(c => {
          const threshold = 0.000001; // aprox. 11 cm
          return Math.abs(pt[0] - c.coords[0]) < threshold && Math.abs(pt[1] - c.coords[1]) < threshold;
        });

        if (matchedCruce) {
          // El punto actual es un cruce. Cerramos el sub-path actual y abrimos uno nuevo que comienza en este cruce
          if (currentSubPath.length >= 2) {
            subPaths.push({
              points: currentSubPath,
              activityId: act.id,
              activityName: act.name
            });
          }
          currentSubPath = [pt];
        }
      }

      // Si nos quedó un sub-path residual
      if (currentSubPath.length >= 2) {
        subPaths.push({
          points: currentSubPath,
          activityId: act.id,
          activityName: act.name
        });
      }
    });

    // 4. Agrupar los sub-paths por sus extremos (unordered endpoints)
    const getEndpointId = (pt) => {
      const matchedCruce = crucesList.find(c => {
        const dist = c.latlng.distanceTo(L.latLng(pt[1], pt[0]));
        return dist <= 5; // Tolerancia de 5 metros para ser considerado el cruce
      });
      if (matchedCruce) {
        return `cruce_${matchedCruce.id}`;
      }
      return `coord_${pt[0].toFixed(5)}_${pt[1].toFixed(5)}`;
    };

    // 5. Consolidar sub-paths en tramos distintos basados en la distancia de trayectoria (similitud)
    const finalTramos = [];

    // Función auxiliar para calcular la distancia máxima entre dos trayectorias
    const getTrajectoryDistance = (pathA, pathB) => {
      const latlngsA = pathA.map(p => L.latLng(p[1], p[0]));
      const latlngsB = pathB.map(p => L.latLng(p[1], p[0]));

      const startDistNormal = latlngsA[0].distanceTo(latlngsB[0]);
      const startDistInverted = latlngsA[0].distanceTo(latlngsB[latlngsB.length - 1]);
      let comparedB = latlngsB;
      if (startDistInverted < startDistNormal) {
        comparedB = [...latlngsB].reverse();
      }

      const K = 5;
      let maxDist = 0;

      for (let step = 0; step < K; step++) {
        const ratio = step / (K - 1);
        const idxA = Math.floor(ratio * (latlngsA.length - 1));
        const ptA = latlngsA[idxA];

        let minDistToB = Infinity;
        for (let j = 0; j < comparedB.length - 1; j++) {
          const segStart = comparedB[j];
          const segEnd = comparedB[j + 1];

          const dx = segEnd.lng - segStart.lng;
          const dy = segEnd.lat - segStart.lat;
          const len2 = dx * dx + dy * dy;
          let t = 0;
          if (len2 > 0) {
            t = ((ptA.lng - segStart.lng) * dx + (ptA.lat - segStart.lat) * dy) / len2;
            t = Math.max(0, Math.min(1, t));
          }
          const projLon = segStart.lng + t * dx;
          const projLat = segStart.lat + t * dy;
          const dist = ptA.distanceTo(L.latLng(projLat, projLon));

          if (dist < minDistToB) {
            minDistToB = dist;
          }
        }
        if (minDistToB > maxDist) {
          maxDist = minDistToB;
        }
      }

      for (let step = 0; step < K; step++) {
        const ratio = step / (K - 1);
        const idxB = Math.floor(ratio * (comparedB.length - 1));
        const ptB = comparedB[idxB];

        let minDistToA = Infinity;
        for (let j = 0; j < latlngsA.length - 1; j++) {
          const segStart = latlngsA[j];
          const segEnd = latlngsA[j + 1];

          const dx = segEnd.lng - segStart.lng;
          const dy = segEnd.lat - segStart.lat;
          const len2 = dx * dx + dy * dy;
          let t = 0;
          if (len2 > 0) {
            t = ((ptB.lng - segStart.lng) * dx + (ptB.lat - segStart.lat) * dy) / len2;
            t = Math.max(0, Math.min(1, t));
          }
          const projLon = segStart.lng + t * dx;
          const projLat = segStart.lat + t * dy;
          const dist = ptB.distanceTo(L.latLng(projLat, projLon));

          if (dist < minDistToA) {
            minDistToA = dist;
          }
        }
        if (minDistToA > maxDist) {
          maxDist = minDistToA;
        }
      }

      return maxDist;
    };

    // Filtrar sub-paths: deben empezar y terminar en cruces físicos y no ser el mismo cruce
    const validSubPaths = [];
    subPaths.forEach(sp => {
      const startId = getEndpointId(sp.points[0]);
      const endId = getEndpointId(sp.points[sp.points.length - 1]);

      if (startId.startsWith('cruce_') && endId.startsWith('cruce_') && startId !== endId) {
        validSubPaths.push({
          ...sp,
          startId,
          endId
        });
      }
    });

    // Consolidación espacial global sin agrupar por claves estrictas de extremos
    validSubPaths.forEach(sp => {
      let isSimilar = false;
      for (let i = 0; i < finalTramos.length; i++) {
        const existing = finalTramos[i];
        const trajDist = getTrajectoryDistance(sp.points, existing.points);
        if (trajDist <= similarityTolerance) {
          isSimilar = true;
          existing.activityNames.add(sp.activityName);
          existing.count += 1;
          // Conservar la trayectoria con más puntos para mayor fidelidad de renderizado
          if (sp.points.length > existing.points.length) {
            existing.points = sp.points;
          }
          break;
        }
      }

      if (!isSimilar) {
        finalTramos.push({
          id: `tramo_${finalTramos.length}`,
          points: sp.points,
          startId: sp.startId,
          endId: sp.endId,
          activityNames: new Set([sp.activityName]),
          count: 1
        });
      }
    });

    setTramos(finalTramos);
  }, [crucesMode, activities, cruces, pointsParams.cruceInfluence, pointsParams.similarityTolerance, activationBounds]);

  useEffect(() => {
    if (crucesMode) {
      calculateTramos();
    } else {
      setTramos([]);
    }
  }, [crucesMode, activities, cruces, pointsParams.cruceInfluence, pointsParams.similarityTolerance, calculateTramos, activationBounds]);


  return (
    <div
      style={{ height: '100%', width: '100%', position: 'relative', backgroundColor: '#ffffff' }}
    >
      {/* Indicador de modo activo y botón de ajustes (Cruces Mode) */}
      <div 
        style={{ 
          position: 'absolute', 
          top: '1rem', 
          right: '1rem', 
          zIndex: 1005, 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'flex-end', 
          gap: '0.5rem' 
        }}
      >
        {/* Badge superior consolidado */}
        <div 
          style={{ 
            backgroundColor: 'rgba(255, 255, 255, 0.95)', 
            backdropFilter: 'blur(12px)', 
            WebkitBackdropFilter: 'blur(12px)',
            padding: '0.5rem 1rem', 
            borderRadius: '9999px', 
            border: '1px solid #e2e8f0', 
            fontSize: '0.75rem', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.75rem', 
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)' 
          }}
        >
          <div 
            style={{ 
              width: '0.5rem', 
              height: '0.5rem', 
              borderRadius: '9999px', 
              backgroundColor: crucesMode ? '#10b981' : '#FC4C02'
            }} 
          />
          <span style={{ fontWeight: 600, color: '#334155' }}>
            {crucesMode
              ? `Modo Cruces (${cruces.length} Cruces, ${tramos.length} Tramos)`
              : (activities.length > 0 ? `Visualizando ${activities.length} recorridos` : 'Cargando...')}
          </span>
          {crucesMode && (
            <>
              <div style={{ width: '1px', height: '0.75rem', backgroundColor: '#e2e8f0' }}></div>
              <button 
                onClick={() => {
                  setShowSettings(!showSettings);
                  if (creandoTrack) {
                    setCreandoTrack(false);
                    setTrackStartCruce(null);
                    setTrackCurrentCruce(null);
                    setTrackTramos([]);
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '0.25rem',
                  fontWeight: 900,
                  textTransform: 'uppercase',
                  fontSize: '10px',
                  cursor: 'pointer',
                  border: '1px solid #e2e8f0',
                  backgroundColor: showSettings ? '#eef2ff' : '#f8fafc',
                  color: showSettings ? '#4f46e5' : '#64748b',
                  transition: 'all 0.2s'
                }}
              >
                <Settings size={12} style={{ transform: showSettings ? 'rotate(45deg)' : 'none', transition: 'transform 0.3s' }} />
                Ajustar
              </button>

              <div style={{ width: '1px', height: '0.75rem', backgroundColor: '#e2e8f0' }}></div>
              <button 
                onClick={() => {
                  if (creandoTrack) {
                    // Salir del modo creación
                    setCreandoTrack(false);
                    setTrackStartCruce(null);
                    setTrackCurrentCruce(null);
                    setTrackTramos([]);
                  } else {
                    // Entrar en modo creación
                    setCreandoTrack(true);
                    setTrackStartCruce(null);
                    setTrackCurrentCruce(null);
                    setTrackTramos([]);
                    setShowSettings(false); // Ocultar ajustes para despejar vista
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '0.25rem',
                  fontWeight: 900,
                  textTransform: 'uppercase',
                  fontSize: '10px',
                  cursor: 'pointer',
                  border: '1px solid ' + (creandoTrack ? '#fda4af' : '#e2e8f0'),
                  backgroundColor: creandoTrack ? '#ffe4e6' : '#f8fafc',
                  color: creandoTrack ? '#e11d48' : '#64748b',
                  transition: 'all 0.2s'
                }}
              >
                <Plus size={12} style={{ transform: creandoTrack ? 'rotate(45deg)' : 'none', transition: 'transform 0.3s' }} />
                {creandoTrack ? 'Cancelar Track' : 'Crear Track'}
              </button>
            </>
          )}
        </div>

        {/* Tarjeta de Ajustes de Parámetros en Modo Cruces */}
        {crucesMode && showSettings && (
          <div 
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '1rem',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              border: '1px solid #f1f5f9',
              padding: '1.25rem',
              width: '20rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem'
            }}
          >
            <h4 style={{ margin: 0, fontWeight: 900, fontSize: '0.75rem', color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              <Sliders size={13} style={{ color: '#10b981' }} />
              Ajustes de Cruces
            </h4>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Tamaño Punto */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', color: '#94a3b8' }}>
                  <span>Tamaño Punto (% Pantalla)</span>
                  <input 
                    type="number" step="0.05" min="0.01"
                    value={pointsParams.pointSizePercent}
                    onChange={(e) => setPointsParams(prev => ({ ...prev, pointSizePercent: parseFloat(e.target.value) || 0.01 }))}
                    style={{ width: '4rem', textAlign: 'right', fontSize: '11px', fontFamily: 'monospace', padding: '0.125rem', border: '1px solid #e2e8f0', borderRadius: '0.25rem' }}
                  />
                </div>
                <span style={{ fontSize: '9px', color: '#94a3b8', fontWeight: 500, lineHeight: 1.25 }}>Radio de visualización de los cruces. Crece/encoge con el zoom.</span>
              </div>

              {/* Influencia del Cruce */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', color: '#94a3b8' }}>
                  <span>Influencia (Metros)</span>
                  <input 
                    type="number" step="5" min="1"
                    value={pointsParams.cruceInfluence || 25}
                    onChange={(e) => setPointsParams(prev => ({ ...prev, cruceInfluence: parseInt(e.target.value, 10) || 1 }))}
                    style={{ width: '4rem', textAlign: 'right', fontSize: '11px', fontFamily: 'monospace', padding: '0.125rem', border: '1px solid #e2e8f0', borderRadius: '0.25rem' }}
                  />
                </div>
                <span style={{ fontSize: '9px', color: '#94a3b8', fontWeight: 500, lineHeight: 1.25 }}>Radio de la aureola de influencia física del cruce en metros.</span>
              </div>

              {/* Tolerancia Similitud */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', color: '#94a3b8' }}>
                  <span>Tolerancia Similitud (Metros)</span>
                  <input 
                    type="number" step="5" min="1"
                    value={pointsParams.similarityTolerance || 25}
                    onChange={(e) => setPointsParams(prev => ({ ...prev, similarityTolerance: parseInt(e.target.value, 10) || 1 }))}
                    style={{ width: '4rem', textAlign: 'right', fontSize: '11px', fontFamily: 'monospace', padding: '0.125rem', border: '1px solid #e2e8f0', borderRadius: '0.25rem' }}
                  />
                </div>
                <span style={{ fontSize: '9px', color: '#94a3b8', fontWeight: 500, lineHeight: 1.25 }}>Desviación máxima en metros para fundir caminos parecidos en un solo tramo.</span>
              </div>

              {/* Botón para Cargar Ruta al Azar */}
              <button
                onClick={handleLoadRandomRoute}
                style={{
                  width: '100%',
                  marginTop: '0.5rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  padding: '0.625rem',
                  backgroundColor: '#10b981',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '0.5rem',
                  fontSize: '11px',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.025em',
                  cursor: 'pointer',
                  boxShadow: '0 4px 6px -1px rgba(16, 185, 129, 0.3)',
                  transition: 'all 0.2s'
                }}
              >
                <RefreshCw size={12} />
                Mostrar Ruta al Azar
              </button>

              {randomActivity && (
                <div style={{ backgroundColor: '#f8fafc', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #e2e8f0', marginTop: '0.25rem' }}>
                  <div style={{ fontSize: '8px', fontWeight: 900, textTransform: 'uppercase', color: '#94a3b8', marginBottom: '0.25rem' }}>Ruta Cargada</div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{randomActivity.name}</div>
                  <div style={{ fontSize: '9px', color: '#64748b', marginTop: '0.125rem' }}>{(randomActivity.distance / 1000).toFixed(2)} km</div>
                </div>
              )}

              {/* Divisor estético */}
              <div style={{ height: '1px', backgroundColor: '#f1f5f9', margin: '0.25rem 0' }}></div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ fontSize: '8px', fontWeight: 900, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em' }}>Acciones de Zona</div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  {/* Exportar Cruces */}
                  <button
                    onClick={handleExportCruces}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.375rem',
                      padding: '0.5rem',
                      backgroundColor: '#ecfdf5',
                      border: '1px solid #a7f3d0',
                      borderRadius: '0.5rem',
                      fontSize: '10px',
                      fontWeight: 800,
                      color: '#047857',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    title="Exportar cruces visibles de la zona en formato GeoJSON"
                  >
                    <Download size={11} />
                    Exportar
                  </button>

                  {/* Importar Cruces */}
                  <button
                    onClick={handleImportCruces}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.375rem',
                      padding: '0.5rem',
                      backgroundColor: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      borderRadius: '0.5rem',
                      fontSize: '10px',
                      fontWeight: 800,
                      color: '#1d4ed8',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    title="Importar cruces desde un archivo GeoJSON (.geojson o .json)"
                  >
                    <Upload size={11} />
                    Importar
                  </button>
                </div>

                {/* Borrar Cruces de la Zona */}
                <button
                  onClick={handleDeleteCrucesZone}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.375rem',
                    padding: '0.5rem',
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '0.5rem',
                    fontSize: '10px',
                    fontWeight: 800,
                    color: '#b91c1c',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  title="Borrar todos los cruces visibles de la zona"
                >
                  <Trash2 size={11} />
                  Borrar Zona
                </button>

                {/* Exportar a minisite */}
                <button
                  onClick={handleExportToMinisite}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.375rem',
                    padding: '0.5rem',
                    backgroundColor: '#e0f2fe',
                    border: '1px solid #bae6fd',
                    borderRadius: '0.5rem',
                    fontSize: '10px',
                    fontWeight: 800,
                    color: '#0369a1',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    marginTop: '0.25rem'
                  }}
                  title="Exportar cruces y segmentos visibles de esta zona al minisite estático"
                >
                  <Share2 size={11} />
                  Exportar a minisite
                </button>
              </div>
            </div>
          </div>
        )}

        {crucesMode && creandoTrack && (
          <div 
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '1rem',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              border: '1px solid #f1f5f9',
              padding: '1.25rem',
              width: '20rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              fontFamily: 'sans-serif'
            }}
          >
            <h4 style={{ margin: 0, fontWeight: 900, fontSize: '0.75rem', color: '#8b5cf6', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#8b5cf6' }}></span>
              Creador de Track
            </h4>

            {/* Paso 1: Seleccionar inicio */}
            {!trackStartCruce ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <p style={{ margin: 0, fontSize: '11px', color: '#475569', fontWeight: 700 }}>
                  👉 Paso 1: Selecciona un cruce de partida en el mapa.
                </p>
                <span style={{ fontSize: '9px', color: '#94a3b8', lineHeight: 1.3 }}>
                  Haz clic sobre cualquiera de los círculos verdes en el mapa para iniciar la ruta desde ese punto.
                </span>
              </div>
            ) : (
              // Paso 2: Ir seleccionando tramos
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ fontSize: '10px', color: '#64748b', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <div>
                    <span style={{ fontWeight: 600, color: '#475569' }}>Inicio: </span>
                    <span style={{ color: '#10b981', fontWeight: 700 }}>Cruce #{trackStartCruce.properties.id}</span>
                  </div>
                  <div>
                    <span style={{ fontWeight: 600, color: '#475569' }}>Extremo: </span>
                    <span style={{ color: '#3b82f6', fontWeight: 700 }}>Cruce #{trackCurrentCruce.properties.id}</span>
                  </div>
                  <div>
                    <span style={{ fontWeight: 600, color: '#475569' }}>Track: </span>
                    <span style={{ color: '#1e293b', fontWeight: 800 }}>
                      {trackTramos.length} {trackTramos.length === 1 ? 'segmento' : 'segmentos'} (
                      {(trackTramos.reduce((sum, item) => {
                        let d = 0;
                        for (let i = 0; i < item.tramo.points.length - 1; i++) {
                          const pt1 = item.tramo.points[i];
                          const pt2 = item.tramo.points[i+1];
                          d += L.latLng(pt1[1], pt1[0]).distanceTo(L.latLng(pt2[1], pt2[0]));
                        }
                        return sum + d;
                      }, 0) / 1000).toFixed(2)} km)
                    </span>
                  </div>
                </div>

                {/* Siguientes Opciones de Segmento */}
                <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '0.625rem' }}>
                  <span style={{ display: 'block', fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', color: '#94a3b8', marginBottom: '0.375rem' }}>
                    Segmentos Disponibles:
                  </span>
                  
                  {getNextAvailableTramos().length === 0 ? (
                    <div style={{ fontSize: '10px', color: '#ef4444', fontStyle: 'italic', padding: '0.25rem 0' }}>
                      ⚠️ No hay más tramos que partan de este cruce.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', maxHeight: '110px', overflowY: 'auto', paddingRight: '0.25rem' }}>
                      {getNextAvailableTramos().map((tr, index) => {
                        const num = index + 1;
                        const otherCruceId = tr.startId === `cruce_${trackCurrentCruce.properties.id}` ? tr.endId : tr.startId;
                        const otherCruceNum = otherCruceId.replace('cruce_', '#');
                        
                        // Calcular distancia del tramo
                        let d = 0;
                        for (let i = 0; i < tr.points.length - 1; i++) {
                          d += L.latLng(tr.points[i][1], tr.points[i][0]).distanceTo(L.latLng(tr.points[i+1][1], tr.points[i+1][0]));
                        }
                        const distStr = d < 1000 ? `${Math.round(d)} m` : `${(d/1000).toFixed(2)} km`;

                        return (
                          <button
                            key={`btn_tramo_${tr.id}`}
                            onClick={() => handleSelectNextTramo(tr)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              width: '100%',
                              padding: '0.375rem 0.5rem',
                              backgroundColor: '#f8fafc',
                              border: '1px solid #e2e8f0',
                              borderRadius: '0.375rem',
                              fontSize: '10px',
                              fontWeight: 600,
                              color: '#334155',
                              cursor: 'pointer',
                              textAlign: 'left',
                              transition: 'all 0.15s'
                            }}
                            onMouseOver={(e) => {
                              e.currentTarget.style.backgroundColor = '#f5f3ff';
                              e.currentTarget.style.borderColor = '#ddd6fe';
                            }}
                            onMouseOut={(e) => {
                              e.currentTarget.style.backgroundColor = '#f8fafc';
                              e.currentTarget.style.borderColor = '#e2e8f0';
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                              <span style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center', 
                                width: '15px', 
                                height: '15px', 
                                borderRadius: '50%', 
                                backgroundColor: '#8b5cf6', 
                                color: '#ffffff', 
                                fontSize: '9px', 
                                fontWeight: 800 
                              }}>{num}</span>
                              <span>Hacia Cruce {otherCruceNum}</span>
                            </div>
                            <span style={{ color: '#64748b', fontWeight: 500 }}>{distStr}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Acciones del Track */}
                <div style={{ display: 'flex', gap: '0.375rem', marginTop: '0.25rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.625rem' }}>
                  <button
                    onClick={handleUndoLastTramo}
                    disabled={trackTramos.length === 0}
                    style={{
                      flex: 1,
                      padding: '0.375rem',
                      fontSize: '9px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      backgroundColor: '#f1f5f9',
                      color: trackTramos.length === 0 ? '#cbd5e1' : '#475569',
                      border: '1px solid #e2e8f0',
                      borderRadius: '0.375rem',
                      cursor: trackTramos.length === 0 ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    Deshacer
                  </button>

                  <button
                    onClick={handleExportTrackGPX}
                    disabled={trackTramos.length === 0}
                    style={{
                      flex: 1,
                      padding: '0.375rem',
                      fontSize: '9px',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      backgroundColor: trackTramos.length === 0 ? '#cbd5e1' : '#3b82f6',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '0.375rem',
                      cursor: trackTramos.length === 0 ? 'not-allowed' : 'pointer',
                      boxShadow: trackTramos.length === 0 ? 'none' : '0 4px 6px -1px rgba(59, 130, 246, 0.3)',
                      transition: 'all 0.15s'
                    }}
                  >
                    GPX
                  </button>
                  
                  <button
                    onClick={() => {
                      setTrackStartCruce(null);
                      setTrackCurrentCruce(null);
                      setTrackTramos([]);
                    }}
                    style={{
                      padding: '0.375rem 0.5rem',
                      fontSize: '9px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      backgroundColor: '#fffbeb',
                      color: '#d97706',
                      border: '1px solid #fde68a',
                      borderRadius: '0.375rem',
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    Reiniciar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cartel informativo del modo cruces si no hay cruces */}
      {crucesMode && cruces.length === 0 && (
        <div 
          style={{ 
            zIndex: 1000, 
            position: 'absolute', 
            top: '4.5rem', 
            left: '50%', 
            transform: 'translateX(-50%)', 
            backgroundColor: 'rgba(16, 185, 129, 0.9)', 
            backdropFilter: 'blur(8px)', 
            color: '#ffffff', 
            fontSize: '0.75rem', 
            fontWeight: 'bold', 
            padding: '0.625rem 1.25rem', 
            borderRadius: '9999px', 
            boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.5rem', 
            border: '1px solid rgba(255,255,255,0.2)',
            pointerEvents: 'none'
          }}
        >
          <Info size={14} />
          Usa Ctrl + Click en el mapa para añadir cruces manuales
        </div>
      )}

      {/* Botones de zoom flotantes con el valor del zoom */}
      {map && (
        <div
          style={{
            position: 'absolute',
            left: '1.25rem',
            top: '1.25rem',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.375rem',
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            padding: '0.375rem',
            borderRadius: '0.75rem',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            border: '1px solid #e2e8f0'
          }}
        >
          {/* Botón Zoom In */}
          <button
            onClick={() => map.zoomIn()}
            style={{
              width: '2rem',
              height: '2rem',
              borderRadius: '0.5rem',
              border: 'none',
              backgroundColor: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#334155',
              transition: 'all 0.15s'
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            title="Acercar"
          >
            <Plus size={15} strokeWidth={3} />
          </button>

          {/* Valor de Zoom */}
          <div
            style={{
              fontSize: '11px',
              fontWeight: 900,
              color: '#FC4C02', // Color Strava
              fontFamily: 'monospace',
              userSelect: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0.25rem 0',
              borderTop: '1px solid #f1f5f9',
              borderBottom: '1px solid #f1f5f9',
              width: '100%'
            }}
          >
            <span style={{ fontSize: '7px', color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase', lineHeight: 1, marginBottom: '2px' }}>Zoom</span>
            <span style={{ fontSize: '13px', lineHeight: 1 }}>{zoom}</span>
          </div>

          {/* Botón Zoom Out */}
          <button
            onClick={() => map.zoomOut()}
            style={{
              width: '2rem',
              height: '2rem',
              borderRadius: '0.5rem',
              border: 'none',
              backgroundColor: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#334155',
              transition: 'all 0.15s'
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            title="Alejar"
          >
            <Minus size={15} strokeWidth={3} />
          </button>
        </div>
      )}

      <MapContainer
        center={[40.4168, -3.7038]}
        zoom={6}
        zoomControl={false}
        scrollWheelZoom={true}
        zoomSnap={1}
        zoomDelta={1}
        wheelPxPerZoomLevel={120}
        preferCanvas={true}
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
        
        <RouteLines 
          activities={activities} 
          crucesMode={crucesMode}
          randomActivity={randomActivity}
        />
        <CrucesLayer 
          crucesMode={crucesMode}
          pointsParams={pointsParams}
          cruces={cruces}
          setCruces={setCruces}
          selectedCruce={selectedCruce}
          setSelectedCruce={setSelectedCruce}
          onDeleteCruce={handleDeleteCruce}
          randomActivity={randomActivity}
          setRandomActivity={setRandomActivity}
          zoom={zoom}
          creandoTrack={creandoTrack}
          trackStartCruce={trackStartCruce}
          setTrackStartCruce={setTrackStartCruce}
          trackCurrentCruce={trackCurrentCruce}
          setTrackCurrentCruce={setTrackCurrentCruce}
          setTrackTramos={setTrackTramos}
          tramos={tramos}
        />
        <TramosLayer 
          tramos={tramos}
          crucesMode={crucesMode}
          creandoTrack={creandoTrack}
        />
        <TrackCreatorLayer
          creandoTrack={creandoTrack}
          trackStartCruce={trackStartCruce}
          trackCurrentCruce={trackCurrentCruce}
          trackTramos={trackTramos}
          tramos={tramos}
          onSelectTramo={handleSelectNextTramo}
          getTrackCoordinates={getTrackCoordinates}
          getNextAvailableTramos={getNextAvailableTramos}
          getEquidistantPoint={getEquidistantPoint}
        />
        
        <AutoCenter activities={activities} />
        <MapClickListener 
          crucesMode={crucesMode}
          onMapAltClick={handleMapAltClick}
        />
        <MapReferenceTracker setMap={setMap} />
        <ViewportPersister />
      </MapContainer>

      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    </div>
  );
};

export default MapView;

