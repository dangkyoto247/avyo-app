const TILE_CACHE_NAME = 'carto-tiles-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  const requestUrl = event.request.url;

  // 1. CHỈ CACHE MẢNH ẢNH BẢN ĐỒ CARTODB (Tải siêu nhanh & tiết kiệm 4G)
  if (requestUrl.includes('basemaps.cartocdn.com')) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          return fetch(event.request).then((networkResponse) => {
            // Lưu bản sao mảnh bản đồ vào cache cho lần dùng sau
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        });
      })
    );
    return;
  }

  // 2. MÃ NGUỒN APP (HTML, JS, CSS): Luôn lấy từ mạng (Network Only)
  // Đảm bảo mỗi khi bạn sửa code, máy khách sẽ cập nhật ngay lập tức
  event.respondWith(fetch(event.request));
});