const CACHE_NAME = 'sherlotracks-cache-v1';
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './minisite_cruces.json',
    './minisite_tramos.json',
    './favicon.png',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Outfit:wght@500;700;800;900&display=swap'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    // Excluir esquemas que no sean http/https (como chrome-extension, gvfs, etc.)
    if (!e.request.url.startsWith('http')) return;

    const isJsonData = e.request.url.includes('.json');

    if (isJsonData) {
        // Estrategia Network-First para archivos de datos JSON (Cruces y Tramos)
        // Permite recargar datos frescos al instante si hay internet, y mantiene soporte offline
        e.respondWith(
            fetch(e.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(e.request, responseToCache);
                    });
                    return networkResponse;
                }
                return networkResponse;
            }).catch(() => {
                // Fallback offline al caché local
                return caches.match(e.request);
            })
        );
        return;
    }

    // Estrategia Cache-First para recursos estáticos (imágenes, scripts, estilos, fuentes)
    e.respondWith(
        caches.match(e.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }

            return fetch(e.request).then((networkResponse) => {
                if (!networkResponse || networkResponse.status !== 200) {
                    return networkResponse;
                }

                // Cachar dinámicamente si es un recurso de nuestro origen o fuentes/Leaflet
                const isCachable = e.request.url.includes(self.location.origin) || 
                                   e.request.url.includes('unpkg.com') || 
                                   e.request.url.includes('fonts.googleapis.com') || 
                                   e.request.url.includes('fonts.gstatic.com');

                if (isCachable) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(e.request, responseToCache);
                    });
                }

                return networkResponse;
            }).catch(() => {
                // Fallback offline silencioso
                return null;
            });
        })
    );
});
