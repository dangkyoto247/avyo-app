const TILE_CACHE_NAME = 'map-tiles-v2';
const STATIC_CACHE_NAME = 'avyo-static-v65';

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
  'admin.html',
  'driver.html',
  'offline.html'
];

async function cleanResponse(response) {
  if (!response || (!response.ok && response.type !== 'opaque')) return response;
  const blob = await response.blob();
  const headers = new Headers(response.headers);
  return new Response(blob, {
    status: 200,
    statusText: 'OK',
    headers: headers
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then(async (cache) => {
      for (const asset of STATIC_ASSETS) {
        try {
          const res = await fetch(asset, { redirect: 'follow' });
          if (res.ok || res.type === 'opaque') {
            const cleaned = await cleanResponse(res);
            await cache.put(asset, cleaned);
          }
        } catch (e) {
          console.log('Cache failed for asset:', asset);
        }
      }
    })
  );
  self.skipWaiting();
});

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

  if (requestUrl.includes('weserv.nl') || requestUrl.includes('flaticon.com')) {
    return;
  }

  if (STATIC_ASSETS.some(url => requestUrl.includes(url))) {
    event.respondWith(
      caches.open(STATIC_CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) return cachedResponse;
        try {
          const networkResponse = await fetch(event.request, { redirect: 'follow' });
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            const cleaned = await cleanResponse(networkResponse);
            cache.put(event.request, cleaned.clone());
            return cleaned;
          }
          return networkResponse;
        } catch (e) {
          return null;
        }
      })
    );
    return;
  }

  if (requestUrl.includes('google.com/vt') || requestUrl.includes('mapbox.com') || requestUrl.includes('arcgisonline.com')) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) return cachedResponse;
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        } catch (e) {
          return null;
        }
      })
    );
    return;
  }

  if (event.request.mode === 'navigate' || (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'))) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(event.request, { redirect: 'follow' });
          return await cleanResponse(response);
        } catch (err) {
          const cache = await caches.open(STATIC_CACHE_NAME);
          const cachedOffline = await cache.match('offline.html');
          if (cachedOffline) return cachedOffline;
          
          return new Response(
            '<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Avyo Offline</title><style>body{font-family:sans-serif;text-align:center;padding:40px 20px;background:#f8fafc;color:#334155}.card{background:white;padding:30px 20px;border-radius:16px;max-width:360px;margin:auto;box-shadow:0 4px 12px rgba(0,0,0,.08)}h2{color:#dc2626;margin-top:0}button{background:#00b14f;color:#fff;border:none;padding:12px 24px;border-radius:10px;font-weight:700;width:100%;margin-top:15px}</style></head><body><div class="card"><h2>📡 Mất kết nối Internet</h2><p>Không thể kết nối đến máy chủ Avyo. Vui lòng kiểm tra lại 4G/Wifi.</p><button onclick="window.location.href=\'./\'">🔄 THỬ LẠI KẾT NỐI</button></div></body></html>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }
      })()
    );
    return;
  }

  event.respondWith(fetch(event.request));
});