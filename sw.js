const TILE_CACHE_NAME = 'map-tiles-v2';
const STATIC_CACHE_NAME = 'avyo-static-v6';
const MAX_TILE_LIMIT = 150; // Giới hạn tối đa 150 mảnh bản đồ gần nhất

const STATIC_ASSETS = [
  '/',
  'index.html',
  'driver.html',
  'admin.html',
  'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;800&display=swap',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'js/utils.js',
  'js/admin/admin.js',
  'js/driver/driver.js',
  'js/index/cau-hinh.js',
  'js/index/giao-dien.js',
  'js/index/ban-do.js',
  'js/index/tai-xe.js',
  'js/index/chay-chinh.js',
  'css/index.css',
  'css/driver.css',
  'css/admin.css',
  'offline.html'
];

// Hàm giới hạn dung lượng cache bản đồ (Xóa tile cũ nhất khi vượt quá giới hạn)
async function trimCache(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      await cache.delete(keys[0]); // Xóa item cũ nhất (đầu danh sách)
      trimCache(cacheName, maxItems); // Đệ quy xóa tiếp nếu vẫn đống dư
    }
  } catch (e) {
    console.warn('Lỗi khi dọn dẹp cache bản đồ:', e);
  }
}

// Hàm làm sạch Response an toàn
async function cleanResponse(response) {
  if (!response) return response;
  
  if (response.type === 'opaque' || !response.ok) {
    return response;
  }

  try {
    const clonedRes = response.clone();
    const blob = await clonedRes.blob();
    const headers = new Headers(clonedRes.headers);
    return new Response(blob, {
      status: clonedRes.status,
      statusText: clonedRes.statusText,
      headers: headers
    });
  } catch (e) {
    return response;
  }
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

  // 1. Xử lý tài nguyên Tĩnh (Static Assets)
  if (STATIC_ASSETS.some(url => requestUrl.includes(url))) {
    event.respondWith(
      caches.open(STATIC_CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(event.request, { ignoreSearch: true });
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
          return Response.error();
        }
      })
    );
    return;
  }

  // 2. Xử lý Cache mảnh bản đồ (Map Tiles) - Có giới hạn 150 tiles tối đa
  if (requestUrl.includes('google.com/vt') || requestUrl.includes('mapbox.com') || requestUrl.includes('arcgisonline.com')) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) return cachedResponse;
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            cache.put(event.request, networkResponse.clone());
            // Kích hoạt tự động dọn dẹp nếu vượt quá 150 tiles
            trimCache(TILE_CACHE_NAME, MAX_TILE_LIMIT);
          }
          return networkResponse;
        } catch (e) {
          return Response.error();
        }
      })
    );
    return;
  }

  // 3. Xử lý Điều hướng trang HTML (Navigation Fallback)
  if (event.request.mode === 'navigate' || (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'))) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(event.request, { redirect: 'follow' });
          return await cleanResponse(response);
        } catch (err) {
          const cache = await caches.open(STATIC_CACHE_NAME);
          
          const cachedPage = await cache.match(event.request, { ignoreSearch: true });
          if (cachedPage) return cachedPage;

          const cachedOffline = await cache.match('offline.html', { ignoreSearch: true });
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