// CHẠY LẦN ĐẦU KHI VÀO TRANG
document.addEventListener('DOMContentLoaded', () => {
  const activeLabel = document.getElementById('activeVehicleLabel');
  if (activeLabel && typeof typeIcons !== 'undefined' && typeIcons[activeFilter]) {
    activeLabel.innerHTML = typeIcons[activeFilter];
  }
  document.querySelectorAll('.vehicle-option').forEach(opt => {
    if (opt.getAttribute('onclick')?.includes(`'${activeFilter}'`)) {
      opt.classList.add('active');
    } else {
      opt.classList.remove('active');
    }
  });
  if (typeof updateSwapButtonVisibility === 'function') updateSwapButtonVisibility();
  if (typeof updateNetworkStatus === 'function') updateNetworkStatus();
});

// THIẾT LẬP APP KHI KHỞI ĐỘNG
if (typeof enterSelectionMode === 'function') enterSelectionMode('pickup');
if (typeof loadDrivers === 'function') loadDrivers();
if (typeof updateGuide === 'function') updateGuide();

// ============================================================================
// LẮNG NGHE LỚP DỮ LIỆU REALTIME
// ============================================================================
let customerDriversChannel = null;

function initCustomerRealtime() {
  if (customerDriversChannel) {
    supabaseClient.removeChannel(customerDriversChannel);
    customerDriversChannel = null;
  }

  customerDriversChannel = supabaseClient.channel('customer-drivers-realtime')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'drivers'
    }, (payload) => {
      if (typeof loadDrivers === 'function') {
        loadDrivers();
      }
    })
    .subscribe();
}

initCustomerRealtime();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (customerDriversChannel) {
      supabaseClient.removeChannel(customerDriversChannel);
      customerDriversChannel = null;
    }
  } else {
    if (typeof loadDrivers === 'function') loadDrivers();
    initCustomerRealtime();
  }
});

window.addEventListener('online', () => {
  if (typeof updateNetworkStatus === 'function') updateNetworkStatus();
  if (typeof loadDrivers === 'function') loadDrivers();
  initCustomerRealtime();
});

// ============================================================================
// TÍNH NĂNG CÀI ĐẶT ỨNG DỤNG PWA
// ============================================================================
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showPwaInstallOption();
});

function showPwaInstallOption() {
  const topMenuPopover = document.getElementById('topMenuPopover');
  if (!topMenuPopover || document.getElementById('pwaInstallOption')) return;

  const installOption = document.createElement('div');
  installOption.id = 'pwaInstallOption';
  installOption.className = 'top-menu-option';
  installOption.style.color = '#00b14f';
  installOption.style.fontWeight = 'bold';
  installOption.innerHTML = '📲 Cài đặt ứng dụng Avyo';

  installOption.onclick = async () => {
    if (!deferredPrompt) return;
    
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      console.log('✅ Khách hàng đã cài đặt ứng dụng Avyo!');
    }
    
    deferredPrompt = null;
    installOption.remove();
    if (typeof toggleTopMenu === 'function') toggleTopMenu();
  };

  topMenuPopover.prepend(installOption);
}

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  const option = document.getElementById('pwaInstallOption');
  if (option) option.remove();
});

// ============================================================================
// QUẢN LÝ SERVICE WORKER
// ============================================================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.update();
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateToast();
          }
        });
      }
    });
  });
}

function showUpdateToast() {
  if (document.getElementById('pwaUpdateToast')) return;

  const toast = document.createElement('div');
  toast.id = 'pwaUpdateToast';
  toast.style.cssText = `
    position: fixed;
    top: calc(12px + env(safe-area-inset-top, 0px));
    left: 50%;
    transform: translateX(-50%);
    background: #0f172a;
    color: #ffffff;
    padding: 8px 14px;
    border-radius: 20px;
    font-size: 12.5px;
    font-weight: 600;
    z-index: 1000000;
    box-shadow: 0 4px 20px rgba(0,0,0,0.25);
    display: flex;
    align-items: center;
    gap: 10px;
    border: 1px solid #334155;
    white-space: nowrap;
  `;

  toast.innerHTML = `
    <span>⚡ Đã có bản cập nhật mới</span>
    <button onclick="window.location.reload()" style="
      background: #00b14f;
      color: white;
      border: none;
      padding: 4px 10px;
      border-radius: 12px;
      font-weight: bold;
      font-size: 11.5px;
      cursor: pointer;
    ">Tải lại</button>
  `;

  document.body.appendChild(toast);
}