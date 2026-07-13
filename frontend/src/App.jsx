import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import MapView from './components/MapView';
import { Activity, RefreshCw, Map as MapIcon, Calendar, Filter, Download, Undo, MapPin, Edit3, Menu, X, Eye, History } from 'lucide-react';

const API_URL = '/api';

function App() {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadedBytes, setLoadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [syncStatus, setSyncStatus] = useState('idle'); // 'idle' | 'syncing' | 'success' | 'error'
  const [syncMessage, setSyncMessage] = useState('');
  const [syncCount, setSyncCount] = useState(0);
  const [timeFilter, setTimeFilter] = useState(() => {
    const saved = localStorage.getItem('sherlo_timeFilter');
    return saved || 'Year';
  });
  const [crucesMode, setCrucesMode] = useState(false);
  const [minisiteEditorMode, setMinisiteEditorMode] = useState(false);
  const [historicalMode, setHistoricalMode] = useState(false);
  const [historicalYears, setHistoricalYears] = useState(5);
  const [showVerModal, setShowVerModal] = useState(false);

  const toggleCrucesMode = () => {
    const nextVal = !crucesMode;
    setCrucesMode(nextVal);
    if (nextVal) {
      setMinisiteEditorMode(false);
      setHistoricalMode(false);
    }
  };

  const toggleMinisiteEditorMode = () => {
    const nextVal = !minisiteEditorMode;
    setMinisiteEditorMode(nextVal);
    if (nextVal) {
      setCrucesMode(false);
      setHistoricalMode(false);
    }
  };

  const toggleHistoricalMode = () => {
    const nextVal = !historicalMode;
    if (nextVal) {
      const input = prompt("¿Cuántos años de antigüedad máxima quieres analizar para el histórico?", historicalYears);
      if (input === null) return;
      const years = parseInt(input, 10);
      if (isNaN(years) || years <= 0) {
        alert("Por favor, introduce un número de años válido.");
        return;
      }
      setHistoricalYears(years);
      setHistoricalMode(true);
      setCrucesMode(false);
      setMinisiteEditorMode(false);
    } else {
      setHistoricalMode(false);
    }
  };


  // Guardado persistente de cambios en localStorage
  useEffect(() => {
    localStorage.setItem('sherlo_timeFilter', timeFilter);
  }, [timeFilter]);

  const fetchActivities = async (filterToUse = timeFilter) => {
    setLoading(true);
    setLoadingProgress(0);
    setLoadedBytes(0);
    setTotalBytes(0);
    try {
      const res = await axios.get(`${API_URL}/activities?time_filter=${filterToUse}`, {
        onDownloadProgress: (progressEvent) => {
          const loaded = progressEvent.loaded || 0;
          const total = progressEvent.total || 0;
          setLoadedBytes((prev) => Math.max(prev, loaded));
          if (total > 0) {
            setTotalBytes(total);
            const newProgress = Math.round((loaded * 100) / total);
            setLoadingProgress((prev) => Math.max(prev, newProgress));
          }
        }
      });
      if (Array.isArray(res.data)) {
        setActivities(res.data);
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
    setSyncStatus('syncing');
    try {
      const response = await axios.get(`${API_URL}/activities/sync?full=${full}`);
      const count = response.data.count || 0;
      setSyncCount(count);
      setSyncStatus('success');
      await fetchActivities();
    } catch (err) {
      const msg = err.response?.data?.detail || err.message;
      setSyncMessage(msg);
      setSyncStatus('error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActivities(timeFilter);
  }, [timeFilter]);

  const filteredActivities = useMemo(() => {
    return activities.filter(a => {
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
  }, [activities, timeFilter]);

  const timeOptions = [
    { id: 'Latest', label: 'Actividad' },
    { id: 'Week', label: 'Semana' },
    { id: 'Month', label: 'Mes' },
    { id: 'Year', label: 'Año' },
    { id: 'All', label: 'Todas' }
  ];



  return (
    <div style={{
      height: '100vh',
      width: '100vw',
      display: 'grid',
      gridTemplateRows: 'auto 1fr',
      backgroundColor: '#f8fafc',
      overflow: 'hidden',
      position: 'relative'
    }}>
      {/* Barra de Menú Superior con estilo unificado para todos los dispositivos */}
      <header className="w-full bg-white border-b border-slate-200 z-50 shadow-sm flex flex-row items-center justify-between gap-2 py-1.5 px-3 md:px-6">
        
        {/* Bloque 1: Logo */}
        <div className="flex items-center flex-shrink-0">
          {/* Logo */}
          <div className="flex flex-col select-none">
            <span className="text-lg md:text-3xl font-black italic uppercase tracking-tighter text-slate-900 leading-[0.75] md:leading-[0.8]">Sherlo</span>
            <span className="text-lg md:text-3xl font-black italic uppercase tracking-tighter text-brand leading-[0.75] md:leading-[0.8] -mt-1 md:-mt-1.5 pl-3 md:pl-5">Tracks</span>
          </div>
        </div>

        {/* Bloque 2: Botones de Acción */}
        <div className="flex flex-row gap-1.5 md:gap-2.5 w-auto items-center justify-end flex-shrink-0">
          {/* Botón único de Sincronización */}
          <button 
            onClick={() => syncActivities()}
            disabled={loading || syncStatus === 'syncing'}
            className={`mode-btn mode-btn-sync ${syncStatus === 'syncing' ? 'mode-btn-active' : ''}`}
          >
            <span className="mode-btn-icon">
              <RefreshCw className={`w-3.5 h-3.5 md:w-4 md:h-4 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
            </span>
            <span>{syncStatus === 'syncing' ? 'Sync...' : 'Sync'}</span>
          </button>

          {/* Botón Ver (Filtros y estadísticas) */}
          <button 
            onClick={() => setShowVerModal(true)}
            className="flex-none mode-btn mode-btn-ver"
          >
            <span className="mode-btn-icon">
              <Eye className="w-3.5 h-3.5 md:w-4 md:h-4" />
            </span>
            <span>Ver</span>
          </button>
          
          <button 
            onClick={toggleCrucesMode}
            className={`flex-none mode-btn mode-btn-cruces ${crucesMode ? 'mode-btn-active' : ''}`}
          >
            <span className="mode-btn-icon">
              <MapPin className="w-3.5 h-3.5 md:w-4 md:h-4" strokeWidth={crucesMode ? 3 : 2} />
            </span>
            <span>{crucesMode ? 'Salir' : 'Cruces'}</span>
          </button>
          <button 
            onClick={toggleHistoricalMode}
            className={`flex-none mode-btn mode-btn-historical ${historicalMode ? 'mode-btn-active' : ''}`}
            style={{
              backgroundColor: historicalMode ? '#8b5cf6' : '',
              borderColor: historicalMode ? '#7c3aed' : '',
              color: historicalMode ? '#ffffff' : ''
            }}
            title="Analizar tramos históricos entre cruces para el minisite"
          >
            <span className="mode-btn-icon">
              <History className="w-3.5 h-3.5 md:w-4 md:h-4" strokeWidth={historicalMode ? 3 : 2} />
            </span>
            <span>{historicalMode ? 'Salir' : 'Histórico'}</span>
          </button>
          <button 
            onClick={toggleMinisiteEditorMode}
            className={`flex-none mode-btn mode-btn-minisite ${minisiteEditorMode ? 'mode-btn-active' : ''}`}
          >
            <span className="mode-btn-icon">
              <Edit3 className="w-3.5 h-3.5 md:w-4 md:h-4" strokeWidth={minisiteEditorMode ? 3 : 2} />
            </span>
            <span>{minisiteEditorMode ? 'Salir' : 'Minisite'}</span>
          </button>
        </div>
      </header>

      {/* Contenedor del Mapa (Ocupa el resto) */}
      <main 
        style={{ height: '100%', width: '100%', position: 'relative', overflow: 'hidden' }}
      >
        <MapView 
          activities={filteredActivities} 
          crucesMode={crucesMode}
          minisiteEditorMode={minisiteEditorMode}
          historicalMode={historicalMode}
          historicalYears={historicalYears}
        />
      </main>

      {/* Ventana Emergente de Sincronización */}
      {syncStatus !== 'idle' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            padding: '2rem',
            maxWidth: '440px',
            width: '90%',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            border: '1px solid #e2e8f0',
          }}>
            {syncStatus === 'syncing' && (
              <>
                <svg className="animate-spin" style={{ width: '40px', height: '40px', color: '#FC4C02', marginBottom: '1.5rem' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', marginBottom: '0.5rem', fontFamily: 'system-ui' }}>Sincronizando con Garmin</h3>
                <p style={{ fontSize: '14px', color: '#64748b', margin: 0, fontFamily: 'system-ui', lineHeight: '1.5' }}>
                  Por favor, espera mientras importamos tus rutas de Garmin Connect. Esto puede tardar un momento...
                </p>
              </>
            )}

            {syncStatus === 'success' && (
              <>
                <div style={{
                  width: '56px',
                  height: '56px',
                  backgroundColor: '#dcfce7',
                  color: '#16a34a',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '24px',
                  fontWeight: 'bold',
                  marginBottom: '1.25rem'
                }}>✓</div>
                <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', marginBottom: '0.5rem', fontFamily: 'system-ui' }}>Sincronización Exitosa</h3>
                <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '1.5rem', fontFamily: 'system-ui', lineHeight: '1.5' }}>
                  Se han añadido con éxito <strong>{syncCount}</strong> nuevas rutas de Garmin Connect.
                </p>
                <button 
                  onClick={() => setSyncStatus('idle')}
                  style={{
                    backgroundColor: '#FC4C02',
                    color: 'white',
                    fontWeight: 'bold',
                    fontSize: '14px',
                    padding: '10px 28px',
                    borderRadius: '8px',
                    border: 'none',
                    cursor: 'pointer',
                    boxShadow: '0 4px 6px -1px rgba(252, 76, 2, 0.2)',
                    transition: 'all 0.2s',
                  }}
                  onMouseOver={(e) => e.target.style.backgroundColor = '#d93f00'}
                  onMouseOut={(e) => e.target.style.backgroundColor = '#FC4C02'}
                >
                  Aceptar
                </button>
              </>
            )}

            {syncStatus === 'error' && (
              <>
                <div style={{
                  width: '56px',
                  height: '56px',
                  backgroundColor: '#fee2e2',
                  color: '#dc2626',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '24px',
                  fontWeight: 'bold',
                  marginBottom: '1.25rem'
                }}>✗</div>
                <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', marginBottom: '0.5rem', fontFamily: 'system-ui' }}>Error al Sincronizar</h3>
                <div style={{
                  maxHeight: '150px',
                  overflowY: 'auto',
                  width: '100%',
                  backgroundColor: '#fef2f2',
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid #fee2e2',
                  marginBottom: '1.5rem'
                }}>
                  <p style={{ fontSize: '13px', color: '#dc2626', margin: 0, textAlign: 'left', wordBreak: 'break-word', fontFamily: 'monospace' }}>
                    {syncMessage}
                  </p>
                </div>
                <button 
                  onClick={() => setSyncStatus('idle')}
                  style={{
                    backgroundColor: '#64748b',
                    color: 'white',
                    fontWeight: 'bold',
                    fontSize: '14px',
                    padding: '10px 28px',
                    borderRadius: '8px',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseOver={(e) => e.target.style.backgroundColor = '#475569'}
                  onMouseOut={(e) => e.target.style.backgroundColor = '#64748b'}
                >
                  Cerrar
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Ventana Emergente "Ver" (Filtros y estadísticas en móvil) */}
      {showVerModal && (
        <div 
          onClick={() => setShowVerModal(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(15, 23, 42, 0.5)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'white',
              borderRadius: '16px',
              padding: '1.25rem',
              maxWidth: '320px',
              width: '85%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              border: '1px solid #e2e8f0',
              position: 'relative'
            }}
          >
            {/* Cabecera del modal */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="font-extrabold text-[11px] uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                <Filter size={14} className="text-brand" />
                Opciones de Vista
              </h3>
              <button 
                onClick={() => setShowVerModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors p-1"
              >
                <X size={16} />
              </button>
            </div>

            {/* Rango de Tiempo */}
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-black uppercase text-slate-400">Ver última:</span>
              <select 
                value={timeFilter}
                onChange={(e) => setTimeFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800 transition-all focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand cursor-pointer shadow-sm w-full"
              >
                {timeOptions.map(opt => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            </div>



            {/* Estadísticas */}
            <div className="flex flex-col gap-1 border-t border-slate-100 pt-2.5">
              <span className="text-[9px] font-black uppercase text-slate-400">Estadísticas:</span>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-50 border border-slate-100 rounded-lg p-2 flex flex-col items-center">
                  <span className="text-[8px] font-extrabold uppercase text-slate-400">Actividades</span>
                  <span className="text-xs font-black text-slate-800">{filteredActivities.length}</span>
                </div>
                <div className="bg-slate-50 border border-slate-100 rounded-lg p-2 flex flex-col items-center">
                  <span className="text-[8px] font-extrabold uppercase text-slate-400">Distancia</span>
                  <span className="text-xs font-black text-brand">
                    {(filteredActivities.reduce((acc, curr) => acc + curr.distance, 0) / 1000).toFixed(0)} <span className="text-[9px] font-normal text-slate-500 lowercase">km</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Botón de cerrar */}
            <button 
              onClick={() => setShowVerModal(false)}
              className="mt-1 bg-slate-900 hover:bg-black text-white font-bold text-[10px] uppercase tracking-wider py-2 rounded-lg transition-colors shadow active:scale-95"
            >
              Aplicar y Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Ventana Emergente de Carga Inicial */}
      {loading && syncStatus === 'idle' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99999,
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            padding: '2rem',
            maxWidth: '360px',
            width: '90%',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: '1.25rem',
            border: '1px solid #e2e8f0',
          }}>
            {/* Icono con animación de pulso */}
            <div className="text-brand animate-pulse bg-brand/10 p-4 rounded-full">
              <Activity size={32} className="text-brand" />
            </div>
            
            {/* Texto */}
            <div className="flex flex-col gap-1.5">
              <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: 0, fontFamily: 'system-ui' }}>
                Cargando SherloTracks
              </h3>
              <p style={{ fontSize: '13px', color: '#64748b', margin: 0, fontFamily: 'system-ui', lineHeight: '1.5' }}>
                Estamos cargando y dibujando las rutas en el mapa. Esto puede tomar unos segundos...
              </p>
            </div>

            {/* Texto de Progreso */}
            <div className="flex flex-col gap-1 w-full items-center">
              <span className="text-[11px] font-black text-slate-600 uppercase tracking-wider">
                {loadingProgress > 0 ? `Descargando: ${loadingProgress}%` : 'Conectando con el servidor...'}
              </span>
              {loadedBytes > 0 && (
                <span className="text-[10px] font-bold text-slate-400">
                  {totalBytes > 0 
                    ? `${(loadedBytes / (1024 * 1024)).toFixed(1)} MB / ${(totalBytes / (1024 * 1024)).toFixed(1)} MB`
                    : `${(loadedBytes / (1024 * 1024)).toFixed(1)} MB`
                  }
                </span>
              )}
            </div>

            {/* Barra de carga animada */}
            <div style={{
              width: '100%',
              height: '6px',
              backgroundColor: '#f1f5f9',
              borderRadius: '9999px',
              overflow: 'hidden',
              position: 'relative',
              border: '1px solid #e2e8f0',
              marginTop: '0.1rem'
            }}>
              <div style={{
                position: 'absolute',
                height: '100%',
                backgroundColor: '#FC4C02',
                borderRadius: '9999px',
                width: `${loadingProgress || 5}%`,
                transition: 'width 0.15s ease-out'
              }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
