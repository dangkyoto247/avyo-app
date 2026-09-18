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

  // ==========================================================================
  // ĐÓN LINK TỪ GOOGLE MAPS BẮN SANG (TÍNH NĂNG WEB SHARE TARGET)
  // ==========================================================================
  const urlParams = new URLSearchParams(window.location.search);
  const sharedText = urlParams.get('text') || '';
  const sharedUrl = urlParams.get('url') || '';
  const combinedShare = sharedText + " " + sharedUrl;

  // Tìm kiếm link Google Maps trong nội dung được chia sẻ
  const ggmapLinkRegex = /(https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl|www\.google\.com\/maps)[^\s]+)/i;
  const match = combinedShare.match(ggmapLinkRegex);

  if (match) {
    const extractedLink = match[1];
    const inputEl = document.getElementById('ggmapLinkInput');
    if (inputEl) {
      inputEl.value = extractedLink;
      
      // Trì hoãn 1 chút để DOM tải xong bản đồ rồi mới chạy hàm bóc tách
      setTimeout(() => {
        if (typeof handleGgmapLinkInput === 'function') {
          handleGgmapLinkInput();
        }
      }, 500);
    }
    
    // Xóa các tham số trên thanh địa chỉ URL để tránh reload bị chạy lại link cũ
    window.history.replaceState({}, document.title, window.location.pathname);
  }
});

// THIẾT LẬP APP KHI KHỞI ĐỘNG
if (typeof enterSelectionMode === 'function') enterSelectionMode('pickup');
if (typeof loadDrivers === 'function') loadDrivers();
if (typeof updateGuide === 'function') updateGuide();

// ============================================================================
// LẮNG NGHE LỚP DỮ LIỆU REALTIME (THAY THẾ CHO POLLING 12 GIÂY)
// ============================================================================
let customerDriversChannel = null;

function initCustomerRealtime() {
  if (customerDriversChannel) {
    supabaseClient.removeChannel(customerDriversChannel);
    customerDriversChannel = null;
  }

  // Lắng nghe biến động vị trí GPS hoặc trạng thái On/Off của tài xế
  customerDriversChannel = supabaseClient.channel('customer-drivers-realtime')
    .on('postgres_changes', {
      event: '*', // Nhận sự kiện INSERT, UPDATE, DELETE
      schema: 'public',
      table: 'drivers'
    }, (payload) => {
      if (typeof loadDrivers === 'function') {
        loadDrivers();
      }
    })
    .subscribe();
}

// Khởi tạo Realtime ngay khi vào trang
initCustomerRealtime();

// Quản lý băng thông: Ngắt WebSocket khi ẩn Tab và kết nối lại khi quay lại ứng dụng
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

// TỰ ĐỘNG TÁI KẾT NỐI REALTIME KHI THIẾT BỊ CÓ MẠNG TRỞ LẠI (OFFLINE -> ONLINE)
window.addEventListener('online', () => {
  if (typeof updateNetworkStatus === 'function') updateNetworkStatus();
  if (typeof loadDrivers === 'function') loadDrivers();
  initCustomerRealtime();
});

// ============================================================================
// TÍNH NĂNG CÀI ĐẶT ỨNG DỤNG PWA ("THÊM VÀO MÀN HÌNH CHÍNH")
// ============================================================================
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  // Ngăn chặn hộp thoại cài đặt mặc định của trình duyệt
  e.preventDefault();
  deferredPrompt = e;
  // Hiển thị tùy chọn "📲 Cài đặt ứng dụng Avyo" trên Menu Popover
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
    
    // Kích hoạt hộp thoại cài đặt ứng dụng chuẩn của hệ điều hành
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      console.log('✅ Khách hàng đã cài đặt ứng dụng Avyo!');
    }
    
    deferredPrompt = null;
    installOption.remove();
    if (typeof toggleTopMenu === 'function') toggleTopMenu();
  };

  // Đưa tùy chọn cài đặt lên vị trí đầu tiên của Menu
  topMenuPopover.prepend(installOption);
}

// Ẩn nút nếu ứng dụng đã được cài đặt thành công
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  const option = document.getElementById('pwaInstallOption');
  if (option) option.remove();
});

// ============================================================================
// QUẢN LÝ SERVICE WORKER (TỐI ƯU UX: KHÔNG FORCE RELOAD TỰ ĐỘNG)
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

/**
 * Hiển thị mẩu thông báo nhỏ cập nhật ứng dụng ở góc trên màn hình
 */
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