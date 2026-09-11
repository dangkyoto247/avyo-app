self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  // Bỏ qua cache để luôn lấy code mới nhất, không bị lỗi lưu web cũ
});