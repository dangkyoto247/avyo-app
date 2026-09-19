// CHẶN PHÓNG TO THU NHỎ GIAO DIỆN KHI DÙNG GESTURE TRÊN ĐIỆN THOẠI
document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
document.addEventListener('gesturechange', function (e) { e.preventDefault(); });
document.addEventListener('gestureend', function (e) { e.preventDefault(); });

// HÀM SAO CHÉP (COPY TO CLIPBOARD)
function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => { fallbackCopyTextToClipboard(text); });
  } else {
    fallbackCopyTextToClipboard(text);
  }
}

function fallbackCopyTextToClipboard(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.width = "2em";
  textArea.style.height = "2em";
  textArea.style.padding = "0";
  textArea.style.border = "none";
  textArea.style.outline = "none";
  textArea.style.boxShadow = "none";
  textArea.style.background = "transparent";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try { document.execCommand('copy'); } catch (err) { console.warn('Lỗi sao chép thủ công:', err); }
  document.body.removeChild(textArea);
}

// CÁC HÀM XỬ LÝ GIAO DIỆN CƠ BẢN
function switchTab(tabName, event) {
  if (event) event.preventDefault();
  document.querySelectorAll('.app-bottom-nav .nav-item').forEach(btn => btn.classList.remove('active'));
  if (event && event.currentTarget) event.currentTarget.classList.add('active');

  if (tabName === 'trips') alert('🚗 Tính năng Các cuốc xe đang được phát triển!');
  else if (tabName === 'favorites') alert('⭐ Tính năng Địa chỉ Yêu thích đang được phát triển!');
  else if (tabName === 'menu') toggleTopMenu();
}

function updateSwapButtonVisibility() {
  const swapBtn = document.querySelector('.btn-swap-route');
  if (!swapBtn) return;
  if (markerStart && markerEnd) swapBtn.style.display = 'flex';
  else swapBtn.style.display = 'none';
}

function updateNetworkStatus() {
  const bar = document.getElementById('networkOfflineBar');
  if (!bar) return;

  if (!navigator.onLine) {
    bar.innerText = '⚠️ Mất kết nối Internet. Đang chờ sóng 4G/Wifi...';
    bar.classList.remove('online-back');
    bar.classList.add('show');
  } else {
    if (bar.classList.contains('show')) {
      bar.innerText = '✅ Đã kết nối lại Internet';
      bar.classList.add('online-back');
      setTimeout(() => { bar.classList.remove('show', 'online-back'); }, 2500);
    }
  }
}

window.addEventListener('offline', updateNetworkStatus);
window.addEventListener('online', updateNetworkStatus);

// XỬ LÝ FOCUS Ô NHẬP & BÀN PHÍM
function handleInputEnter(event, type) {
  const listEl = document.getElementById(type + 'Suggestions');
  const isListVisible = listEl && listEl.style.display !== 'none';

  if (!isListVisible) {
    if (event.key === 'Enter') {
      event.preventDefault();
      onSearchInput(type, true);
    }
    return;
  }

  const items = listEl.querySelectorAll('.suggestion-item');
  if (items.length === 0) return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    activeSuggestionIndex = (activeSuggestionIndex + 1) % items.length;
    updateHighlightedSuggestion(items);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    activeSuggestionIndex = (activeSuggestionIndex - 1 + items.length) % items.length;
    updateHighlightedSuggestion(items);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (activeSuggestionIndex >= 0 && activeSuggestionIndex < items.length) {
      items[activeSuggestionIndex].click();
    } else if (items.length > 0) {
      items[0].click();
    } else {
      onSearchInput(type, true);
    }
    activeSuggestionIndex = -1;
  } else if (event.key === 'Escape') {
    exitFocusInputMode();
    activeSuggestionIndex = -1;
  }
}

function updateHighlightedSuggestion(items) {
  items.forEach((item, idx) => {
    if (idx === activeSuggestionIndex) {
      item.classList.add('highlighted');
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      item.classList.remove('highlighted');
    }
  });
}

