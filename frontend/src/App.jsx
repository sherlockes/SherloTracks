import React, { useState, useEffect } from 'react';
import axios from 'axios';
import MapView from './components/MapView';
import { Activity, RefreshCw, Map as MapIcon, Calendar, Filter } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.10.211:8800';

function App() {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState([]); // Array para multi-selección
  const [timeFilter, setTimeFilter] = useState('Year');

  const fetchActivities = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/activities`);
      if (Array.isArray(res.data)) {
        setActivities(res.data);
        // Inicializar con todos los tipos seleccionados si está vacío
        const allTypes = [...new Set(res.data.map(a => a.type).filter(t => t))];
        setSelectedTypes(allTypes);
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

  const filteredActivities = activities.filter(a => {
    const matchesType = selectedTypes.length === 0 || selectedTypes.includes(a.type);
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
    if (selectedTypes.includes(type)) {
      setSelectedTypes(selectedTypes.filter(t => t !== type));
    } else {
      setSelectedTypes([...selectedTypes, type]);
    }
  };

  return (
    <div className="h-screen w-full flex flex-col bg-slate-50 overflow-hidden font-sans">
      {/* Barra de Menú Superior forzada a repartirse */}
      <header className="h-20 bg-white border-b border-slate-200 px-8 flex items-center justify-between shadow-sm z-50 w-full">
        
        {/* 1. Logo (Izquierda) */}
        <div className="flex-1 flex justify-start">
          <h1 className="text-xl font-black italic uppercase tracking-tighter text-slate-900">
            SherloTracks
          </h1>
        </div>

        {/* 2. Selector de Tiempo (Centro-Izquierda) */}
        <div className="flex-1 flex justify-center border-l border-slate-100">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold uppercase text-slate-400 whitespace-nowrap">Ver última:</span>
            <select 
              value={timeFilter}
              onChange={(e) => setTimeFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold focus:outline-none focus:border-strava/50 cursor-pointer"
            >
              {timeOptions.map(opt => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 3. Checkboxes de Tipo (Centro) */}
        <div className="flex-[2] flex justify-center border-l border-slate-100">
          <div className="flex items-center gap-6 overflow-x-auto">
            {allAvailableTypes.map(t => (
              <label key={t} className="flex items-center gap-2 cursor-pointer group whitespace-nowrap">
                <input 
                  type="checkbox"
                  checked={selectedTypes.includes(t)}
                  onChange={() => toggleType(t)}
                  className="w-4 h-4 rounded border-slate-300 text-strava focus:ring-strava"
                />
                <span className="text-xs font-bold text-slate-600 group-hover:text-slate-900 transition-colors">
                  {typeLabels[t] || t}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* 4. Estadísticas (Centro-Derecha) */}
        <div className="flex-1 flex justify-center border-l border-slate-100">
          <div className="flex items-center gap-8">
            <div className="flex flex-col items-center">
              <span className="text-[9px] font-bold uppercase text-slate-400">Actividades</span>
              <span className="text-sm font-black leading-tight">{filteredActivities.length}</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-[9px] font-bold uppercase text-slate-400">Distancia</span>
              <span className="text-sm font-black text-strava leading-tight">
                {(filteredActivities.reduce((acc, curr) => acc + curr.distance, 0) / 1000).toFixed(0)}km
              </span>
            </div>
          </div>
        </div>

        {/* 5. Acciones (Derecha) */}
        <div className="flex-1 flex justify-end gap-3 border-l border-slate-100 pl-4">
          <button 
            onClick={() => syncActivities(false)}
            disabled={loading}
            title="Sincronizar últimas"
            className="p-2.5 bg-slate-50 hover:bg-slate-100 text-slate-500 border border-slate-200 rounded-xl transition-all disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button 
            onClick={() => syncActivities(true)}
            disabled={loading}
            className="px-4 py-2 bg-slate-900 text-white hover:bg-black rounded-xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-slate-900/10 transition-all disabled:opacity-50 whitespace-nowrap"
          >
            {loading ? '...' : 'Histórico'}
          </button>
        </div>

      </header>

      {/* Contenedor del Mapa (Ocupa el resto) */}
      <main 
        style={{ height: 'calc(100vh - 80px)' }}
        className="w-full relative"
      >
        <MapView activities={filteredActivities} />
      </main>
    </div>
  );
}

export default App;
