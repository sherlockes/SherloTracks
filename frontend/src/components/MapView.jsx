import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, useMap, Polyline, LayersControl, Popup, Circle, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import { Download, Trash2, Info, Settings, Sliders, RefreshCw, MapPin, Undo, Plus } from 'lucide-react';

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
const RouteLines = ({ activities, segmentMode, pointsMode }) => {
  if (!activities || activities.length === 0 || segmentMode || pointsMode) return null;

  return (
    <>
      {activities.map((act) => {
        if (!act.points || act.points.length < 2) return null;

        // Convertimos [lon, lat] del backend a [lat, lon] de Leaflet
        const path = act.points.map(p => [p[1], p[0]]);

        return <RouteLine key={act.id} act={act} path={path} dimmed={segmentMode} />;
      })}
    </>
  );
};

// Capa para gestionar y renderizar los segmentos interactivos en tiempo real
const SegmentsLayer = ({ segmentMode, selectedSegments, setSelectedSegments, activities, segmentParams, recalculateTrigger }) => {
  const map = useMap();
  const [segments, setSegments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  // Simulación estética del avance para la barra de progreso
  useEffect(() => {
    let interval;
    if (loading) {
      setProgress(5);
      interval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 95) return prev;
          // Reduce el ritmo de crecimiento a medida que se acerca al final
          const diff = 95 - prev;
          const step = Math.max(1, Math.floor(diff * 0.12));
          return prev + step;
        });
      }, 250);
    } else {
      if (progress > 0) {
        setProgress(100);
        const timer = setTimeout(() => setProgress(0), 500);
        return () => clearTimeout(timer);
      }
    }
    return () => clearInterval(interval);
  }, [loading]);

  // Usamos refs para leer siempre el estado más reciente sin provocar ejecuciones redundantes en los efectos
  const activitiesRef = React.useRef(activities);
  const paramsRef = React.useRef(segmentParams);

  // Actualización SÍNCRONA instantánea en el cuerpo de renderización.
  // Esto erradica cualquier posibilidad de desincronización del Scheduler de React.
  paramsRef.current = segmentParams;
  activitiesRef.current = activities;

  // Control de estado anterior para ejecutar el recálculo exclusivamente al entrar al modo o pulsar el botón
  const prevSegmentModeRef = React.useRef(segmentMode);
  const prevRecalculateTriggerRef = React.useRef(recalculateTrigger);

  useEffect(() => {
    // Si el modo se apaga, limpiamos segmentos visuales, seleccionados y salimos
    if (!segmentMode) {
      setSegments([]);
      setSelectedSegments([]);
      prevSegmentModeRef.current = segmentMode;
      return;
    }

    // 1. Detección estricta de disparadores:
    // - Cambio de desactivado a activado del modo (entra al modo)
    // - Cambio del trigger de recálculo (pulsado de botón específico)
    const isEnteringMode = !prevSegmentModeRef.current && segmentMode;
    const isButtonClicked = recalculateTrigger !== prevRecalculateTriggerRef.current;

    if (isEnteringMode || isButtonClicked) {
      console.log(`[SegmentsLayer] Disparando recálculo. Razón: ${isEnteringMode ? 'Entrada a Modo' : 'Botón Presionado'}`);

      const fetchSegments = async () => {
        if (!activitiesRef.current || activitiesRef.current.length === 0) {
          setSegments([]);
          return;
        }

        // 2. REGLA: Al recalcular se eliminan PRIMERO todos los segmentos cargados anteriormente
        setSegments([]);
        
        // Es aconsejable resetear también la selección pues los IDs de topología cambiarán con nuevos parámetros
        setSelectedSegments([]);

        const bounds = map.getBounds();
        setLoading(true);
        try {
          const response = await axios.post(`/api/activities/segments`, {
            min_lat: bounds.getSouth(),
            min_lon: bounds.getWest(),
            max_lat: bounds.getNorth(),
            max_lon: bounds.getEast(),
            activity_ids: activitiesRef.current.map(a => a.id),
            simplify_tolerance: paramsRef.current.simplifyTolerance / 111111.0,
            snap_tolerance: paramsRef.current.snapTolerance / 111111.0,
            min_length: paramsRef.current.minLength / 111111.0,
            intersection_tolerance: paramsRef.current.intersectionTolerance / 111111.0
          });
          if (response.data && response.data.features) {
            setSegments(response.data.features);
          }
        } catch (e) {
          console.error("[SegmentsLayer] Error al obtener segmentos:", e);
        } finally {
          setLoading(false);
        }
      };

      fetchSegments();
    }

    // Sincronizamos los refs de control para el siguiente ciclo
    prevSegmentModeRef.current = segmentMode;
    prevRecalculateTriggerRef.current = recalculateTrigger;
  }, [segmentMode, recalculateTrigger, map, setSelectedSegments]);

  if (!segmentMode) return null;

  const toggleSegment = (feature) => {
    const isSelected = selectedSegments.some(s => s.id === feature.id);
    if (isSelected) {
      setSelectedSegments(selectedSegments.filter(s => s.id !== feature.id));
    } else {
      setSelectedSegments([...selectedSegments, feature]);
    }
  };

  return (
    <>
      {/* Indicador flotante de carga premium con barra de progreso estética de alto contraste */}
      {(loading || progress > 0) && (
        <div 
          style={{ 
            position: 'absolute', 
            top: '24px', 
            left: '50%', 
            transform: 'translateX(-50%)',
            zIndex: 1000,
            pointerEvents: 'none'
          }}
          className="transition-all duration-300"
        >
          <div 
            style={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(30, 41, 59, 1)', color: '#f8fafc' }}
            className="px-6 py-3 rounded-xl shadow-2xl flex flex-col gap-2.5 min-w-[280px] backdrop-blur-md"
          >
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <div className="w-3.5 h-3.5 border-[2.5px] border-emerald-400 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-xs font-bold tracking-wide">Procesando caminos visibles</span>
              </div>
              <span className="text-[10px] font-black text-emerald-400 tracking-widest">{Math.round(progress)}%</span>
            </div>
            
            {/* Barra de progreso estética */}
            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden border border-slate-700/30">
              <div 
                className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-full transition-all duration-300 ease-out" 
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {segments.map((f, i) => {
        if (!f.geometry || !f.geometry.coordinates) return null;
        
        // Convertir GeoJSON [lon, lat] a Leaflet [lat, lon]
        const positions = f.geometry.coordinates.map(p => [p[1], p[0]]);
        const isSelected = selectedSegments.some(s => s.id === f.id);
        
        return (
          <Polyline
            key={`${f.id}_${isSelected}`}
            positions={positions}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e);
                toggleSegment(f);
              }
            }}
            pathOptions={{
              color: isSelected ? '#10b981' : '#4f46e5', // Esmeralda si está seleccionado, Índigo si no
              weight: isSelected ? 6 : 3.5,
              opacity: isSelected ? 1.0 : 0.55,
              lineJoin: 'round',
              dashArray: isSelected ? null : '5, 8' // Línea discontinua para tramos seleccionables
            }}
            interactive={true}
          />
        );
      })}
    </>
  );
};

