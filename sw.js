const TILE_CACHE_NAME = 'carto-tiles-v1';
const STATIC_CACHE_NAME = 'avyo-static-v5';

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

// 1. TẢI VÀ LƯU TRƯỚC (PRE-CACHE) TỆP OFFLINE VÀ MÃ NGUỒN NGAY KHI CÀI ĐẶT
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => {
      return cache.addAll([
        'offline.html',
        'utils.js',
        'index.css',
        'index.js',
        'driver.css',
        'driver.js',
        'admin.css',
        'admin.js'
      ]).catch(err => console.log('Pre-cache error:', err));
    })
  );
  self.skipWaiting();
});

// 2. TỰ ĐỘNG XÓA CACHE CŨ KHI NÂNG CẤP PHIÊN BẢN V5
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

  // 3. THƯ VIỆN & MÃ NGUỒN TĨNH
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

  // 4. MẢNH HÌNH ẢNH BẢN ĐỒ CARTODB
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

  // 5. TRUY CẬP TRANG GIAO DIỆN (HTML)
  if (event.request.mode === 'navigate' || (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'))) {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cachedOffline = await caches.match('offline.html');
        if (cachedOffline) return cachedOffline;
        
        // Dự phòng an toàn tuyệt đối nếu tệp offline.html chưa kịp nạp
        return new Response(
          '<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Avyo Offline</title><style>body{font-family:sans-serif;text-align:center;padding:40px 20px;background:#f8fafc;color:#334155}.card{background:white;padding:30px 20px;border-radius:16px;max-width:360px;margin:auto;box-shadow:0 4px 12px rgba(0,0,0,.08)}h2{color:#dc2626;margin-top:0}button{background:#00b14f;color:#fff;border:none;padding:12px 24px;border-radius:10px;font-weight:700;width:100%;margin-top:15px}</style></head><body><div class="card"><h2>📡 Mất kết nối Internet</h2><p>Không thể kết nối đến máy chủ Avyo. Vui lòng kiểm tra lại 4G/Wifi.</p><button onclick="window.location.reload()">🔄 THỬ LẠI</button></div></body></html>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      })
    );
    return;
  }

  event.respondWith(fetch(event.request));
});