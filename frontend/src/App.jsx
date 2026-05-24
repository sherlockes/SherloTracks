import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import MapView from './components/MapView';
import { Activity, RefreshCw, Map as MapIcon, Calendar, Filter, Download, Undo } from 'lucide-react';

const API_URL = '/api';

function App() {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState(() => {
    const saved = localStorage.getItem('sherlo_selectedTypes');
    return saved ? JSON.parse(saved) : null; // null nos indica si no hay historial previo
  });
  const [timeFilter, setTimeFilter] = useState(() => {
    const saved = localStorage.getItem('sherlo_timeFilter');
    return saved || 'Year';
  });
  const [crucesMode, setCrucesMode] = useState(false);

  const toggleCrucesMode = () => {
    setCrucesMode(!crucesMode);
  };


  // Guardado persistente de cambios en localStorage
  useEffect(() => {
    localStorage.setItem('sherlo_timeFilter', timeFilter);
  }, [timeFilter]);

  useEffect(() => {
    if (selectedTypes !== null) {
      localStorage.setItem('sherlo_selectedTypes', JSON.stringify(selectedTypes));
    }
  }, [selectedTypes]);

  const fetchActivities = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/activities`);
      if (Array.isArray(res.data)) {
        setActivities(res.data);
        // Si no existían filtros guardados en localStorage, seleccionamos todos por defecto
        if (selectedTypes === null) {
          const allTypes = [...new Set(res.data.map(a => a.type).filter(t => t))];
          setSelectedTypes(allTypes);
        }
      }
    } catch (err) {
      console.error("Error fetching activities", err);
    } finally {
      setLoading(false);
    }
  };

  const syncActivities = async (full = false) => {
    console.log(`Iniciando sincronización (full=${full})...`);
    setLoading(true);
    try {
      const response = await axios.get(`${API_URL}/activities/sync?full=${full}`);
      alert(`Sincronización completada. Nuevas: ${response.data.count || 0}`);
      await fetchActivities();
    } catch (err) {
      if (err.response?.status === 401) {
        window.location.href = `${API_URL}/auth/login`;
      } else {
        alert("Error al sincronizar.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActivities();
  }, []);

  const filteredActivities = useMemo(() => {
    return activities.filter(a => {
      // Si no hay nada seleccionado, no mostramos nada
      if (!selectedTypes || selectedTypes.length === 0) return false;
      
      const matchesType = selectedTypes.includes(a.type);
      if (!matchesType) return false;

      if (timeFilter === 'All') return true;
      
      const date = new Date(a.start_date);
      const now = new Date();
      
      if (timeFilter === 'Latest') {
          return a.id === activities[0]?.id;
      }
      
      const diffTime = Math.abs(now - date);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (timeFilter === 'Week') return diffDays <= 7;
      if (timeFilter === 'Month') return diffDays <= 30;
      if (timeFilter === 'Year') return diffDays <= 365;
      
      return true;
    });
  }, [activities, selectedTypes, timeFilter]);

  const timeOptions = [
    { id: 'Latest', label: 'Actividad' },
    { id: 'Week', label: 'Semana' },
    { id: 'Month', label: 'Mes' },
    { id: 'Year', label: 'Año' },
    { id: 'All', label: 'Todas' }
  ];

  const allAvailableTypes = [...new Set(activities.map(a => a.type).filter(t => t))];

  const typeLabels = {
    'Ride': 'Bicicleta',
    'Run': 'Carrera',
    'Walk': 'Caminata',
    'Hike': 'Senderismo',
    'VirtualRide': 'Bici Virtual'
  };

  const toggleType = (type) => {
    const current = selectedTypes || [];
    if (current.includes(type)) {
      setSelectedTypes(current.filter(t => t !== type));
    } else {
      setSelectedTypes([...current, type]);
    }
  };

  return (
    <div style={{ 
      height: '100vh', 
      width: '100vw', 
      display: 'grid', 
      gridTemplateRows: '80px 1fr', 
      backgroundColor: '#f8fafc', 
      overflow: 'hidden' 
    }}>
      {/* Barra de Menú Superior con estilos forzados por Inline Styles */}
      <header 
        style={{ 
          display: 'flex', 
          width: '100%', 
          height: '80px', 
          backgroundColor: 'white', 
          borderBottom: '1px solid #e2e8f0', 
          padding: '0 1rem', 
          alignItems: 'center', 
          justifyContent: 'flex-start', 
          zIndex: 50,
          boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
        }}
      >
        
        {/* Bloque Izquierdo: Logo + Sync + Filtros + Stats */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          
          {/* 1. Logo y Botones de Sync */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', paddingRight: '0.75rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '0.8', cursor: 'default' }}>
              <span style={{ fontSize: '32px', fontWeight: 900, fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '-0.05em', color: '#0f172a' }}>Sherlo</span>
              <span style={{ fontSize: '32px', fontWeight: 900, fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '-0.05em', color: '#FC4C02' }}>Tracks</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <button 
                onClick={() => syncActivities(false)}
                disabled={loading}
                style={{ width: '80px', padding: '2px 0' }}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all disabled:opacity-50"
              >
                {loading ? '...' : 'Sync'}
              </button>
              <button 
                onClick={() => syncActivities(true)}
                disabled={loading}
                style={{ width: '80px', padding: '2px 0' }}
                className="bg-slate-900 text-white hover:bg-black rounded-md text-[9px] font-bold uppercase tracking-wider transition-all disabled:opacity-50"
              >
                {loading ? '...' : 'Archive'}
              </button>
            </div>
          </div>

          {/* 2 y 3. Grupo Central apilado: Tiempo (Arriba) y Tipos (Abajo) */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', borderLeft: '1px solid #f1f5f9', paddingLeft: '0.75rem', gap: '0.5rem' }}>
            {/* Fila Superior: Tiempo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span className="text-[10px] font-bold uppercase text-slate-400 whitespace-nowrap">Ver última:</span>
              <select 
                value={timeFilter}
                onChange={(e) => setTimeFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded px-2 py-0.5 text-[10px] font-bold focus:outline-none focus:border-strava/50 cursor-pointer"
              >
                {timeOptions.map(opt => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            </div>
            
            {/* Fila Inferior: Tipos */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span className="text-[10px] font-bold uppercase text-slate-400 whitespace-nowrap text-strava">Tipos:</span>
              <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto' }}>
                {allAvailableTypes.map(t => (
                  <label key={t} className="flex items-center gap-1.5 cursor-pointer group whitespace-nowrap">
                    <input 
                      type="checkbox"
                      checked={(selectedTypes || []).includes(t)}
                      onChange={() => toggleType(t)}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-strava focus:ring-strava"
                    />
                    <span className="text-[10px] font-bold text-slate-600 group-hover:text-slate-900 transition-colors">
                      {typeLabels[t] || t}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

            {/* 4. Estadísticas (3 Columnas) */}
          <div style={{ display: 'flex', alignItems: 'center', borderLeft: '1px solid #f1f5f9', marginLeft: '0.75rem' }}>
            
            {/* Columna 1: General */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', paddingLeft: '0.75rem' }}>
              <div className="flex items-center">
                <span className="text-[9px] font-bold uppercase text-slate-400">Actividades: </span>
                <span className="text-[11px] font-black ml-1">{filteredActivities.length}</span>
              </div>
              <div className="flex items-center">
                <span className="text-[9px] font-bold uppercase text-slate-400">Distancia: </span>
                <span className="text-[11px] font-black text-strava ml-1">
                  {(filteredActivities.reduce((acc, curr) => acc + curr.distance, 0) / 1000).toFixed(0)}km
                </span>
              </div>
              <div className="flex items-center">
                <span className="text-[9px] font-bold uppercase text-slate-400">Tiempo: </span>
                <span className="text-[11px] font-black ml-1">
                  {(() => {
                    const totalSeconds = filteredActivities.reduce((acc, curr) => acc + (curr.moving_time || 0), 0);
                    const h = Math.floor(totalSeconds / 3600);
                    const m = Math.floor((totalSeconds % 3600) / 60);
                    return h > 0 ? `${h}h ${m}m` : `${m}m`;
                  })()}
                </span>
              </div>
            </div>

            {/* Columna 2: Desniveles */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', borderLeft: '1px solid #f8fafc', paddingLeft: '0.75rem', marginLeft: '0.75rem' }}>
              <div className="flex items-center">
                <span className="text-[9px] font-bold uppercase text-slate-400">Desnivel Máx: </span>
                <span className="text-[11px] font-black ml-1">
                  {Math.max(0, ...filteredActivities.map(a => a.total_elevation_gain || 0)).toFixed(0)}m
                </span>
              </div>
              <div className="flex items-center">
                <span className="text-[9px] font-bold uppercase text-slate-400">Desnivel Medio: </span>
                <span className="text-[11px] font-black ml-1">
                  {filteredActivities.length > 0 
                    ? (filteredActivities.reduce((acc, a) => acc + (a.total_elevation_gain || 0), 0) / filteredActivities.length).toFixed(0)
                    : 0}m
                </span>
              </div>
              <div className="flex items-center">
                <span className="text-[9px] font-bold uppercase text-slate-400">Desnivel Total: </span>
                <span className="text-[11px] font-black text-strava ml-1">
                  {filteredActivities.reduce((acc, a) => acc + (a.total_elevation_gain || 0), 0).toFixed(0)}m
                </span>
              </div>
            </div>

            {/* Columna 3: Velocidades */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', borderLeft: '1px solid #f8fafc', paddingLeft: '0.75rem', marginLeft: '0.75rem' }}>
              <div className="flex items-center">
                <span className="text-[9px] font-bold uppercase text-slate-400">Velocidad Máx: </span>
                <span className="text-[11px] font-black ml-1">
                  {(Math.max(0, ...filteredActivities.map(a => a.max_speed || 0)) * 3.6).toFixed(1)}km/h
                </span>
              </div>
              <div className="flex items-center">
                <span className="text-[9px] font-bold uppercase text-slate-400">Media Máx: </span>
                <span className="text-[11px] font-black ml-1">
                  {(Math.max(0, ...filteredActivities.map(a => a.average_speed || 0)) * 3.6).toFixed(1)}km/h
                </span>
              </div>
              <div className="flex items-center">
                <span className="text-[9px] font-bold uppercase text-slate-400">Velocidad Media: </span>
                <span className="text-[11px] font-black text-strava ml-1">
                  {filteredActivities.length > 0 
                    ? ((filteredActivities.reduce((acc, a) => acc + (a.average_speed || 0), 0) / filteredActivities.length) * 3.6).toFixed(1)
                    : 0}km/h
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Botón Modo Cruces a la Derecha */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.75rem', alignItems: 'center', paddingRight: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button 
              onClick={toggleCrucesMode}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-black uppercase tracking-wider border-2 transition-all shadow-sm cursor-pointer ${
                crucesMode 
                  ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700' 
                  : 'bg-white border-slate-200 text-slate-700 hover:border-emerald-600 hover:text-emerald-600'
              }`}
            >
              <span className={crucesMode ? 'animate-pulse font-extrabold text-sm' : 'font-extrabold text-sm'}>X</span>
              {crucesMode ? 'Salir Cruces' : 'Modo Cruces'}
            </button>
          </div>
        </div>

      </header>

      {/* Contenedor del Mapa (Ocupa el resto) */}
      <main 
        style={{ height: '100%', width: '100%', position: 'relative', overflow: 'hidden' }}
      >
        <MapView 
          activities={filteredActivities} 
          crucesMode={crucesMode}
        />
      </main>
    </div>
  );
}

export default App;