// Capa para gestionar y renderizar los puntos agrupados por cuadrícula
const PointsLayer = ({ 
  pointsMode, 
  pointsParams, 
  recalculateTrigger, 
  points, 
  setPoints,
  isCreatingTrack,
  customTrack,
  proposedPoints,
  onPointClick
}) => {
  const map = useMap();
  const [loading, setLoading] = useState(false);
  const [calculatedRadius, setCalculatedRadius] = useState(10); // metros

  const paramsRef = React.useRef(pointsParams);
  paramsRef.current = pointsParams;

  const prevPointsModeRef = React.useRef(pointsMode);
  const prevRecalculateTriggerRef = React.useRef(recalculateTrigger);

  useEffect(() => {
    if (!pointsMode) {
      setPoints([]);
      prevPointsModeRef.current = pointsMode;
      return;
    }

    const isEnteringMode = !prevPointsModeRef.current && pointsMode;
    const isButtonClicked = recalculateTrigger !== prevRecalculateTriggerRef.current;

    if (isEnteringMode || isButtonClicked) {
      const fetchPoints = async () => {
        setPoints([]);
        const bounds = map.getBounds();
        setLoading(true);

        // Recalcular el radio geográfico en metros basándonos en el ancho visible y el % actual.
        // Leaflet reescalará visualmente el círculo en pantalla al hacer zoom manteniendo estos metros.
        const width = map.distance(bounds.getSouthWest(), bounds.getSouthEast());
        const radius = width * (paramsRef.current.pointSizePercent / 100);
        setCalculatedRadius(radius);

        try {
          const response = await axios.post(`/api/activities/points`, {
            min_lat: bounds.getSouth(),
            min_lon: bounds.getWest(),
            max_lat: bounds.getNorth(),
            max_lon: bounds.getEast(),
            max_months: paramsRef.current.maxMonths,
            grid_size: paramsRef.current.gridSize
          });
          if (response.data && response.data.features) {
            setPoints(response.data.features);
          }
        } catch (e) {
          console.error("[PointsLayer] Error al obtener puntos:", e);
        } finally {
          setLoading(false);
        }
      };

      fetchPoints();
    }

    prevPointsModeRef.current = pointsMode;
    prevRecalculateTriggerRef.current = recalculateTrigger;
  }, [pointsMode, recalculateTrigger, map]);

  // Actualizar reactivamente el radio en metros al cambiar el %, entrar al modo o realizar un cambio de zoom en el mapa
  useEffect(() => {
    if (!pointsMode || !map) return;

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

    // Escuchar específicamente el evento de fin de zoom para recalcular la métrica
    map.on('zoomend', updateRadius);
    
    return () => {
      map.off('zoomend', updateRadius);
    };
  }, [pointsParams.pointSizePercent, pointsMode, map]);

  if (!pointsMode) return null;

  return (
    <>
      <style>{`
        .custom-proposal-tooltip {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          padding: 0 !important;
        }
        .custom-proposal-tooltip::before {
          display: none !important;
        }
        .leaflet-interactive-point {
          cursor: pointer !important;
        }
      `}</style>

      {loading && (
        <div 
          style={{ 
            position: 'absolute', 
            top: '24px', 
            left: '50%', 
            transform: 'translateX(-50%)',
            zIndex: 1000,
            pointerEvents: 'none'
          }}
        >
          <div 
            style={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(30, 41, 59, 1)', color: '#f8fafc' }}
            className="px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 backdrop-blur-md"
          >
            <div className="w-3.5 h-3.5 border-[2.5px] border-amber-400 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-xs font-bold tracking-wide">Cargando puntos de tracks</span>
          </div>
        </div>
      )}

      {points.map((f, i) => {
        if (!f.geometry || !f.geometry.coordinates) return null;
        
        const position = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
        
        const coordStr = f.geometry.coordinates.join(',');
        const isProposed = proposedPoints && proposedPoints.find(p => p.geometry.coordinates.join(',') === coordStr);
        const isUsed = customTrack && customTrack.some(p => p.geometry.coordinates.join(',') === coordStr);
        
        let fillColor = '#f59e0b';
        let color = '#d97706';
        let radius = calculatedRadius;
        let fillOpacity = paramsRef.current.pointOpacity !== undefined ? paramsRef.current.pointOpacity / 100 : 0.5;
        
        if (isProposed) {
          fillColor = '#4f46e5'; // Indigo
          color = '#3730a3';
          radius = calculatedRadius * 1.3;
          fillOpacity = 0.9;
        } else if (isUsed) {
          fillColor = '#10b981'; // Esmeralda
          color = '#047857';
          fillOpacity = 0.8;
        }

        return (
          <Circle
            key={`pt_${coordStr}_${isCreatingTrack}`}
            center={position}
            radius={radius}
            eventHandlers={{
              click: (e) => {
                if (isCreatingTrack && onPointClick) {
                  L.DomEvent.stopPropagation(e);
                  onPointClick(f);
                }
              }
            }}
            interactive={isCreatingTrack}
            pathOptions={{
              fillColor: fillColor,
              fillOpacity: fillOpacity,
              color: color,
              opacity: fillOpacity,
              weight: isProposed ? 2 : 1,
              className: isCreatingTrack ? 'leaflet-interactive-point' : ''
            }}
          >
            {isProposed && (
              <Tooltip 
                permanent 
                direction="center" 
                className="custom-proposal-tooltip"
                interactive={false}
              >
                <span style={{ 
                  fontWeight: 'bold', 
                  color: '#ffffff', 
                  backgroundColor: '#4f46e5', 
                  borderRadius: '50%', 
                  width: '18px', 
                  height: '18px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  fontSize: '10px',
                  border: '2px solid #ffffff',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                  fontFamily: 'sans-serif'
                }}>
                  {isProposed.proposalIndex}
                </span>
              </Tooltip>
            )}
          </Circle>
        );
      })}
    </>
  );
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

// Componente para auto-centrar en el último punto durante la creación del track personalizado
const AutoCenterCustomTrack = ({ isCreatingTrack, customTrack }) => {
  const map = useMap();
  
  useEffect(() => {
    if (!isCreatingTrack || !customTrack || customTrack.length === 0) return;
    
    const lastPt = customTrack[customTrack.length - 1];
    if (lastPt && lastPt.geometry && lastPt.geometry.coordinates) {
      const coords = lastPt.geometry.coordinates; // [lon, lat]
      const latLng = [coords[1], coords[0]];
      map.panTo(latLng, { animate: true });
    }
  }, [customTrack, isCreatingTrack, map]);
  
  return null;
};

// Componente para capturar clicks en el mapa con Ctrl
const MapClickListener = ({ isCreatingTrack, onMapCtrlClick }) => {
  const map = useMap();
  useEffect(() => {
    const handleMapClick = (e) => {
      if (isCreatingTrack && e.originalEvent && e.originalEvent.ctrlKey) {
        onMapCtrlClick(e.latlng);
      }
    };
    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
    };
  }, [map, isCreatingTrack, onMapCtrlClick]);
  return null;
};

const MapView = ({ 
  activities, 
  segmentMode, 
  pointsMode,
  selectedSegments = [], 
  setSelectedSegments
}) => {
  const [segmentParams, setSegmentParams] = useState({
    simplifyTolerance: 10, // Metros (aprox 0.00009 grados)
    snapTolerance: 15, // Metros (aprox 0.000135 grados)
    minLength: 10, // Metros (aprox 0.00009 grados)
    intersectionTolerance: 20 // Metros (aprox 0.00018 grados)
  });
  const [pointsParams, setPointsParams] = useState(() => {
    const saved = localStorage.getItem('sherlo_pointsParams');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.pointOpacity === undefined) parsed.pointOpacity = 50;
        return parsed;
      } catch (e) {
        console.error("Error cargando pointsParams:", e);
      }
    }
    return {
      maxMonths: 12,
      pointSizePercent: 0.5, // % de la pantalla
      gridSize: 25, // Metros cuadrícula
      pointOpacity: 50 // Opacidad % por defecto
    };
  });

  useEffect(() => {
    localStorage.setItem('sherlo_pointsParams', JSON.stringify(pointsParams));
  }, [pointsParams]);
  const [showSettings, setShowSettings] = useState(false);
  const [recalculateTrigger, setRecalculateTrigger] = useState(0);
  const [pointsRecalculateTrigger, setPointsRecalculateTrigger] = useState(0);
  const [points, setPoints] = useState([]);
  const [isCreatingTrack, setIsCreatingTrack] = useState(false);
  const [customTrack, setCustomTrack] = useState([]);
  const [isCtrlPressed, setIsCtrlPressed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Control') setIsCtrlPressed(true);
    };
    const handleKeyUp = (e) => {
      if (e.key === 'Control') setIsCtrlPressed(false);
    };
    const handleBlur = () => setIsCtrlPressed(false);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // Resetea creador al apagar el modo puntos
  useEffect(() => {
    if (!pointsMode) {
      setIsCreatingTrack(false);
      setCustomTrack([]);
    }
  }, [pointsMode]);

  // Calcula los 3 puntos sugeridos aplicando un filtro de diversidad direccional (rumbo/bearing)
  const proposedPoints = useMemo(() => {
    if (!isCreatingTrack || customTrack.length === 0 || points.length === 0) return [];
    
    const lastPt = customTrack[customTrack.length - 1];
    const [lastLon, lastLat] = lastPt.geometry.coordinates;
    const lastLatLng = L.latLng(lastLat, lastLon);
    
    const usedCoords = new Set(customTrack.map(pt => pt.geometry.coordinates.join(',')));
    
    // Calcula el rumbo aproximado en grados (-180 a 180)
    const calculateBearing = (lon2, lat2) => {
      const dLon = lon2 - lastLon;
      const dLat = lat2 - lastLat;
      return Math.atan2(dLon, dLat) * 180 / Math.PI;
    };

    // Retorna la diferencia circular de dos ángulos en grados (de 0 a 180)
    const getAngleDiff = (a, b) => {
      let diff = Math.abs(a - b) % 360;
      return diff > 180 ? 360 - diff : diff;
    };

    // 1. Calcular distancia y rumbo para todos los candidatos y ordenarlos por cercanía
    const candidates = points
      .filter(p => !usedCoords.has(p.geometry.coordinates.join(',')))
      .map(p => {
        const [lon, lat] = p.geometry.coordinates;
        const dist = lastLatLng.distanceTo(L.latLng(lat, lon));
        const bearing = calculateBearing(lon, lat);
        return { point: p, distance: dist, bearing: bearing };
      })
      .sort((a, b) => a.distance - b.distance);
    
    const maxProposals = 3;
    const bearingThreshold = 30; // Umbral en grados para agrupar en la misma dirección
    
    const selected = [];
    const skipped = [];
    
    // Pase 1: Selección priorizando la diversidad angular (distintos rumbos)
    for (const cand of candidates) {
      if (selected.length >= maxProposals) break;
      
      // Verificar si este candidato apunta en la misma dirección que alguno ya seleccionado
      const isDuplicateDirection = selected.some(sel => getAngleDiff(cand.bearing, sel.bearing) < bearingThreshold);
      
      if (!isDuplicateDirection) {
        selected.push(cand);
      } else {
        skipped.push(cand);
      }
    }
    
    // Pase 2: Si hay pocas direcciones (ej. camino recto único), rellenar hasta 3 con los más cercanos omitidos
    while (selected.length < maxProposals && skipped.length > 0) {
      selected.push(skipped.shift());
    }
    
    // 3. Ordenar las propuestas definitivas por distancia para que el UI mantenga su coherencia (1 más cercano, 3 más lejano)
    const finalProposals = selected
      .sort((a, b) => a.distance - b.distance)
      .slice(0, maxProposals);

    return finalProposals.map((c, index) => ({
      ...c.point,
      proposalIndex: index + 1,
      distanceText: c.distance < 1000 ? `${Math.round(c.distance)} m` : `${(c.distance/1000).toFixed(1)} km`
    }));
  }, [isCreatingTrack, customTrack, points]);

  // Calcular métricas acumuladas (distancia y elevación)
  const trackWithMetrics = useMemo(() => {
    let currentDist = 0;
    return customTrack.map((pt, idx) => {
      if (idx > 0) {
        const prevCoord = customTrack[idx - 1].geometry.coordinates;
        const currCoord = pt.geometry.coordinates;
        const dist = L.latLng(prevCoord[1], prevCoord[0]).distanceTo(L.latLng(currCoord[1], currCoord[0]));
        currentDist += dist;
      }
      return {
        ...pt,
        cumulativeDistance: currentDist
      };
    });
  }, [customTrack]);

  // Efecto para solicitar la altitud (Open-Meteo API) del punto recién añadido que carezca de ella
  useEffect(() => {
    if (!isCreatingTrack || customTrack.length === 0) return;
    
    const lastIdx = customTrack.length - 1;
    const lastPt = customTrack[lastIdx];
    
    if (lastPt.elevation !== undefined && lastPt.elevation !== null) return;
    
    const fetchAltitude = async () => {
      try {
        const [lon, lat] = lastPt.geometry.coordinates;
        const res = await axios.get(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
        if (res.data && Array.isArray(res.data.elevation) && res.data.elevation.length > 0) {
          const val = res.data.elevation[0];
          setCustomTrack(prev => {
            if (prev.length <= lastIdx) return prev;
            if (prev[lastIdx].geometry.coordinates.join(',') !== lastPt.geometry.coordinates.join(',')) return prev;
            
            const updated = [...prev];
            updated[lastIdx] = { ...updated[lastIdx], elevation: val };
            return updated;
          });
        }
      } catch (e) {
        console.error("Error al consultar altitud en API:", e);
      }
    };
    
    fetchAltitude();
  }, [customTrack, isCreatingTrack]);

  // Función renderizadora del perfil de elevación SVG Sparkline
  const renderElevationChart = () => {
    const pointsWithEle = trackWithMetrics.filter(p => p.elevation !== null && p.elevation !== undefined);
    if (pointsWithEle.length < 2) {
      return (
        <div style={{ height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#94a3b8', backgroundColor: '#f8fafc', borderRadius: '0.75rem', border: '1px dashed #e2e8f0' }}>
          Obteniendo altitudes...
        </div>
      );
    }

    const w = 280; 
    const h = 80;  
    const padding = 8;

    const distances = pointsWithEle.map(p => p.cumulativeDistance);
    const elevations = pointsWithEle.map(p => p.elevation);
    
    const maxD = Math.max(...distances) || 1;
    let minE = Math.min(...elevations);
    let maxE = Math.max(...elevations);

    const range = maxE - minE;
    if (range === 0) {
      minE -= 10;
      maxE += 10;
    } else {
      minE -= range * 0.1;
      maxE += range * 0.1;
    }

    const svgPoints = pointsWithEle.map(p => {
      const dx = padding + ((p.cumulativeDistance / maxD) * (w - 2 * padding));
      const dy = (h - padding) - (((p.elevation - minE) / (maxE - minE)) * (h - 2 * padding));
      return [dx, dy];
    });

    const pathData = `M ${svgPoints.map(p => p.join(',')).join(' L ')}`;
    const areaPathData = `${pathData} L ${svgPoints[svgPoints.length - 1][0]},${h} L ${svgPoints[0][0]},${h} Z`;

    const lastEle = pointsWithEle[pointsWithEle.length - 1].elevation.toFixed(0);
    const totalDistStr = maxD < 1000 ? `${Math.round(maxD)} m` : `${(maxD/1000).toFixed(2)} km`;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase' }}>
          <span>Perfil de Altura</span>
          <span style={{ color: '#10b981' }}>{lastEle}m | {totalDistStr}</span>
        </div>
        <div style={{ position: 'relative', backgroundColor: '#fafafa', borderRadius: '0.75rem', padding: '0.25rem', border: '1px solid #f1f5f9', overflow: 'hidden' }}>
          <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: '80px', display: 'block' }}>
            <defs>
              <linearGradient id="elevationGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
              </linearGradient>
            </defs>
            <line x1={padding} y1={h/2} x2={w - padding} y2={h/2} stroke="#f1f5f9" strokeDasharray="2" strokeWidth="1" />
            <path d={areaPathData} fill="url(#elevationGrad)" />
            <path d={pathData} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={svgPoints[svgPoints.length - 1][0]} cy={svgPoints[svgPoints.length - 1][1]} r="3" fill="#047857" stroke="#ffffff" strokeWidth="1.5" />
          </svg>
          <div style={{ position: 'absolute', top: '4px', right: '8px', fontSize: '8px', color: '#94a3b8', fontWeight: 'bold', fontFamily: 'monospace' }}>{Math.round(Math.max(...elevations))}m</div>
          <div style={{ position: 'absolute', bottom: '4px', right: '8px', fontSize: '8px', color: '#94a3b8', fontWeight: 'bold', fontFamily: 'monospace' }}>{Math.round(Math.min(...elevations))}m</div>
        </div>
      </div>
    );
  };

  // Función centralizada para añadir puntos al track personalizado absorbiendo intermedios colineales
  const addPointToTrack = useCallback((targetPt) => {
    setCustomTrack(prev => {
      const coordStr = targetPt.geometry.coordinates.join(',');
      const alreadyUsed = prev.some(pt => pt.geometry.coordinates.join(',') === coordStr);
      if (alreadyUsed) return prev;
      
      // Si es el primer punto de la ruta, agregarlo sin cálculos adicionales
      if (prev.length === 0) {
        return [targetPt];
      }
      
      const lastPt = prev[prev.length - 1];
      const [sLon, sLat] = lastPt.geometry.coordinates;
      const [tLon, tLat] = targetPt.geometry.coordinates;
      
      const sLL = L.latLng(sLat, sLon);
      
      // Parámetros vectoriales del segmento directriz [S -> T]
      const dLon = tLon - sLon;
      const dLat = tLat - sLat;
      const denominator = (dLon * dLon) + (dLat * dLat);
      
      // Evitar divisiones por cero si los puntos se solapan perfectamente
      if (denominator === 0) {
        return [...prev, targetPt];
      }
      
      const usedCoords = new Set(prev.map(pt => pt.geometry.coordinates.join(',')));
      
      // 1. Identificar puntos intermedios "absorbibles"
      const intermediates = points.filter(p => {
        const cStr = p.geometry.coordinates.join(',');
        // Omitir si ya está en el track o si es el propio objetivo final
        if (usedCoords.has(cStr) || cStr === coordStr) return false;
        
        const [iLon, iLat] = p.geometry.coordinates;
        
        // Proyección escalar (t) del punto intermedio sobre el vector del segmento directriz
        const t = ((iLon - sLon) * dLon + (iLat - sLat) * dLat) / denominator;
        
        // Verificar que quede estrictamente "en medio" de los extremos (margen 1%)
        if (t <= 0.01 || t >= 0.99) return false;
        
        // Calcular las coordenadas ideales del punto proyectado ortogonalmente sobre el segmento
        const projLat = sLat + t * dLat;
        const projLon = sLon + t * dLon;
        const projLL = L.latLng(projLat, projLon);
        
        // Distancia física real en metros entre la proyección y el punto real
        const iLL = L.latLng(iLat, iLon);
        const distToSegment = iLL.distanceTo(projLL);
        
        // Si el desvío perpendicular es inferior a 10 metros, se asume sobre el mismo trazo/calle
        return distToSegment < 10;
      });
      
      // 2. Ordenar los intermedios secuencialmente según su distancia al punto de origen
      const sortedIntermediates = intermediates.sort((a, b) => {
        const [aLon, aLat] = a.geometry.coordinates;
        const [bLon, bLat] = b.geometry.coordinates;
        return sLL.distanceTo(L.latLng(aLat, aLon)) - sLL.distanceTo(L.latLng(bLat, bLon));
      });
      
      // 3. Ensamblar el nuevo tramo de track insertando ordenadamente los intermedios y terminando en el destino
      return [...prev, ...sortedIntermediates, targetPt];
    });
  }, [points]);

  // Atajos de teclado 1, 2, 3
  useEffect(() => {
    if (!isCreatingTrack || proposedPoints.length === 0) return;
    
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      
      if (e.key === '1' && proposedPoints[0]) {
        addPointToTrack(proposedPoints[0]);
      } else if (e.key === '2' && proposedPoints[1]) {
        addPointToTrack(proposedPoints[1]);
      } else if (e.key === '3' && proposedPoints[2]) {
        addPointToTrack(proposedPoints[2]);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCreatingTrack, proposedPoints, addPointToTrack]);

  const handlePointClick = (f) => {
    if (!isCreatingTrack) return;
    addPointToTrack(f);
  };

  const handleMapCtrlClick = (latlng) => {
    if (!isCreatingTrack) return;
    const newPoint = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [latlng.lng, latlng.lat]
      },
      properties: { custom: true }
    };
    addPointToTrack(newPoint);
  };

  const handleExportMinisite = async () => {
    if (points.length === 0) {
      alert("No hay puntos cargados para exportar.");
      return;
    }
    
    let center = [40.4168, -3.7038];
    let zoom = 6;
    try {
      const saved = localStorage.getItem('sherlo_mapViewport');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.center) center = parsed.center;
        if (parsed.zoom) zoom = parsed.zoom;
      }
    } catch (e) {
      console.error(e);
    }

    try {
      await axios.post('/api/activities/points/export', {
        points: points,
        center: center,
        zoom: zoom
      });
      alert("Puntos exportados correctamente. El minisite está en public/index.html");
    } catch (error) {
      console.error("Error exportando minisite:", error);
      alert("Ocurrió un error al exportar.");
    }
  };

  const handleDownloadCustomTrackGPX = () => {
    if (customTrack.length === 0) return;
    
    const gpxHeader = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="SherloTracks">\n  <trk>\n    <name>Mi Track Personalizado</name>\n    <trkseg>\n';
    const gpxPoints = customTrack.map(pt => {
      const eleTag = (pt.elevation !== undefined && pt.elevation !== null) ? `<ele>${pt.elevation}</ele>` : '';
      return `      <trkpt lat="${pt.geometry.coordinates[1]}" lon="${pt.geometry.coordinates[0]}">${eleTag}</trkpt>\n`;
    }).join('');
    const gpxFooter = '    </trkseg>\n  </trk>\n</gpx>';

    const blob = new Blob([gpxHeader + gpxPoints + gpxFooter], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `track_personalizado_${new Date().getTime()}.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadCombinedGPX = () => {
    if (selectedSegments.length === 0) return;
    
    const gpxHeader = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="SherloTracks">\n  <trk>\n    <name>Ruta Combinada de Segmentos</name>\n';
    
    let segmentsXML = '';
    selectedSegments.forEach((seg, idx) => {
      segmentsXML += `    <trkseg>\n<!-- Segmento #${idx+1} -->\n`;
      if (seg.geometry && seg.geometry.coordinates) {
        seg.geometry.coordinates.forEach(p => {
          segmentsXML += `      <trkpt lat="${p[1]}" lon="${p[0]}"></trkpt>\n`;
        });
      }
      segmentsXML += `    </trkseg>\n`;
    });
    
    const gpxFooter = '  </trk>\n</gpx>';

    const blob = new Blob([gpxHeader + segmentsXML + gpxFooter], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ruta_combinada_${new Date().getTime()}.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      style={{ height: '100%', width: '100%', position: 'relative', backgroundColor: '#ffffff' }}
      className={isCreatingTrack && isCtrlPressed ? 'ctrl-pressed' : ''}
    >
      <style>{`
        .ctrl-pressed .leaflet-container {
          cursor: default !important;
        }
        .ctrl-pressed .leaflet-interactive {
          cursor: default !important;
        }
        .ctrl-pressed .leaflet-grab {
          cursor: default !important;
        }
        .ctrl-pressed .leaflet-dragging .leaflet-grab,
        .ctrl-pressed .leaflet-dragging .leaflet-interactive,
        .ctrl-pressed .leaflet-dragging .leaflet-container {
          cursor: default !important;
        }
      `}</style>
      {/* Indicador de modo activo y botón de ajustes (Estándar y Segmento) */}
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
              backgroundColor: segmentMode ? '#4f46e5' : (pointsMode ? '#d97706' : '#FC4C02')
            }} 
          />
          <span style={{ fontWeight: 600, color: '#334155' }}>
            {segmentMode 
              ? 'Modo Segmento Activo'
              : pointsMode
                ? `Modo Puntos Activo (${points.length})`
                : (activities.length > 0 ? `Visualizando ${activities.length} recorridos` : 'Cargando...')}
          </span>
          {(segmentMode || pointsMode) && (
            <>
              <div style={{ width: '1px', height: '0.75rem', backgroundColor: '#e2e8f0' }}></div>
              {pointsMode && (
                <button 
                  onClick={() => {
                    setIsCreatingTrack(!isCreatingTrack);
                    if (showSettings) setShowSettings(false);
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
                    backgroundColor: isCreatingTrack ? '#ecfdf5' : '#f8fafc',
                    color: isCreatingTrack ? '#10b981' : '#64748b',
                    transition: 'all 0.2s',
                    marginRight: '0.25rem'
                  }}
                >
                  <MapPin size={12} />
                  {isCreatingTrack ? 'Track Activo' : 'Crear Track'}
                </button>
              )}
              <button 
                onClick={() => {
                  setShowSettings(!showSettings);
                  if (isCreatingTrack) setIsCreatingTrack(false);
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
            </>
          )}
        </div>

        {/* Tarjeta de Ajustes de Parámetros en Modo Segmento */}
        {segmentMode && showSettings && (
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
            <h4 style={{ margin: 0, fontWeight: 900, fontSize: '0.75rem', color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              <Sliders size={13} style={{ color: '#4f46e5' }} />
              Parámetros del Servidor
            </h4>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Simplify */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', color: '#94a3b8' }}>
                  <span>Simplificación (Metros)</span>
                  <input 
                    type="number" step="1" min="0"
                    value={segmentParams.simplifyTolerance}
                    onChange={(e) => setSegmentParams(prev => ({ ...prev, simplifyTolerance: parseInt(e.target.value, 10) || 0 }))}
                    style={{ width: '4rem', textAlign: 'right', fontSize: '11px', fontFamily: 'monospace', padding: '0.125rem', border: '1px solid #e2e8f0', borderRadius: '0.25rem' }}
                  />
                </div>
                <span style={{ fontSize: '9px', color: '#94a3b8', fontWeight: 500, lineHeight: 1.25 }}>Limpia y aplana ruido del GPS en curvas y rectas.</span>
              </div>

              {/* Snap */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', color: '#94a3b8' }}>
                  <span>Imán Trazos (Metros)</span>
                  <input 
                    type="number" step="1" min="0"
                    value={segmentParams.snapTolerance}
                    onChange={(e) => setSegmentParams(prev => ({ ...prev, snapTolerance: parseInt(e.target.value, 10) || 0 }))}
                    style={{ width: '4rem', textAlign: 'right', fontSize: '11px', fontFamily: 'monospace', padding: '0.125rem', border: '1px solid #e2e8f0', borderRadius: '0.25rem' }}
                  />
                </div>
                <span style={{ fontSize: '9px', color: '#94a3b8', fontWeight: 500, lineHeight: 1.25 }}>Distancia en la que tracks paralelos se atraen y funden.</span>
              </div>

              {/* Min Length */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', color: '#94a3b8' }}>
                  <span>Filtro Basura (Metros)</span>
                  <input 
                    type="number" step="1" min="0"
                    value={segmentParams.minLength}
                    onChange={(e) => setSegmentParams(prev => ({ ...prev, minLength: parseInt(e.target.value, 10) || 0 }))}
                    style={{ width: '4rem', textAlign: 'right', fontSize: '11px', fontFamily: 'monospace', padding: '0.125rem', border: '1px solid #e2e8f0', borderRadius: '0.25rem' }}
                  />
                </div>
                <span style={{ fontSize: '9px', color: '#94a3b8', fontWeight: 500, lineHeight: 1.25 }}>Descarta espuelas o tramos sueltos más cortos.</span>
              </div>

              {/* Intersection Snaps */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', color: '#94a3b8' }}>
                  <span>Radio Cruce (Metros)</span>
                  <input 
                    type="number" step="1" min="0"
                    value={segmentParams.intersectionTolerance}
                    onChange={(e) => setSegmentParams(prev => ({ ...prev, intersectionTolerance: parseInt(e.target.value, 10) || 0 }))}
                    style={{ width: '4rem', textAlign: 'right', fontSize: '11px', fontFamily: 'monospace', padding: '0.125rem', border: '1px solid #e2e8f0', borderRadius: '0.25rem' }}
                  />
                </div>
                <span style={{ fontSize: '9px', color: '#94a3b8', fontWeight: 500, lineHeight: 1.25 }}>Agrupa y forzar extremos de caminos al centroide común.</span>
              </div>

              {/* Botón de recálculo manual */}
              <button
                onClick={() => setRecalculateTrigger(prev => prev + 1)}
                style={{
                  width: '100%',
                  marginTop: '0.5rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  padding: '0.625rem',
                  backgroundColor: '#4f46e5',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '0.5rem',
                  fontSize: '11px',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.025em',
                  cursor: 'pointer',
                  boxShadow: '0 4px 6px -1px rgba(79, 70, 229, 0.3)',
                  transition: 'all 0.2s'
                }}
              >
                <RefreshCw size={12} />
                Recalcular Segmentos
              </button>
            </div>
          </div>
        )}

        {/* Tarjeta de Ajustes de Parámetros en Modo Puntos */}
        {pointsMode && showSettings && (
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
            <h4 style={{ margin: 0, fontWeight: 900, fontSize: '0.75rem', color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              <Sliders size={13} style={{ color: '#d97706' }} />
              Parámetros de Puntos
            </h4>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Antigüedad Máxima */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', color: '#94a3b8' }}>
                  <span>Antigüedad Máx (Meses)</span>
                  <input 
                    type="number" step="1" min="1"
                    value={pointsParams.maxMonths}
                    onChange={(e) => setPointsParams(prev => ({ ...prev, maxMonths: parseInt(e.target.value, 10) || 1 }))}
                    style={{ width: '4rem', textAlign: 'right', fontSize: '11px', fontFamily: 'monospace', padding: '0.125rem', border: '1px solid #e2e8f0', borderRadius: '0.25rem' }}
                  />
                </div>
                <span style={{ fontSize: '9px', color: '#94a3b8', fontWeight: 500, lineHeight: 1.25 }}>Se ignoran tracks guardados más antiguos.</span>
              </div>

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
                <span style={{ fontSize: '9px', color: '#94a3b8', fontWeight: 500, lineHeight: 1.25 }}>Radio calculado al iniciar. Crece/encoge con el zoom.</span>
              </div>

              {/* Rejilla de Snap */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', color: '#94a3b8' }}>
                  <span>Rejilla Snap (Metros)</span>
                  <input 
                    type="number" step="1" min="1"
                    value={pointsParams.gridSize}
                    onChange={(e) => setPointsParams(prev => ({ ...prev, gridSize: parseFloat(e.target.value) || 1 }))}
                    style={{ width: '4rem', textAlign: 'right', fontSize: '11px', fontFamily: 'monospace', padding: '0.125rem', border: '1px solid #e2e8f0', borderRadius: '0.25rem' }}
                  />
                </div>
                <span style={{ fontSize: '9px', color: '#94a3b8', fontWeight: 500, lineHeight: 1.25 }}>Muestra sólo el punto medio por cada celda de rejilla.</span>
              </div>

              {/* Opacidad */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', color: '#94a3b8' }}>
                  <span>Opacidad (%)</span>
                  <input 
                    type="number" step="5" min="0" max="100"
                    value={pointsParams.pointOpacity}
                    onChange={(e) => setPointsParams(prev => ({ ...prev, pointOpacity: parseInt(e.target.value, 10) || 0 }))}
                    style={{ width: '4rem', textAlign: 'right', fontSize: '11px', fontFamily: 'monospace', padding: '0.125rem', border: '1px solid #e2e8f0', borderRadius: '0.25rem' }}
                  />
                </div>
                <span style={{ fontSize: '9px', color: '#94a3b8', fontWeight: 500, lineHeight: 1.25 }}>Transparencia de los puntos inactivos en el mapa.</span>
              </div>

              {/* Botón de recálculo manual */}
              <button
                onClick={() => setPointsRecalculateTrigger(prev => prev + 1)}
                style={{
                  width: '100%',
                  marginTop: '0.5rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  padding: '0.625rem',
                  backgroundColor: '#d97706',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '0.5rem',
                  fontSize: '11px',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.025em',
                  cursor: 'pointer',
                  boxShadow: '0 4px 6px -1px rgba(217, 119, 6, 0.3)',
                  transition: 'all 0.2s'
                }}
              >
                <RefreshCw size={12} />
                Recargar Puntos
              </button>

              <button
                onClick={handleExportMinisite}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  padding: '0.625rem',
                  backgroundColor: '#0f172a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '0.5rem',
                  fontSize: '11px',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.025em',
                  cursor: 'pointer',
                  boxShadow: '0 4px 6px -1px rgba(15, 23, 42, 0.3)',
                  transition: 'all 0.2s'
                }}
              >
                <Download size={12} />
                Exportar Minisite
              </button>
            </div>
          </div>
        )}

        {/* Tarjeta del Creador de Track Personalizado */}
        {pointsMode && isCreatingTrack && (
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
              <Plus size={13} style={{ color: '#10b981' }} />
              Creador de Track
            </h4>

            {customTrack.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.5rem 0' }}>
                <div style={{ backgroundColor: '#ecfdf5', color: '#065f46', padding: '0.75rem', borderRadius: '0.5rem', fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Info size={14} />
                  <span>Selecciona un punto de inicio</span>
                </div>
                <p style={{ margin: 0, fontSize: '10px', color: '#64748b', lineHeight: 1.4 }}>Haz clic sobre cualquier punto en el mapa para establecer dónde arranca tu ruta personalizada.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc', padding: '0.5rem 0.75rem', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '9px', fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase' }}>Puntos Añadidos</span>
                    <span style={{ fontSize: '14px', fontWeight: 800, color: '#1e293b' }}>{customTrack.length}</span>
                  </div>
                  <button 
                    onClick={() => setCustomTrack(prev => prev.slice(0, -1))}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '0.375rem', padding: '0.25rem 0.5rem', cursor: 'pointer', fontSize: '10px', fontWeight: 700, color: '#64748b' }}
                  >
                    <Undo size={12} />
                    Deshacer
                  </button>
                </div>

                {/* Gráfico de Elevación en Tiempo Real */}
                {renderElevationChart()}

                {/* Guía Visual Condensada de Teclado */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.75rem', padding: '0.75rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', color: '#94a3b8' }}>Siguientes Puntos (Teclado)</span>
                  <div style={{ display: 'flex', gap: '0.5rem', margin: '0.25rem 0' }}>
                    {['1', '2', '3'].map(num => {
                      const point = proposedPoints[parseInt(num, 10) - 1];
                      return (
                        <div key={num} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem', minWidth: '3.5rem' }}>
                          <span style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center', 
                            width: '24px', 
                            height: '24px', 
                            backgroundColor: '#ffffff', 
                            border: `2px solid ${point ? '#8b5cf6' : '#cbd5e1'}`, 
                            color: point ? '#6d28d9' : '#94a3b8', 
                            borderRadius: '0.5rem', 
                            fontSize: '12px', 
                            fontWeight: 900, 
                            boxShadow: point ? '0 2px 4px rgba(139, 92, 246, 0.1)' : 'none' 
                          }}>
                            {num}
                          </span>
                          <span style={{ fontSize: '8px', color: point ? '#6366f1' : '#cbd5e1', fontWeight: 700, fontFamily: 'monospace' }}>
                            {point ? `+${point.distanceText}` : '-'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <span style={{ fontSize: '8px', color: '#94a3b8', fontWeight: 500 }}>Usa los números del teclado para extender el track</span>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.75rem', marginTop: '0.25rem' }}>
              {customTrack.length > 1 && (
                <button
                  onClick={handleDownloadCustomTrackGPX}
                  style={{
                    width: '100%',
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
                  <Download size={12} />
                  Descargar GPX
                </button>
              )}
              
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => setCustomTrack([])}
                  disabled={customTrack.length === 0}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.25rem',
                    padding: '0.5rem',
                    backgroundColor: '#ffffff',
                    color: customTrack.length === 0 ? '#cbd5e1' : '#ef4444',
                    border: `1px solid ${customTrack.length === 0 ? '#e2e8f0' : '#fee2e2'}`,
                    borderRadius: '0.375rem',
                    fontSize: '10px',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    cursor: customTrack.length === 0 ? 'not-allowed' : 'pointer'
                  }}
                >
                  Limpiar
                </button>
                <button
                  onClick={() => {
                    setIsCreatingTrack(false);
                    setCustomTrack([]);
                  }}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.25rem',
                    padding: '0.5rem',
                    backgroundColor: '#f8fafc',
                    color: '#64748b',
                    border: '1px solid #e2e8f0',
                    borderRadius: '0.375rem',
                    fontSize: '10px',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    cursor: 'pointer'
                  }}
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Cartel informativo del modo segmento si no hay nada seleccionado */}
      {segmentMode && selectedSegments.length === 0 && (
        <div 
          style={{ 
            zIndex: 1000, 
            position: 'absolute', 
            top: '4.5rem', 
            left: '50%', 
            transform: 'translateX(-50%)', 
            backgroundColor: 'rgba(79, 70, 229, 0.9)', 
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
          Haz clic en los segmentos de línea discontinua para unirlos
        </div>
      )}

      <MapContainer
        center={[40.4168, -3.7038]}
        zoom={6}
        scrollWheelZoom={true}
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
        
        <RouteLines activities={activities} segmentMode={segmentMode} pointsMode={pointsMode} />
        <SegmentsLayer 
          segmentMode={segmentMode} 
          selectedSegments={selectedSegments} 
          setSelectedSegments={setSelectedSegments} 
          activities={activities}
          segmentParams={segmentParams}
          recalculateTrigger={recalculateTrigger}
        />
        <PointsLayer 
          pointsMode={pointsMode}
          pointsParams={pointsParams}
          recalculateTrigger={pointsRecalculateTrigger}
          points={points}
          setPoints={setPoints}
          isCreatingTrack={isCreatingTrack}
          customTrack={customTrack}
          proposedPoints={proposedPoints}
          onPointClick={handlePointClick}
        />

        {isCreatingTrack && customTrack.length > 1 && (
          <Polyline
            positions={customTrack.map(p => [p.geometry.coordinates[1], p.geometry.coordinates[0]])}
            pathOptions={{
              color: '#10b981', // Esmeralda vibrante
              weight: 5,
              opacity: 0.85,
              lineJoin: 'round'
            }}
          />
        )}
        
        <AutoCenter activities={activities} />
        <AutoCenterCustomTrack isCreatingTrack={isCreatingTrack} customTrack={customTrack} />
        <MapClickListener isCreatingTrack={isCreatingTrack} onMapCtrlClick={handleMapCtrlClick} />
        <ViewportPersister />
      </MapContainer>

      {/* Widget de Ruta Creada Flotante (Modo Segmento) */}
      {segmentMode && selectedSegments.length > 0 && (
        <div 
          style={{ 
            zIndex: 1001, 
            position: 'absolute', 
            bottom: '1.5rem', 
            right: '1.5rem', 
            width: '20rem', 
            backgroundColor: '#ffffff', 
            borderRadius: '1rem', 
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', 
            border: '1px solid #f1f5f9', 
            padding: '1.25rem', 
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ margin: 0, fontWeight: 800, color: '#1e293b', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.375rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <span style={{ width: '0.625rem', height: '0.625rem', borderRadius: '9999px', backgroundColor: '#6366f1' }}></span>
                Ruta Segmentos
              </h3>
              <p style={{ margin: '0.125rem 0 0 0', fontSize: '10px', fontWeight: 600, color: '#94a3b8' }}>Componiendo trazado por segmentos</p>
            </div>
            <button 
              onClick={() => setSelectedSegments([])}
              style={{
                color: '#94a3b8',
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '0.25rem',
                borderRadius: '0.25rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="Borrar todo"
            >
              <Trash2 size={16} />
            </button>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem', backgroundColor: '#f8fafc', padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid #f1f5f9' }}>
            <div>
              <span style={{ display: 'block', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8' }}>Segmentos</span>
              <span style={{ fontSize: '1.125rem', fontWeight: 900, color: '#1e293b' }}>{selectedSegments.length}</span>
            </div>
            <div>
              <span style={{ display: 'block', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8' }}>Distancia Aprox</span>
              <span style={{ fontSize: '1.125rem', fontWeight: 900, color: '#4f46e5' }}>
                {(selectedSegments.reduce((acc, s) => acc + (s.properties.length || 0) * 111.1, 0)).toFixed(1)} km
              </span>
            </div>
          </div>
          
          <button
            onClick={handleDownloadCombinedGPX}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              padding: '0.75rem 0',
              backgroundColor: '#4f46e5',
              border: 'none',
              borderRadius: '0.75rem',
              fontWeight: 800,
              fontSize: '0.75rem',
              color: '#ffffff',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              cursor: 'pointer',
              boxShadow: '0 4px 6px -1px rgba(79, 70, 229, 0.2)',
              transition: 'background-color 0.2s'
            }}
          >
            <Download size={15} />
            Descargar Ruta (GPX)
          </button>
        </div>
      )}

      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    </div>
  );
};

export default MapView;

