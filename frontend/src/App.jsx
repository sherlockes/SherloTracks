import React, { useState, useEffect } from 'react';
import axios from 'axios';
import MapView from './components/MapView';
import { Activity, RefreshCw, Map as MapIcon, Calendar, Filter } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.10.211:8800';

function App() {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');

  const fetchActivities = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/activities`);
      if (Array.isArray(res.data)) {
        setActivities(res.data);
      } else {
        console.error("API did not return an array:", res.data);
      }
    } catch (err) {
      console.error("Error fetching activities", err);
    } finally {
      setLoading(false);
    }
  };

  const syncActivities = async () => {
    setLoading(true);
    console.log("Iniciando sincronización con:", API_URL);
    try {
      await axios.get(`${API_URL}/activities/sync`);
      fetchActivities();
    } catch (err) {
      console.error("Sync failed, redirecting to login...", err);
      // Forzamos la redirección si falla la sincronización (asumimos falta de token)
      window.location.href = `${API_URL}/auth/login`;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActivities();
  }, []);

  const filteredActivities = activities.filter(a => 
    a.name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-4 md:p-8 font-sans">
      <header className="max-w-7xl mx-auto mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-strava p-2 rounded-xl shadow-lg shadow-strava/20">
            <Activity size={32} className="text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">SherloTracks</h1>
            <p className="text-gray-400 text-sm">Visualizador de Rutas Strava</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={syncActivities}
            disabled={loading}
            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 px-6 py-2.5 rounded-full transition-all active:scale-95 disabled:opacity-50"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Sincronizando...' : 'Sincronizar Strava'}
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar / Filtros */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white/5 border border-white/10 p-6 rounded-2xl backdrop-blur-md">
              <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
                <Filter size={18} className="text-strava" />
                Filtros
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">Buscar Ruta</label>
                  <input 
                    type="text" 
                    placeholder="Ej: Salida serrana..."
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-strava/50 transition-colors"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 p-6 rounded-2xl backdrop-blur-md">
              <h2 className="text-lg font-semibold mb-4">Estadísticas</h2>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Total Rutas</span>
                  <span className="text-xl font-bold">{activities.length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Distancia Total</span>
                  <span className="text-xl font-bold">
                    {(activities.reduce((acc, curr) => acc + curr.distance, 0) / 1000).toFixed(0)} km
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Mapa Principal */}
          <div className="lg:col-span-3">
            <MapView activities={filteredActivities} />
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