function enterFocusInputMode(type) {
  document.body.classList.remove('focus-pickup', 'focus-dest');
  if (type === 'pickup') document.body.classList.add('focus-pickup');
  else if (type === 'dest') document.body.classList.add('focus-dest');

  window.scrollTo(0, 0);
  setTimeout(() => window.scrollTo(0, 0), 50);
  setTimeout(() => window.scrollTo(0, 0), 200);
}

function exitFocusInputMode(type) {
  document.body.classList.remove('focus-pickup', 'focus-dest');
  if (type) {
    const inputEl = document.getElementById(type + 'Input');
    if (inputEl) inputEl.blur();
    const listEl = document.getElementById(type + 'Suggestions');
    if (listEl) listEl.style.display = 'none';
  } else {
    document.getElementById('pickupInput').blur();
    document.getElementById('destInput').blur();
    document.getElementById('pickupSuggestions').style.display = 'none';
    document.getElementById('destSuggestions').style.display = 'none';
  }
  activeSuggestionIndex = -1;
  
  // HỦY SESSION TÌM KIẾM CỦA GOONG NẾU NGƯỜI DÙNG TẮT Ô NHẬP KHÔNG CHỌN
  if (typeof window.resetSearchSessionToken === 'function') {
    window.resetSearchSessionToken();
  }
}

