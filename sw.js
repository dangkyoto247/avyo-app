const TILE_CACHE_NAME = 'carto-tiles-v1';
const STATIC_CACHE_NAME = 'avyo-static-v1';

// Danh sách các thư viện CDN dùng chung được lưu offline
const STATIC_ASSETS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// 1. TỰ ĐỘNG XÓA CACHE CỦ KHI NÂNG CẤP PHIÊN BẢN
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

  // Bỏ qua các yêu cầu không phải GET (như POST, PUT)
  if (event.request.method !== 'GET') return;

  // 2. CACHE CÁC FILE THƯ VIỆN CDN DÙNG CHUNG
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

  // 4. MÃ NGUỒN APP (HTML, JS, CSS): Luôn đi thẳng ra mạng để cập nhật mới tức thì
  event.respondWith(fetch(event.request));
});