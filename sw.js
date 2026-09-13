const TILE_CACHE_NAME = 'carto-tiles-v1';
const STATIC_CACHE_NAME = 'avyo-static-v4';

// Thêm 'offline.html' vào danh sách cache tĩnh
const STATIC_ASSETS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'utils.js',
  'index.css',
  'index.js',
  'driver.css',
  'driver.js',
  'admin.css',
  'admin.js',
  'offline.html'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// 1. TỰ ĐỘNG XÓA CACHE CŨ KHI NÂNG CẤP PHIÊN BẢN V4
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== TILE_CACHE_NAME && cache !== STATIC_CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const requestUrl = event.request.url;

  if (event.request.method !== 'GET') return;

  // 2. CACHE CÁC FILE MÃ NGUỒN TĨNH (.CSS, .JS, UTILS, OFFLINE.HTML)
  if (STATIC_ASSETS.some(url => requestUrl.includes(url))) {
    event.respondWith(
      caches.open(STATIC_CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          return fetch(event.request).then((networkResponse) => {
            if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          });
        });
      })
    );
    return;
  }

  // 3. CACHE MẢNH HÌNH ẢNH BẢN ĐỒ CARTODB
  if (requestUrl.includes('basemaps.cartocdn.com')) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          return fetch(event.request).then((networkResponse) => {
            if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          });
        });
      })
    );
    return;
  }

  // 4. ĐỔI HƯỚNG TỰ ĐỘNG SANG OFFLINE.HTML KHI MẤT MẠNG LÚC MỞ TRANG
  if (event.request.mode === 'navigate' || (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'))) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('offline.html');
      })
    );
    return;
  }

  event.respondWith(fetch(event.request));
});