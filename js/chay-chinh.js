// CHẠY LẦN ĐẦU KHI VÀO TRANG
document.addEventListener('DOMContentLoaded', () => {
  const activeLabel = document.getElementById('activeVehicleLabel');
  if (activeLabel && typeIcons[activeFilter]) {
    activeLabel.innerHTML = typeIcons[activeFilter];
  }
  document.querySelectorAll('.vehicle-option').forEach(opt => {
    if (opt.getAttribute('onclick')?.includes(`'${activeFilter}'`)) {
      opt.classList.add('active');
    } else {
      opt.classList.remove('active');
    }
  });
  updateSwapButtonVisibility();
  updateNetworkStatus();
});

// THIẾT LẬP APP KHI KHỞI ĐỘNG
enterSelectionMode('pickup');
loadDrivers();
updateGuide();

// VÒNG LẶP TỰ ĐỘNG CẬP NHẬT TÀI XẾ MỖI 12 GIÂY
setInterval(() => {
  if (typeof loadDrivers === 'function') {
    loadDrivers();
  }
}, 12000);

// ĐĂNG KÝ SERVICE WORKER BỘ NHỚ ĐỆM BẢN ĐỒ
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.update();
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            window.location.reload();
          }
        });
      }
    });
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}