window.addEventListener('scroll', () => {
  if (document.body.classList.contains('focus-pickup') || document.body.classList.contains('focus-dest')) {
    window.scrollTo(0, 0);
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') exitFocusInputMode(); });

function toggleClearButton(type) {
  const inputEl = document.getElementById(type + 'Input');
  const clearBtn = document.getElementById(type === 'pickup' ? 'clearPickupBtn' : 'clearDestBtn');
  if (inputEl && clearBtn) clearBtn.style.display = inputEl.value.trim().length > 0 ? 'flex' : 'none';
}

function clearInput(type) {
  enterFocusInputMode(type);
  const inputEl = document.getElementById(type + 'Input');
  if (inputEl) {
    inputEl.value = '';
    inputEl.focus();
  }
  toggleClearButton(type);
  if (type === 'pickup') showRecentPickups();
  else showRecentDests();
}

// TOGGLE MENUS VÀ POPUP
function toggleTopMenu() {
  const menu = document.getElementById('topMenuPopover');
  if (menu) {
    const isVisible = menu.style.display === 'flex' || menu.style.display === 'block';
    menu.style.display = isVisible ? 'none' : 'flex';
  }
}

function toggleTop3Drivers() {
  const card = document.getElementById('top3Card');
  const btn = document.getElementById('btnToggleDrivers');
  const arrow = document.getElementById('toggleArrow');
  if (!card) return;

  const isShowing = card.classList.contains('show');
  if (isShowing) {
    card.classList.remove('show');
    if (btn) btn.classList.remove('active');
    if (arrow) arrow.innerText = '▾';
  } else {
    card.classList.add('show');
    if (btn) btn.classList.add('active');
    if (arrow) arrow.innerText = '▴';
  }
}

function openPickupDetailDialog() {
  const overlay = document.getElementById('pickupDetailModalOverlay');
  const input = document.getElementById('pickupDetailInput');
  if (input) input.value = pickupDetailNote;
  if (overlay) overlay.classList.add('active');
  if (input) setTimeout(() => input.focus(), 150);
}

function closePickupDetailDialog() {
  const overlay = document.getElementById('pickupDetailModalOverlay');
  if (overlay) overlay.classList.remove('active');
}

function savePickupDetail() {
  const input = document.getElementById('pickupDetailInput');
  pickupDetailNote = input ? input.value.trim() : '';
  closePickupDetailDialog();

  const btn = document.getElementById('btnPickupDetail');
  if (btn) {
    if (pickupDetailNote) {
      btn.classList.add('has-note');
      btn.innerText = '📝 Đã ghi chú';
    } else {
      btn.classList.remove('has-note');
      btn.innerText = '📝 Chi tiết';
    }
  }
}

// XỬ LÝ LƯU TRỮ VÀ HIỂN THỊ ĐỊA ĐIỂM GẦN ĐÂY
function getRecentPickups() {
  try { return JSON.parse(localStorage.getItem(RECENT_PICKUPS_KEY)) || []; } catch (e) { return []; }
}
function saveRecentPickup(label, lat, lng) {
  if (!label || !lat || !lng) return;
  let list = getRecentPickups();
  list = list.filter(item => item.label !== label && !(Math.abs(item.lat - lat) < 0.0001 && Math.abs(item.lng - lng) < 0.0001));
  list.unshift({ label, lat, lng });
  localStorage.setItem(RECENT_PICKUPS_KEY, JSON.stringify(list.slice(0, 5)));
}
function showRecentPickups() {
  const inputVal = document.getElementById('pickupInput').value.trim();
  if (inputVal.length >= 2) return;
  const listEl = document.getElementById('pickupSuggestions');
  const recents = getRecentPickups();
  if (recents.length === 0) { listEl.style.display = 'none'; return; }
  
  listEl.innerHTML = '<div style="padding: 6px 12px; font-size: 11px; color: #16a34a; font-weight: bold; background: #f0fdf4; border-bottom: 1px solid #e2e8f0;">🕒 ĐIỂM ĐÓN GẦN ĐÂY</div>';
  recents.forEach(item => {
    const div = document.createElement('div');
    div.className = 'suggestion-item';
    div.innerHTML = `🕒 <b>${item.label}</b>`;
    div.onclick = () => {
      if (document.activeElement) document.activeElement.blur();
      document.getElementById('pickupInput').value = item.label;
      toggleClearButton('pickup');
      listEl.style.display = 'none';
      setPickupLocation(L.latLng(item.lat, item.lng));
      saveRecentPickup(item.label, item.lat, item.lng);
      exitFocusInputMode('pickup');
      if (!markerEnd) enterSelectionMode('dest'); else exitSelectionMode();
    };
    listEl.appendChild(div);
  });
  listEl.style.display = 'block';
}

function getRecentDests() {
  try { return JSON.parse(localStorage.getItem(RECENT_DESTS_KEY)) || []; } catch (e) { return []; }
}
function saveRecentDest(label, lat, lng) {
  if (!label || !lat || !lng) return;
  let list = getRecentDests();
  list = list.filter(item => item.label !== label && !(Math.abs(item.lat - lat) < 0.0001 && Math.abs(item.lng - lng) < 0.0001));
  list.unshift({ label, lat, lng });
  localStorage.setItem(RECENT_DESTS_KEY, JSON.stringify(list.slice(0, 5)));
}
function showRecentDests() {
  const inputVal = document.getElementById('destInput').value.trim();
  if (inputVal.length >= 2) return;
  const listEl = document.getElementById('destSuggestions');
  const recents = getRecentDests();
  if (recents.length === 0) { listEl.style.display = 'none'; return; }

  listEl.innerHTML = '<div style="padding: 6px 12px; font-size: 11px; color: #2563eb; font-weight: bold; background: #eff6ff; border-bottom: 1px solid #e2e8f0;">🕒 ĐIỂM ĐẾN GẦN ĐÂY</div>';
  recents.forEach(item => {
    const div = document.createElement('div');
    div.className = 'suggestion-item';
    div.innerHTML = `🕒 <b>${item.label}</b>`;
    div.onclick = () => {
      if (document.activeElement) document.activeElement.blur();
      document.getElementById('destInput').value = item.label;
      toggleClearButton('dest');
      listEl.style.display = 'none';
      setDestLocation(L.latLng(item.lat, item.lng));
      saveRecentDest(item.label, item.lat, item.lng);
      exitFocusInputMode('dest');
      exitSelectionMode();
    };
    listEl.appendChild(div);
  });
  listEl.style.display = 'block';
}

function updateGuide() {}

// CÁC SỰ KIỆN CLICK OUTSIDE MENU
document.addEventListener('click', (e) => {
  if (!e.target.closest('#vehicleFloatBtn') && !e.target.closest('#vehicleMenu')) {
    const menu = document.getElementById('vehicleMenu');
    if (menu) menu.style.display = 'none';
  }
  if (!e.target.closest('#topMenuBtn') && !e.target.closest('#topMenuPopover')) {
    const topMenu = document.getElementById('topMenuPopover');
    if (topMenu) topMenu.style.display = 'none';
  }
  if (!e.target.closest('.route-card')) {
    document.getElementById('pickupSuggestions').style.display = 'none';
    document.getElementById('destSuggestions').style.display = 'none';
  }
});

// CHẾ ĐỘ DARK MODE
window.toggleDarkMode = function() {
  const body = document.body;
  const themeToggleText = document.getElementById('themeToggleText');
  const isDark = body.classList.toggle('dark-mode');
  
  localStorage.setItem('avyo_theme', isDark ? 'dark' : 'light');
  if (themeToggleText) themeToggleText.innerText = isDark ? '☀️ Chế độ sáng' : '🌙 Chế độ tối';
};

(function initTheme() {
  if (localStorage.getItem('avyo_theme') === 'dark') document.body.classList.add('dark-mode');
})();

// GHI ĐÈ HỘP THOẠI ALERT MẶC ĐỊNH BẰNG GIAO DIỆN CUSTOM
window.alert = function(message) {
  return new Promise((resolve) => {
    let overlay = document.getElementById('customAlertOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'customAlertOverlay';
      overlay.className = 'custom-alert-overlay';
      overlay.innerHTML = `
        <div class="custom-alert-box">
          <div id="customAlertIcon" class="custom-alert-icon">💡</div>
          <div id="customAlertTitle" class="custom-alert-title">Thông báo</div>
          <div id="customAlertMsg" class="custom-alert-msg"></div>
          <button id="customAlertBtn" class="custom-alert-btn">ĐÃ HIỂU</button>
        </div>
      `;
      document.body.appendChild(overlay);
    }
    const iconEl = overlay.querySelector('#customAlertIcon');
    const titleEl = overlay.querySelector('#customAlertTitle');
    const msgEl = overlay.querySelector('#customAlertMsg');
    const btnEl = overlay.querySelector('#customAlertBtn');

    let displayIcon = "💡", displayTitle = "Thông báo", displayMsg = String(message || '');
    const emojiMatch = displayMsg.match(/^([\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|⚡|💡|⚠️|✅|⭐|🌟|📍|🎉|❌|⏳)\s*/u);
    if (emojiMatch) {
      displayIcon = emojiMatch[1];
      displayMsg = displayMsg.replace(emojiMatch[0], '');
      if (displayIcon === '⚠️') displayTitle = 'Lưu ý';
      else if (displayIcon === '✅' || displayIcon === '🎉') displayTitle = 'Thành công';
      else if (displayIcon === '❌') displayTitle = 'Lỗi';
      else if (displayIcon === '⏳') displayTitle = 'Đang xử lý';
      else if (displayIcon === '⭐' || displayIcon === '🌟') displayTitle = 'Đánh giá';
    }
    iconEl.innerText = displayIcon;
    titleEl.innerText = displayTitle;
    msgEl.innerText = displayMsg;
    overlay.classList.add('active');

    const closeAlert = () => {
      overlay.classList.remove('active');
      btnEl.removeEventListener('click', closeAlert);
      resolve();
    };
    btnEl.onclick = closeAlert;
  });
};

// ==========================================
// HÀM MỞ ZALO THÔNG MINH (CHỐNG BỊ ZALO BẮT CAPTCHA/BẢO MẬT)
// ==========================================
window.openZaloApp = function(phoneNumber) {
  if (!phoneNumber) return;
  const cleanPhone = phoneNumber.toString().replace(/\D/g, '');
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  if (isMobile) {
    window.location.href = `zalo://chat?phone=${cleanPhone}`;
    let hasBlurred = false;
    const blurHandler = () => { hasBlurred = true; };
    window.addEventListener('blur', blurHandler, { once: true });

    setTimeout(() => {
      window.removeEventListener('blur', blurHandler);
      if (!hasBlurred) {
        window.open(`https://zalo.me/${cleanPhone}`, '_blank', 'noopener,noreferrer');
      }
    }, 1500);
  } else {
    window.open(`https://zalo.me/${cleanPhone}`, '_blank', 'noopener,noreferrer');
  }
};