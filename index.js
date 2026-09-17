// CHẶN PHÓNG TO THU NHỎ GIAO DIỆN KHI DÙNG GESTURE TRÊN ĐIỆN THOẠI
document.addEventListener('gesturestart', function (e) {
  e.preventDefault();
});
document.addEventListener('gesturechange', function (e) {
  e.preventDefault();
});
document.addEventListener('gestureend', function (e) {
  e.preventDefault();
});

// MAPBOX ACCESS TOKEN CỦA BẠN
const MAPBOX_TOKEN = 'pk.eyJ1IjoidHVhbmFuaDM0MTYyMyIsImEiOiJjbXUycmMxa2UwMjd4MnlxeWZ2ZDV5NGF5In0.o10B_hdnfqOIn1jNfbpY2w';

// 1. LẤY VỊ TRÍ GẦN NHẤT TỪ LOCALSTORAGE ĐỂ MỞ BẢN ĐỒ TẠI ĐÓ NGAY LẬP TỨC
const savedLat = localStorage.getItem('avyo_last_lat');
const savedLng = localStorage.getItem('avyo_last_lng');
const initialCenter = (savedLat && savedLng) 
  ? [parseFloat(savedLat), parseFloat(savedLng)] 
  : [18.7034, 105.6832];

// Khởi tạo bản đồ Leaflet - Tối ưu Zoom mượt mà nguyên bản
const map = L.map('map', { 
  preferCanvas: true,
  attributionControl: false,
  zoomControl: false,
  touchZoom: true,
  dragging: true,
  fadeAnimation: true,
  zoomAnimation: true,
  zoomSnap: 1,             
  zoomDelta: 1,
  wheelDebounceTime: 40,     
  wheelPxPerZoomLevel: 120,
  bounceAtZoomLimits: false,
  inertia: true,
  inertiaDeceleration: 3000
}).setView(initialCenter, 15);

let swapDegree = 0;
let activeSuggestionIndex = -1;
let mapMoveDebounceTimer = null;
let isFirstLocationLoad = true;
let ggmapInputTimer = null;

/* HÀM HỖ TRỢ SAO CHÉP CHUẨN TƯƠNG THÍCH HOÀN HẢO CẢ TRÊN ĐIỆN THOẠI LẪN PC */
function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => {
      fallbackCopyTextToClipboard(text);
    });
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
  try {
    document.execCommand('copy');
  } catch (err) {
    console.warn('Lỗi sao chép thủ công:', err);
  }
  document.body.removeChild(textArea);
}

/* HÀM CHUYỂN TAB ĐÁY MAXIM STYLE */
function switchTab(tabName, event) {
  if (event) event.preventDefault();
  document.querySelectorAll('.app-bottom-nav .nav-item').forEach(btn => btn.classList.remove('active'));
  
  if (event && event.currentTarget) {
    event.currentTarget.classList.add('active');
  }

  if (tabName === 'trips') {
    alert('🚗 Tính năng Các cuốc xe đang được phát triển!');
  } else if (tabName === 'favorites') {
    alert('⭐ Tính năng Địa chỉ Yêu thích đang được phát triển!');
  } else if (tabName === 'menu') {
    toggleTopMenu();
  }
}

/* HÀM CẬP NHẬT ẨN/HIỆN NÚT ĐỔI CHIỀU CHỈ KHI ĐÃ CHỌN ĐỦ 2 ĐIỂM */
function updateSwapButtonVisibility() {
  const swapBtn = document.querySelector('.btn-swap-route');
  if (!swapBtn) return;
  if (markerStart && markerEnd) {
    swapBtn.style.display = 'flex';
  } else {
    swapBtn.style.display = 'none';
  }
}

/* HÀM KIỂM TRA VÀ CẬP NHẬT TRẠNG THÁI MẠNG OFFLINE/ONLINE THỜI GIAN THỰC */
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
      setTimeout(() => {
        bar.classList.remove('show', 'online-back');
      }, 2500);
    }
  }
}

window.addEventListener('offline', updateNetworkStatus);
window.addEventListener('online', updateNetworkStatus);
document.addEventListener('DOMContentLoaded', updateNetworkStatus);

/* HÀM HOÁN ĐỔI ĐIỂM ĐÓN VÀ ĐIỂM ĐẾN (CÓ HIỆU ỨNG XOAY 180°) */
function swapRoute() {
  const swapBtn = document.querySelector('.btn-swap-route');
  if (swapBtn) {
    swapDegree += 180;
    swapBtn.style.transform = `rotate(${swapDegree}deg)`;
  }

  const pickupInput = document.getElementById('pickupInput');
  const destInput = document.getElementById('destInput');

  const tempVal = pickupInput.value;
  pickupInput.value = destInput.value;
  destInput.value = tempVal;

  toggleClearButton('pickup');
  toggleClearButton('dest');

  if (markerStart || markerEnd) {
    const tempMarker = markerStart;
    markerStart = markerEnd;
    markerEnd = tempMarker;

    if (markerStart) {
      markerStart.setIcon(pickupIcon);
      markerStart.off('click');
      markerStart.on('click', () => triggerPinSelection('pickup'));
    }
    if (markerEnd) {
      markerEnd.setIcon(destinationIcon);
      markerEnd.off('click');
      markerEnd.on('click', () => triggerPinSelection('dest'));
    }

    if (markerStart && markerEnd) {
      calculateMapboxRoute();
    } else {
      if (routeLine) {
        map.removeLayer(routeLine);
        routeLine = null;
      }
      currentDistance = 0;
      updatePrice();
      if (markerStart) {
        setTimeout(() => centerMapOnPin(markerStart.getLatLng()), 150);
      }
    }
    loadDrivers();
  }
  updateSwapButtonVisibility();
}

/* HÀM ĐIỀU HƯỚNG BÀN PHÍM (MŨI TÊN TĂNG/GIẢM VÀ ENTER/ESC) */
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

/* HÀM MỞ CHẾ ĐỘ FOCUS ĐẨY NGUYÊN DÒNG NHẬP LÊN ĐẦU MÀN HÌNH */
function enterFocusInputMode(type) {
  document.body.classList.remove('focus-pickup', 'focus-dest');
  if (type === 'pickup') {
    document.body.classList.add('focus-pickup');
  } else if (type === 'dest') {
    document.body.classList.add('focus-dest');
  }

  window.scrollTo(0, 0);
  setTimeout(() => window.scrollTo(0, 0), 50);
  setTimeout(() => window.scrollTo(0, 0), 200);
}

/* HÀM THOÁT CHẾ ĐỘ FOCUS QUAY VỀ GIAO DIỆN BAN ĐẦU */
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
}

window.addEventListener('scroll', () => {
  if (document.body.classList.contains('focus-pickup') || document.body.classList.contains('focus-dest')) {
    window.scrollTo(0, 0);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    exitFocusInputMode();
  }
});

map.on('click', () => {
  exitFocusInputMode();
});

function toggleClearButton(type) {
  const inputEl = document.getElementById(type + 'Input');
  const clearBtn = document.getElementById(type === 'pickup' ? 'clearPickupBtn' : 'clearDestBtn');
  if (inputEl && clearBtn) {
    clearBtn.style.display = inputEl.value.trim().length > 0 ? 'flex' : 'none';
  }
}

function clearInput(type) {
  enterFocusInputMode(type);
  const inputEl = document.getElementById(type + 'Input');
  if (inputEl) {
    inputEl.value = '';
    inputEl.focus();
  }
  toggleClearButton(type);
  if (type === 'pickup') {
    showRecentPickups();
  } else {
    showRecentDests();
  }
}

function getPinCenterLatLng() {
  if (!map) return L.latLng(18.7034, 105.6832);
  try {
    const size = map.getSize();
    if (!size || !size.x || !size.y) return L.latLng(18.7034, 105.6832);
    const pt = map.containerPointToLatLng([size.x / 2, size.y * 0.3333]);
    if (pt && Number.isFinite(pt.lat) && Number.isFinite(pt.lng)) {
      return pt;
    }
  } catch (e) {
    console.warn("Lỗi tính tọa độ ghim:", e);
  }
  return L.latLng(18.7034, 105.6832);
}

let isFittingBounds = false;
let activeZoomPinLatLng = null;
let routeAnimationTimer = null;

map.on('zoomstart', () => {
  if (!isFittingBounds) {
    const pin = getPinCenterLatLng();
    if (pin && Number.isFinite(pin.lat) && Number.isFinite(pin.lng)) {
      activeZoomPinLatLng = pin;
    }
  }
});

map.on('zoomend', () => {
  if (activeZoomPinLatLng && !isFittingBounds && Number.isFinite(activeZoomPinLatLng.lat) && Number.isFinite(activeZoomPinLatLng.lng)) {
    try {
      const size = map.getSize();
      if (size && size.x && size.y) {
        const pinPoint = L.point(size.x / 2, size.y * 0.3333);
        const currentPoint = map.latLngToContainerPoint(activeZoomPinLatLng);
        if (!currentPoint || !Number.isFinite(currentPoint.x) || !Number.isFinite(currentPoint.y)) return;
        const delta = currentPoint.subtract(pinPoint);
        if (Math.abs(delta.x) > 10 || Math.abs(delta.y) > 10) {
          map.panBy(delta, { animate: false });
        }
      }
    } catch (err) {
      console.warn("Lỗi căn chỉnh ghim khi zoomend:", err);
    }
    activeZoomPinLatLng = null;
  }
});

const googleLayer = L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
  subdomains: ['0', '1', '2', '3'],
  maxZoom: 20,
  tileSize: 256,
  zoomOffset: 0,
  keepBuffer: 12,            
  updateWhenIdle: false,     
  updateWhenZooming: true    
});

googleLayer.on('tileerror', function() {
  if (map.hasLayer(googleLayer)) {
    map.removeLayer(googleLayer);
    L.tileLayer(`https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=${MAPBOX_TOKEN}`, {
      maxZoom: 19,
      tileSize: 512,
      zoomOffset: -1,
      keepBuffer: 12,
      updateWhenIdle: false,
      updateWhenZooming: true
    }).addTo(map);
  }
});
googleLayer.addTo(map);

setTimeout(() => { if (map) map.invalidateSize(); }, 300);
window.addEventListener('resize', () => { if (map) map.invalidateSize(); });

const SUPABASE_URL = 'https://yvucyqkglbgxvozrznir.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2dWN5cWtnbGJneHZvenJ6bmlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMzA3ODAsImV4cCI6MjEwNDcwNjc4MH0.Zagl4i2LPmxW3w9ih0h4LRsrm-OOGtPcWgvEs2vHBqo';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const RECENT_PICKUPS_KEY = 'avyo_recent_pickups';
const RECENT_DESTS_KEY = 'avyo_recent_dests';
const VEHICLE_PREF_KEY = 'avyo_selected_vehicle';

let userLatLng = null;
let markerStart = null, markerEnd = null;
let routeLine = null;
let currentDistance = 0, currentPrice = 0;
let selectedDriver = null;
let ratingDriverTarget = null;
let rawDriversData = [];
let searchTimer = null;
let mapboxTimeout = null;
let pickupDetailNote = '';

let currentSelectionMode = 'pickup';
let activeFilter = localStorage.getItem(VEHICLE_PREF_KEY) || 'bike';

const typeIcons = {
  'bike': '🛵',
  'car': '🚕',
  'driver': '<svg width="20" height="20" viewBox="0 0 24 24" fill="#00b14f"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>',
  'truck': '🚚'
};

const typeNames = { 
  'bike': '🛵 Xe máy (4.500đ/km)', 
  'car': '🚕 Ô ô (9.000đ/km)', 
  'driver': '👤 Lái xe hộ (10.000đ/km)', 
  'truck': '🚚 Chở hàng (Thỏa thuận)'
};

function updateGpsButtonUI(isRouteActive) {
  const btn = document.getElementById('gpsFloatBtn');
  if (!btn) return;
  if (isRouteActive) {
    btn.title = 'Xem toàn cảnh lộ trình';
    btn.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 19L9 3"/>
        <path d="M20 19L15 3"/>
        <path d="M12 4v3"/>
        <path d="M12 11v3"/>
        <path d="M12 18v3"/>
      </svg>`;
  } else {
    btn.title = 'Vị trí hiện tại';
    btn.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
      </svg>`;
  }
}

function handleGpsOrRouteBtnClick() {
  if (routeLine && map.hasLayer(routeLine)) {
    zoomToRouteOverview();
  } else {
    useCurrentLocationAsPickup();
  }
}

function zoomToRouteOverview() {
  if (!routeLine) return;
  isFittingBounds = true;
  try {
    const bounds = routeLine.getBounds();
    if (bounds && bounds.isValid()) {
      const bottomEl = document.querySelector('.bottom-section');
      const paddingBottom = (bottomEl ? bottomEl.offsetHeight : 220) + 20;

      map.flyToBounds(bounds, {
        paddingTopLeft: [30, 60],
        paddingBottomRight: [30, paddingBottom],
        maxZoom: 16,
        duration: 1.2,
        easeLinearity: 0.25
      });
    }
  } catch (e) {
    console.warn("Lỗi flyToBounds:", e);
  }
  setTimeout(() => {
    isFittingBounds = false;
  }, 1300);
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

function safeDistance(lat1, lon1, lat2, lon2) {
  if (typeof getHaversineDistance === 'function') {
    return getHaversineDistance(lat1, lon1, lat2, lon2);
  }
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getBBox(lat, lng, radiusKm) {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos(lat * Math.PI / 180));
  return `${(lng - dLng).toFixed(4)},${(lat - dLat).toFixed(4)},${(lng + dLng).toFixed(4)},${(lat + dLat).toFixed(4)}`;
}

function updatePinColor(color) {
  const pinSvg = document.querySelector('.fixed-center-pin .pin-svg');
  if (pinSvg) pinSvg.setAttribute('fill', color);
}

function centerMapOnPin(latlng, zoom = null, offsetY = 0, animate = true) {
  if (!map || !latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) return;
  try {
    if (zoom !== null && map.getZoom() !== zoom) {
      map.setZoom(zoom, { animate: animate });
    }
    const size = map.getSize();
    if (!size || !size.x || !size.y) return;
    const pinPoint = L.point(size.x / 2, (size.y * 0.3333) + offsetY);
    const currentPoint = map.latLngToContainerPoint(latlng);
    if (!currentPoint || !Number.isFinite(currentPoint.x) || !Number.isFinite(currentPoint.y)) return;
    const delta = currentPoint.subtract(pinPoint);
    map.panBy(delta, { animate: animate, duration: animate ? 0.6 : 0, easeLinearity: 0.25 });
  } catch (e) {
    console.warn("Lỗi centerMapOnPin:", e);
  }
}

function triggerPinSelection(type) {
  exitFocusInputMode(type);
  let targetLatLng = null;

  if (type === 'pickup') {
    if (markerStart) targetLatLng = markerStart.getLatLng();
    else if (userLatLng) targetLatLng = userLatLng;
    else targetLatLng = map.getCenter();
  } else if (type === 'dest') {
    if (markerEnd) targetLatLng = markerEnd.getLatLng();
    else if (markerStart) targetLatLng = markerStart.getLatLng();
    else if (userLatLng) targetLatLng = userLatLng;
    else targetLatLng = map.getCenter();
  }

  if (routeLine) {
    routeLine.setStyle({
      color: '#475569',
      weight: 5,
      dashArray: '8, 8',
      opacity: 0.85
    });
  }

  enterSelectionMode(type);

  if (targetLatLng) {
    centerMapOnPin(targetLatLng, map.getZoom());
  }
}

function enterSelectionMode(mode) {
  currentSelectionMode = mode;
  document.body.classList.remove('selecting-pickup', 'selecting-dest');
  
  const confirmBtn = document.getElementById('confirmSelectBtn');

  if (mode === 'pickup') {
    document.body.classList.add('selecting-pickup');
    updatePinColor('#dc2626');
    if (confirmBtn) confirmBtn.innerText = "📍 CHỌN ĐIỂM ĐÓN NÀY";
    if (markerStart) {
      map.removeLayer(markerStart);
      markerStart = null;
    }
  } else if (mode === 'dest') {
    document.body.classList.add('selecting-dest');
    updatePinColor('#2563eb');
    if (confirmBtn) confirmBtn.innerText = "📍 CHỌN ĐIỂM ĐẾN NÀY";
    if (markerEnd) {
      map.removeLayer(markerEnd);
      markerEnd = null;
    }
  }

  updateGpsButtonUI(false);
  updateSwapButtonVisibility();
}

async function fetchAddressForInput(type, latlng) {
  if (!MAPBOX_TOKEN || !latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) return;
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${latlng.lng},${latlng.lat}.json?access_token=${MAPBOX_TOKEN}&country=vn&language=vi&limit=1`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.features && data.features.length > 0) {
        const placeName = cleanAddressText(data.features[0].text || data.features[0].place_name);
        const inputEl = document.getElementById(type + 'Input');
        if (inputEl) {
          inputEl.value = placeName;
          toggleClearButton(type);
        }
        if (type === 'pickup') saveRecentPickup(placeName, latlng.lat, latlng.lng);
        if (type === 'dest') saveRecentDest(placeName, latlng.lat, latlng.lng);
      }
    }
  } catch (e) {
    console.warn("Lỗi lấy địa chỉ ngược", e);
  }
}

function confirmAndExitSelection() {
  const pinLatLng = getPinCenterLatLng();

  if (currentSelectionMode === 'pickup') {
    setPickupLocation(pinLatLng);
    fetchAddressForInput('pickup', pinLatLng);
    
    if (!markerEnd) {
      enterSelectionMode('dest');
    } else {
      exitSelectionMode();
    }
  } else if (currentSelectionMode === 'dest') {
    setDestLocation(pinLatLng);
    fetchAddressForInput('dest', pinLatLng);
    exitSelectionMode();
  }
}

function exitSelectionMode() {
  currentSelectionMode = null;
  document.body.classList.remove('selecting-pickup', 'selecting-dest');
  updatePinColor('#00b14f');
  
  if (markerStart && markerEnd) {
    calculateMapboxRoute();
  }
  updateSwapButtonVisibility();
}

map.on('movestart', () => {
  document.body.classList.add('map-moving');
  clearTimeout(mapMoveDebounceTimer);
});

map.on('moveend', () => {
  document.body.classList.remove('map-moving');
  clearTimeout(mapMoveDebounceTimer);

  if (currentSelectionMode) {
    mapMoveDebounceTimer = setTimeout(() => {
      fetchAddressForInput(currentSelectionMode, getPinCenterLatLng());
    }, 300);
  }
});

function getRecentPickups() {
  try {
    const data = localStorage.getItem(RECENT_PICKUPS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) { return []; }
}

function saveRecentPickup(label, lat, lng) {
  if (!label || !lat || !lng || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
  let list = getRecentPickups();
  list = list.filter(item => item.label !== label && !(Math.abs(item.lat - lat) < 0.0001 && Math.abs(item.lng - lng) < 0.0001));
  list.unshift({ label, lat, lng });
  list = list.slice(0, 5);
  localStorage.setItem(RECENT_PICKUPS_KEY, JSON.stringify(list));
}

function showRecentPickups() {
  const inputVal = document.getElementById('pickupInput').value.trim();
  if (inputVal.length >= 2) return;

  const listEl = document.getElementById('pickupSuggestions');
  const recents = getRecentPickups();

  if (!recents || recents.length === 0) {
    listEl.style.display = 'none';
    return;
  }

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
      const latlng = L.latLng(item.lat, item.lng);
      setPickupLocation(latlng);
      saveRecentPickup(item.label, item.lat, item.lng);
      exitFocusInputMode('pickup');
      if (!markerEnd) {
        enterSelectionMode('dest');
      } else {
        exitSelectionMode();
      }
    };
    listEl.appendChild(div);
  });
  listEl.style.display = 'block';
}

function getRecentDests() {
  try {
    const data = localStorage.getItem(RECENT_DESTS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) { return []; }
}

function saveRecentDest(label, lat, lng) {
  if (!label || !lat || !lng || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
  let list = getRecentDests();
  list = list.filter(item => item.label !== label && !(Math.abs(item.lat - lat) < 0.0001 && Math.abs(item.lng - lng) < 0.0001));
  list.unshift({ label, lat, lng });
  list = list.slice(0, 5);
  localStorage.setItem(RECENT_DESTS_KEY, JSON.stringify(list));
}

function showRecentDests() {
  const inputVal = document.getElementById('destInput').value.trim();
  if (inputVal.length >= 2) return;

  const listEl = document.getElementById('destSuggestions');
  const recents = getRecentDests();

  if (!recents || recents.length === 0) {
    listEl.style.display = 'none';
    return;
  }

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
      const latlng = L.latLng(item.lat, item.lng);
      setDestLocation(latlng);
      saveRecentDest(item.label, item.lat, item.lng);
      exitFocusInputMode('dest');
      exitSelectionMode();
    };
    listEl.appendChild(div);
  });
  listEl.style.display = 'block';
}

function updateGuide() {}

const pickupIcon = L.divIcon({
  html: `<svg width="34" height="34" viewBox="0 0 24 24" fill="#dc2626" stroke="#ffffff" stroke-width="1.5" style="filter: drop-shadow(0 3px 6px rgba(0,0,0,0.4));">
           <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
         </svg>`,
  className: 'custom-pin-icon',
  iconSize: [34, 34],
  iconAnchor: [17, 34]
});

const destinationIcon = L.divIcon({
  html: `<svg width="34" height="34" viewBox="0 0 24 24" fill="#2563eb" stroke="#ffffff" stroke-width="1.5" style="filter: drop-shadow(0 3px 6px rgba(0,0,0,0.4));">
           <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
         </svg>`,
  className: 'custom-pin-icon',
  iconSize: [34, 34],
  iconAnchor: [17, 34]
});

function toggleVehicleMenu() {
  const menu = document.getElementById('vehicleMenu');
  if (menu) {
    const isVisible = menu.style.display === 'flex' || menu.style.display === 'block';
    menu.style.display = isVisible ? 'none' : 'flex';
  }
}

function selectFilter(type, element) {
  const menu = document.getElementById('vehicleMenu');
  if (menu) menu.style.display = 'none';

  if (activeFilter === type) return;
  
  activeFilter = type;
  localStorage.setItem(VEHICLE_PREF_KEY, type);

  document.querySelectorAll('.vehicle-option').forEach(opt => opt.classList.remove('active'));
  if (element) element.classList.add('active');

  const activeLabel = document.getElementById('activeVehicleLabel');
  if (activeLabel && typeIcons[type]) {
    activeLabel.innerHTML = typeIcons[type];
  }

  if (selectedDriver && selectedDriver.vehicle_type !== activeFilter) {
    deselectDriver();
  }

  loadDrivers();
  updatePrice();
}

map.locate({ setView: false, maxZoom: 15, enableHighAccuracy: true });

map.on('locationfound', (e) => {
  userLatLng = e.latlng;
  
  localStorage.setItem('avyo_last_lat', e.latlng.lat);
  localStorage.setItem('avyo_last_lng', e.latlng.lng);

  if (isFirstLocationLoad) {
    centerMapOnPin(e.latlng, 15, 0, false);
    
    if (!markerStart) {
      setPickupLocation(e.latlng, true);
    }
    fetchAddressForInput('pickup', e.latlng);
    isFirstLocationLoad = false;
  } else {
    if (currentSelectionMode) {
      centerMapOnPin(e.latlng, 15);
    }
  }
  loadDrivers();
});

map.on('locationerror', (e) => {
  console.warn("Không thể lấy vị trí GPS hiện tại:", e.message);
});

function setPickupLocation(latlng, isAuto = false) {
  if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) return;
  if (markerStart) map.removeLayer(markerStart);
 
  markerStart = L.marker(latlng, { icon: pickupIcon, draggable: false }).addTo(map);
    
  markerStart.on('click', () => {
    triggerPinSelection('pickup');
  });
    
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) resetBtn.style.display = 'inline-flex';
  
  if (markerEnd) {
    calculateMapboxRoute();
  } else if (!isAuto) {
    setTimeout(() => {
      centerMapOnPin(latlng);
    }, 150);
  }

  updateSwapButtonVisibility();
  loadDrivers();
  updateGuide();
}

function setDestLocation(latlng) {
  if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) return;
  if (markerEnd) map.removeLayer(markerEnd);

  markerEnd = L.marker(latlng, { icon: destinationIcon, draggable: false }).addTo(map);
    
  markerEnd.on('click', () => {
    triggerPinSelection('dest');
  });
    
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) resetBtn.style.display = 'inline-flex';
  
  if (markerStart && markerEnd) {
    calculateMapboxRoute();
  } else {
    setTimeout(() => {
      centerMapOnPin(latlng);
    }, 150);
  }

  updateSwapButtonVisibility();
  loadDrivers();
  updateGuide();
}

function useCurrentLocationAsPickup() {
  if (userLatLng && Number.isFinite(userLatLng.lat) && Number.isFinite(userLatLng.lng)) {
    if (currentSelectionMode) {
      centerMapOnPin(userLatLng, map.getZoom());
      fetchAddressForInput(currentSelectionMode, userLatLng);
    } else {
      map.setView(userLatLng, 15, { animate: true });
      setPickupLocation(userLatLng, true);
      const labelText = "Vị trí hiện tại của bạn";
      document.getElementById('pickupInput').value = labelText;
      toggleClearButton('pickup');
      saveRecentPickup(labelText, userLatLng.lat, userLatLng.lng);
    }
  } else {
    map.locate({ setView: true, maxZoom: 15, enableHighAccuracy: true });
  }
}

function cleanAddressText(text) {
  if (!text) return '';
  return text
    .replace(/\b\d{5,6}\b,?\s*/g, '')
    .replace(/,?\s*(Việt Nam|Vietnam)$/gi, '')
    .replace(/\s*,\s*,/g, ', ')
    .replace(/^,\s*/, '')
    .trim();
}

function onSearchInput(type, isDirectCall = false) {
  clearTimeout(searchTimer);
  activeSuggestionIndex = -1;
  const query = document.getElementById(type + 'Input').value.trim().substring(0, 200);
  const listEl = document.getElementById(type + 'Suggestions');
 
  if (query.length < 2) {
    if (type === 'pickup') showRecentPickups();
    else if (type === 'dest') showRecentDests();
    else listEl.style.display = 'none';
    return;
  }

  listEl.innerHTML = '<div class="suggestion-loading">⏳ Đang tìm địa chỉ...</div>';
  listEl.style.display = 'block';

  const executeSearch = async () => {
    let rawCenter = markerStart ? markerStart.getLatLng() : (userLatLng || getPinCenterLatLng());
    
    if (rawCenter && typeof rawCenter.wrap === 'function') {
      rawCenter = rawCenter.wrap();
    }

    const lat = Number(rawCenter ? rawCenter.lat : 18.7034);
    const lng = Number(rawCenter ? rawCenter.lng : 105.6832);

    const fetchGeocoding = async (bboxStr) => {
      let url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&country=vn&language=vi&limit=8`;
      if (rawCenter && Number.isFinite(lat) && Number.isFinite(lng)) {
        url += `&proximity=${lng.toFixed(4)},${lat.toFixed(4)}`;
      }
      if (bboxStr) {
        url += `&bbox=${bboxStr}`;
      }
      try {
        const res = await fetch(url);
        if (!res.ok) return [];
        const data = await res.json();
        return data.features || [];
      } catch (e) {
        return [];
      }
    };

    let features = [];

    if (rawCenter && Number.isFinite(lat) && Number.isFinite(lng)) {
      const bbox15 = getBBox(lat, lng, 15);
      features = await fetchGeocoding(bbox15);

      if (features.length === 0) {
        const bbox50 = getBBox(lat, lng, 50);
        features = await fetchGeocoding(bbox50);
      }

      if (features.length === 0) {
        features = await fetchGeocoding(null);
      }
    } else {
      features = await fetchGeocoding(null);
    }

    if (features.length === 0) {
      listEl.innerHTML = '<div class="suggestion-loading">❌ Không tìm thấy địa chỉ phù hợp</div>';
      listEl.style.display = 'block';
      return;
    }

    if (rawCenter && Number.isFinite(lat) && Number.isFinite(lng)) {
      features.sort((a, b) => {
        if (!a.geometry || !b.geometry) return 0;
        const distA = safeDistance(lat, lng, a.geometry.coordinates[1], a.geometry.coordinates[0]);
        const distB = safeDistance(lat, lng, b.geometry.coordinates[1], b.geometry.coordinates[0]);
        return distA - distB;
      });
    }

    if (isDirectCall && features.length > 0) {
      const topResult = features[0];
      const placeName = cleanAddressText(topResult.text || topResult.place_name);
      const [resLng, resLat] = topResult.geometry.coordinates;
      
      if (document.activeElement) document.activeElement.blur();
      document.getElementById(type + 'Input').value = placeName;
      toggleClearButton(type);
      listEl.style.display = 'none';
      const latlng = L.latLng(resLat, resLng);

      if (type === 'pickup') {
        setPickupLocation(latlng);
        saveRecentPickup(placeName, resLat, resLng);
        exitFocusInputMode('pickup');
        if (!markerEnd) {
          enterSelectionMode('dest');
        } else {
          exitSelectionMode();
        }
      } else {
        setDestLocation(latlng);
        saveRecentDest(placeName, resLat, resLng);
        exitFocusInputMode('dest');
        exitSelectionMode();
      }
      return;
    }

    listEl.innerHTML = '';
    features.forEach(f => {
      if (!f.geometry || !f.geometry.coordinates) return;
      const mainTitle = cleanAddressText(f.text || f.place_name);
      const addressSub = cleanAddressText(f.place_name || '');
      const [fLng, fLat] = f.geometry.coordinates;

      let distTag = '';
      if (rawCenter && Number.isFinite(lat) && Number.isFinite(lng)) {
        const d = safeDistance(lat, lng, fLat, fLng);
        distTag = ` • Cách ${d < 1 ? Math.round(d * 1000) + 'm' : d.toFixed(1) + 'km'}`;
      }

      const div = document.createElement('div');
      div.className = 'suggestion-item';
      div.innerHTML = `📍 <b>${mainTitle}</b> <small style="color:#64748b; font-size:11px;">(${addressSub}<b style="color:#00b14f;">${distTag}</b>)</small>`;
      
      div.onclick = () => {
        if (document.activeElement) document.activeElement.blur();
        document.getElementById(type + 'Input').value = mainTitle;
        toggleClearButton(type);
        listEl.style.display = 'none';
        
        const latlng = L.latLng(fLat, fLng);

        if (type === 'pickup') {
          setPickupLocation(latlng);
          saveRecentPickup(mainTitle, fLat, fLng);
          exitFocusInputMode('pickup');
          if (!markerEnd) {
            enterSelectionMode('dest');
          } else {
            exitSelectionMode();
          }
        } else {
          setDestLocation(latlng);
          saveRecentDest(mainTitle, fLat, fLng);
          exitFocusInputMode('dest');
          exitSelectionMode();
        }
      };
      listEl.appendChild(div);
    });
    listEl.style.display = 'block';
  };

  if (isDirectCall) executeSearch();
  else searchTimer = setTimeout(executeSearch, 300);
}

function toggleTopMenu() {
  const menu = document.getElementById('topMenuPopover');
  if (menu) {
    const isVisible = menu.style.display === 'flex' || menu.style.display === 'block';
    menu.style.display = isVisible ? 'none' : 'flex';
  }
}

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

async function calculateMapboxRoute() {
  if (!markerStart || !markerEnd) return;

  const start = markerStart.getLatLng();
  const end = markerEnd.getLatLng();

  if (!start || !end || !Number.isFinite(start.lat) || !Number.isFinite(start.lng) || !Number.isFinite(end.lat) || !Number.isFinite(end.lng)) return;

  const directDistKm = safeDistance(start.lat, start.lng, end.lat, end.lng);
  if (directDistKm < 0.05) {
    alert("⚠️ Điểm đón và điểm đến đang ở quá gần nhau (dưới 50m). Vui lòng kiểm tra lại lộ trình!");
  }

  let routePoints = null;

  if (MAPBOX_TOKEN) {
    try {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&access_token=${MAPBOX_TOKEN}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.routes && data.routes.length > 0) {
          routePoints = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
          currentDistance = (data.routes[0].distance / 1000).toFixed(1);
        }
      }
    } catch (e) {
      console.warn("Mapbox bận, vẽ đường thẳng dự phòng...");
    }
  }

  if (routeLine) map.removeLayer(routeLine);
  if (routeAnimationTimer) cancelAnimationFrame(routeAnimationTimer);

  const targetPoints = (routePoints && routePoints.length > 0) 
    ? routePoints 
    : [[start.lat, start.lng], [end.lat, end.lng]];

  routeLine = L.polyline([], { 
    color: '#00b14f', 
    weight: 6, 
    opacity: 0.9,
    lineCap: 'round',    
    lineJoin: 'round',   
    smoothFactor: 1 
  }).addTo(map);

  updateGpsButtonUI(true);

  const drawDuration = 1000;
  const startTime = performance.now();

  function animateDrawRoute(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / drawDuration, 1);
    
    const easeProgress = progress < 0.5 
      ? 2 * progress * progress 
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;

    const count = Math.max(1, Math.floor(easeProgress * targetPoints.length));
    const currentPoints = targetPoints.slice(0, count);
    if (currentPoints.length > 0) {
      routeLine.setLatLngs(currentPoints);
    }

    if (progress < 1) {
      routeAnimationTimer = requestAnimationFrame(animateDrawRoute);
    } else {
      zoomToRouteOverview();
    }
  }

  routeAnimationTimer = requestAnimationFrame(animateDrawRoute);

  updatePrice();
  updateGuide();
}

function updatePrice() {
  const priceEl = document.getElementById('price');
  const rateLabelEl = document.getElementById('rate-label');

  if (!priceEl || !rateLabelEl) return;

  if (!markerStart || !markerEnd || currentDistance == 0) {
    priceEl.innerText = '0đ';
    rateLabelEl.innerText = '';
    return;
  }

  const type = activeFilter;
  const distVal = parseFloat(currentDistance);

  if (type === 'truck' || distVal > 100) {
    priceEl.innerText = 'Thỏa thuận';
    rateLabelEl.innerText = `(${currentDistance} km)`;
    return;
  }

  let rateVal = 4500;
  let minFare = 12000;

  if (type === 'car') {
    rateVal = 9000;
    minFare = 24000;
  } else if (type === 'driver') {
    rateVal = 10000;
    minFare = 50000;
  } else if (type === 'bike') {
    rateVal = 4500;
    minFare = 12000;
  }

  currentPrice = Math.max(minFare, Math.round(distVal * rateVal));
  priceEl.innerText = currentPrice.toLocaleString('vi-VN') + 'đ';
  rateLabelEl.innerText = `(${currentDistance} km)`;
}

function resetRoute() {
  if (routeAnimationTimer) cancelAnimationFrame(routeAnimationTimer);
  clearTimeout(mapboxTimeout);
  if (markerStart) map.removeLayer(markerStart);
  if (markerEnd) map.removeLayer(markerEnd);
  if (routeLine) map.removeLayer(routeLine);
  markerStart = null;
  markerEnd = null;
  routeLine = null;
  currentDistance = 0;
  currentPrice = 0;
  pickupDetailNote = '';
  
  const detailBtn = document.getElementById('btnPickupDetail');
  if (detailBtn) {
    detailBtn.classList.remove('has-note');
    detailBtn.innerText = '📝 Chi tiết';
  }

  const card = document.getElementById('top3Card');
  const toggleBtn = document.getElementById('btnToggleDrivers');
  const toggleArrow = document.getElementById('toggleArrow');
  if (card) card.classList.remove('show');
  if (toggleBtn) toggleBtn.classList.remove('active');
  if (toggleArrow) toggleArrow.innerText = '▾';

  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) resetBtn.style.display = 'none';
  
  document.getElementById('pickupInput').value = '';
  document.getElementById('destInput').value = '';
  
  toggleClearButton('pickup');
  toggleClearButton('dest');

  updateGpsButtonUI(false);
  updatePrice();
  loadDrivers();
  enterSelectionMode('pickup');
  updateSwapButtonVisibility();
}

function deselectDriver() {
  selectedDriver = null;
  updatePrice();
  updateGuide();
}

let driverMarkers = {};

const icons = {
  'bike': L.divIcon({ html: '<div class="vehicle-icon">🛵</div>', className: 'custom-icon', iconSize: [30, 30], iconAnchor: [15, 15] }),
  'car': L.divIcon({ html: '<div class="vehicle-icon">🚕</div>', className: 'custom-icon', iconSize: [30, 30], iconAnchor: [15, 15] }),
  'driver': L.divIcon({ html: '<div class="vehicle-icon"><svg viewBox="0 0 24 24" fill="#00b14f" width="30px" height="30px"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg></div>', className: 'custom-icon', iconSize: [30, 30], iconAnchor: [15, 15] }),
  'truck': L.divIcon({ html: '<div class="vehicle-icon">🚚</div>', className: 'custom-icon', iconSize: [30, 30], iconAnchor: [15, 15] })
};

async function trackCallById(event, driverId) {
  if (event) event.preventDefault();
  const driver = rawDriversData.find(d => d.id === driverId) || selectedDriver;
  if (!driver) return;

  if (!selectedDriver || selectedDriver.id !== driver.id) {
    await selectDriver(driver);
  }

  const centerPoint = markerStart ? markerStart.getLatLng() : userLatLng;
  if (centerPoint) {
    const distKm = safeDistance(centerPoint.lat, centerPoint.lng, driver.lat, driver.lng);
    if (distKm > 15) {
      return alert(`⚠️ Tài xế đang ở cách bạn ${distKm.toFixed(1)}km (ngoài bán kính 15km). Hãy chọn tài xế ở gần hơn!`);
    }
  }

  localStorage.setItem(`avyo_unlocked_rating_${driver.id}`, 'true');
  await supabaseClient.rpc('increment_driver_call', { target_id: driver.id });

  window.location.href = `tel:${driver.phone}`;
}

async function openZaloById(driverId) {
  const driver = rawDriversData.find(d => d.id === driverId) || selectedDriver;
  if (!driver) return;

  const typeName = typeNames[driver.vehicle_type] || 'Tài xế';
  const distVal = parseFloat(currentDistance);
  let msg = `Chào ${typeName}, tôi muốn sử dụng dịch vụ Avyo:\n`;

  if (markerStart && markerEnd) {
    const sLat = markerStart.getLatLng().lat.toFixed(5);
    const sLng = markerStart.getLatLng().lng.toFixed(5);
    const eLat = markerEnd.getLatLng().lat.toFixed(5);
    const eLng = markerEnd.getLatLng().lng.toFixed(5);

    const mapRouteUrl = `https://www.google.com/maps/dir/?api=1&origin=${sLat},${sLng}&destination=${eLat},${eLng}&travelmode=driving`;

    msg += `\n🗺️ Lộ trình Google Maps: ${mapRouteUrl}`;
    if (pickupDetailNote) {
      msg += `\n📝 Chi tiết điểm đón: ${pickupDetailNote}`;
    }
    msg += `\n📏 Quãng đường: ${currentDistance} km`;
    msg += `\n💰 Cước phí: ${(driver.vehicle_type === 'truck' || distVal > 100) ? 'Thỏa thuận' : currentPrice.toLocaleString('vi-VN') + 'đ'}`;
  } else if (markerStart) {
    const sLat = markerStart.getLatLng().lat.toFixed(5);
    const sLng = markerStart.getLatLng().lng.toFixed(5);
    msg += `\n📍 Điểm đi: https://maps.google.com/?q=${sLat},${sLng}`;
    if (pickupDetailNote) {
      msg += `\n📝 Chi tiết điểm đón: ${pickupDetailNote}`;
    }
  }

  copyToClipboard(msg);

  if (!selectedDriver || selectedDriver.id !== driver.id) {
    await selectDriver(driver);
  }

  const centerPoint = markerStart ? markerStart.getLatLng() : userLatLng;
  if (centerPoint) {
    const distKm = safeDistance(centerPoint.lat, centerPoint.lng, driver.lat, driver.lng);
    if (distKm > 15) {
      return alert(`⚠️ Tài xế đang ở cách bạn ${distKm.toFixed(1)}km (ngoài bán kính 15km). Hãy chọn tài xế ở gần hơn!`);
    }
  }

  localStorage.setItem(`avyo_unlocked_rating_${driver.id}`, 'true');
  await supabaseClient.rpc('increment_driver_zalo', { target_id: driver.id });

  await alert("✅ ĐÃ COPY LỘ TRÌNH!\n\nHệ thống mở Zalo ngay bây giờ. Bạn hãy dán (Paste) nội dung tin nhắn gửi cho tài xế nhé!");

  window.open(`https://zalo.me/${driver.phone}`, '_blank');
}

async function loadDrivers() {
  const centerPoint = markerStart ? markerStart.getLatLng() : (userLatLng || map.getCenter());

  if (centerPoint) {
    let { data: nearbyData } = await supabaseClient.rpc('get_nearby_drivers', {
      user_lat: centerPoint.lat,
      user_lng: centerPoint.lng,
      radius_km: 5.0,
      v_type: activeFilter
    });

    if (!nearbyData || nearbyData.length === 0) {
      let { data: fallbackData } = await supabaseClient.rpc('get_nearby_drivers', {
        user_lat: centerPoint.lat,
        user_lng: centerPoint.lng,
        radius_km: 15.0,
        v_type: activeFilter
      });
      rawDriversData = fallbackData || [];
    } else {
      rawDriversData = nearbyData;
    }
  } else {
    const { data } = await supabaseClient
      .from('public_drivers')
      .select('*')
      .eq('is_online', true)
      .neq('is_active', false)
      .eq('vehicle_type', activeFilter)
      .limit(15);
    
    rawDriversData = data || [];
  }

  if (selectedDriver) {
    const freshDriverData = rawDriversData.find(d => d.id === selectedDriver.id);
    if (freshDriverData) {
      selectedDriver = freshDriverData;
    } else {
      deselectDriver();
    }
  }

  renderDriverMarkers();
}

function calcRating(driver) {
  const sum = driver.rating_sum || 25;
  const count = driver.rating_count || 5;
  return { score: (sum / count).toFixed(1), count: count };
}

async function selectDriver(driver) {
  if (selectedDriver && selectedDriver.id === driver.id) {
    deselectDriver();
    renderDriverMarkers();
    return;
  }

  selectedDriver = driver;
  updateGuide();

  const centerPoint = markerStart ? markerStart.getLatLng() : userLatLng;
  if (centerPoint) {
    const distKm = safeDistance(centerPoint.lat, centerPoint.lng, driver.lat, driver.lng);
    if (distKm <= 0.1) {
      localStorage.setItem(`avyo_unlocked_rating_${driver.id}`, 'true');
    }
  }

  const VIEW_COOLDOWN = 5 * 60 * 1000;
  const lastViewKey = `avyo_last_view_${driver.id}`;
  const lastViewTime = localStorage.getItem(lastViewKey);
  const now = Date.now();

  if (!lastViewTime || (now - parseInt(lastViewTime)) > VIEW_COOLDOWN) {
    localStorage.setItem(lastViewKey, now.toString());
    const { error } = await supabaseClient.rpc('increment_driver_click', { target_id: driver.id });
    if (!error) driver.click_count = (driver.click_count || 0) + 1;
  }

  updatePrice();
  renderDriverMarkers();

  if (driver && driver.lat && driver.lng) {
    centerMapOnPin(L.latLng(driver.lat, driver.lng), null, 0);
  }

  if (driverMarkers[driver.id]) {
    driverMarkers[driver.id].openPopup();
  }
}

function renderDriverMarkers() {
  const hasPickup = !!markerStart;
  const centerPoint = hasPickup ? markerStart.getLatLng() : (userLatLng || map.getCenter());

  let baseFiltered = rawDriversData.filter(driver => {
    if (driver.vehicle_type !== activeFilter) return false;
    if (!driver.lat || !driver.lng) return false;
    if (!driver.updated_at) return false;
    
    const lastUpdateStr = (driver.updated_at.includes('Z') || driver.updated_at.includes('+'))
      ? driver.updated_at 
      : driver.updated_at.replace(' ', 'T') + 'Z';
    
    const diffSeconds = (Date.now() - new Date(lastUpdateStr).getTime()) / 1000;
    if (diffSeconds > 120) return false;

    return true;
  });

  let isFallback = false;

  if (centerPoint) {
    baseFiltered.sort((a, b) => {
      const distA = safeDistance(centerPoint.lat, centerPoint.lng, a.lat, a.lng);
      const distB = safeDistance(centerPoint.lat, centerPoint.lng, b.lat, b.lng);
      return distA - distB;
    });

    let withinRadius = baseFiltered.filter(driver => {
      return safeDistance(centerPoint.lat, centerPoint.lng, driver.lat, driver.lng) <= 5;
    });

    if (withinRadius.length === 0) {
      withinRadius = baseFiltered.filter(driver => {
        return safeDistance(centerPoint.lat, centerPoint.lng, driver.lat, driver.lng) <= 15;
      });
      if (withinRadius.length > 0) isFallback = true;
    }

    if (withinRadius.length > 0) {
      baseFiltered = withinRadius;
    }
  }

  const maxDisplayCount = hasPickup ? 3 : 15;
  const filteredDrivers = baseFiltered.slice(0, maxDisplayCount);

  const top3List = document.getElementById('top3List');
  const radiusBadge = document.getElementById('radiusBadge');

  if (hasPickup && filteredDrivers.length > 0) {
    if (top3List) top3List.innerHTML = '';

    if (radiusBadge) {
      if (isFallback) {
        radiusBadge.innerHTML = '<b style="color:#d97706;">Nới rộng 15km (Xung quanh ít xe)</b>';
      } else {
        radiusBadge.innerHTML = 'Bán kính 5km';
      }
    }

    filteredDrivers.forEach(driver => {
      const isSelected = selectedDriver && selectedDriver.id === driver.id;
      const distKm = safeDistance(centerPoint.lat, centerPoint.lng, driver.lat, driver.lng);
      const rating = calcRating(driver);
      const avatarUrl = getOptimizedAvatar(driver.avatar_url);
      const typeBadge = typeNames[driver.vehicle_type] || 'Tài xế';

      const div = document.createElement('div');
      div.className = `top3-item ${isSelected ? 'selected' : ''}`;

      div.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; flex: 1;" onclick="selectDriver(rawDriversData.find(d => d.id === '${driver.id}'))">
          <img src="${avatarUrl}" class="driver-avatar-img" onerror="this.src='https://cdn-icons-png.flaticon.com/512/149/149071.png'">
          <div>
            <div style="font-weight:bold; font-size:13px; color:#0f172a;">${driver.name}</div>
            <div style="font-size:11px; color:#64748b;">${typeBadge} • Cách <b>${distKm.toFixed(1)} km</b></div>
            <div style="font-size:11px; color:#eab308; font-weight:bold;">⭐ ${rating.score} (${rating.count} lượt)</div>
          </div>
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
          <button class="btn-action-zalo" onclick="event.stopPropagation(); openZaloById('${driver.id}')" title="Nhắn Zalo">💬 Zalo</button>
          <button class="btn-action-phone" onclick="event.stopPropagation(); trackCallById(event, '${driver.id}')" title="Gọi điện">📞 Gọi</button>
        </div>
      `;
      if (top3List) top3List.appendChild(div);
    });
  } else if (hasPickup && filteredDrivers.length === 0) {
    if (radiusBadge) radiusBadge.innerText = 'Bán kính 15km';
    if (top3List) {
      top3List.innerHTML = `
        <div style="font-size:12px; color:#dc2626; text-align:center; padding:10px; background:#fef2f2; border-radius:10px; border:1px solid #fca5a5;">
          📍 Chưa tìm thấy tài xế nào trong phạm vi 15km quanh đây.<br>
          <small style="color:#64748b; margin-top:2px; display:block;">Vui lòng chuyển loại xe khác hoặc đổi vị trí đón.</small>
        </div>`;
    }
  } else {
    if (top3List) top3List.innerHTML = '';
  }

  const currentValidIds = new Set();

  filteredDrivers.forEach(driver => {
    currentValidIds.add(driver.id);
    const icon = icons[driver.vehicle_type] || icons['bike'];
    const rating = calcRating(driver);
    const targetLatLng = [driver.lat, driver.lng];

    const popupHtml = `
      <div style="text-align:center; padding:2px; min-width:130px;">
        <b style="font-size:13px;" class="driver-popup-name">${driver.name}</b><br>
        <span style="color:#eab308; font-weight:bold; font-size:12px;">⭐ ${rating.score} / 5.0</span>
        <small style="color:#64748b; font-size:11px;">(${rating.count} lượt)</small>
        <div style="display:flex; gap:6px; justify-content:center; margin-top:8px;">
          <button class="btn-action-zalo" onclick="event.stopPropagation(); openZaloById('${driver.id}')" style="padding:5px 8px; font-size:11px;">💬 Zalo</button>
          <button class="btn-action-phone" onclick="event.stopPropagation(); trackCallById(event, '${driver.id}')" style="padding:5px 8px; font-size:11px;">📞 Gọi</button>
        </div>
      </div>
    `;

    if (driverMarkers[driver.id]) {
      const existingMarker = driverMarkers[driver.id];
      const currPos = existingMarker.getLatLng();

      if (Math.abs(currPos.lat - driver.lat) > 0.00001 || Math.abs(currPos.lng - driver.lng) > 0.00001) {
        existingMarker.moveTo(targetLatLng, 2500);
      }

      existingMarker.setIcon(icon);
      existingMarker.setPopupContent(popupHtml);
    } else {
      const marker = L.Marker.movingMarker([targetLatLng, targetLatLng], [1000], { icon: icon }).addTo(map);
      marker.bindPopup(popupHtml);
     
      marker.on('click', () => {
        selectDriver(driver);
      });
      driverMarkers[driver.id] = marker;
    }
  });

  Object.keys(driverMarkers).forEach(id => {
    if (!currentValidIds.has(id)) {
      map.removeLayer(driverMarkers[id]);
      delete driverMarkers[id];
    }
  });
}

enterSelectionMode('pickup');
loadDrivers();
updateGuide();

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
});

setInterval(() => {
  if (typeof loadDrivers === 'function') {
    loadDrivers();
  }
}, 12000);

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

window.toggleDarkMode = function() {
  const body = document.body;
  const themeToggleText = document.getElementById('themeToggleText');
  const isDark = body.classList.toggle('dark-mode');
  
  localStorage.setItem('avyo_theme', isDark ? 'dark' : 'light');
  if (themeToggleText) {
    themeToggleText.innerText = isDark ? '☀️ Chế độ sáng' : '🌙 Chế độ tối';
  }
};

(function initTheme() {
  const savedTheme = localStorage.getItem('avyo_theme');
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-mode');
  }
})();

document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('avyo_theme');
  const themeToggleText = document.getElementById('themeToggleText');
  if (savedTheme === 'dark' && themeToggleText) {
    themeToggleText.innerText = '☀️ Chế độ sáng';
  }
});

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

    let displayIcon = "💡";
    let displayTitle = "Thông báo";
    let displayMsg = String(message || '');

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

/* --- XỬ LÝ BÓC TÁCH LINK GOOGLE MAPS ĐẦY ĐỦ VÀ RÚT GỌN --- */

window.openGoogleMapsToCopy = function() {
  window.open('https://www.google.com/maps/dir/', '_blank');
};

window.handleGgmapLinkInput = function() {
  clearTimeout(ggmapInputTimer);

  const inputEl = document.getElementById('ggmapLinkInput');
  const clearBtn = document.getElementById('clearGgmapBtn');
  const rawUrl = inputEl ? inputEl.value.trim() : '';

  if (clearBtn) {
    clearBtn.style.display = rawUrl.length > 0 ? 'flex' : 'none';
  }

  if (!rawUrl) return;

  // Tránh bắn thông báo liên tục nếu người dùng gõ tay dở dang
  if (!rawUrl.includes('google.com') && !rawUrl.includes('goo.gl')) {
    if (rawUrl.startsWith('http') || rawUrl.length > 25) {
      alert("⚠️ Link dán vào không thuộc định dạng Google Maps!");
    }
    return;
  }

  ggmapInputTimer = setTimeout(async () => {
    alert("⏳ Đang giải mã và lấy vị trí từ Google Maps...");

    let targetUrl = rawUrl;
    let fullHtmlContent = "";

    // 1. Giải mã link rút gọn (maps.app.goo.gl) qua danh sách Proxy dự phòng
    if (rawUrl.includes('maps.app.goo.gl') || rawUrl.includes('goo.gl')) {
      const proxyList = [
        async (u) => {
          const res = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`);
          if (!res.ok) throw new Error("Proxy CodeTabs bận");
          const text = await res.text();
          return { url: u, content: text };
        },
        async (u) => {
          const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(u)}`);
          if (!res.ok) throw new Error("Proxy AllOrigins bận");
          const data = await res.json();
          return { url: data.status?.url || u, content: data.contents || "" };
        },
        async (u) => {
          const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(u)}`);
          if (!res.ok) throw new Error("Proxy CORSProxy bận");
          const text = await res.text();
          return { url: res.url || u, content: text };
        }
      ];

      let success = false;
      for (const fetchProxy of proxyList) {
        try {
          const result = await fetchProxy(rawUrl);
          targetUrl = result.url;
          fullHtmlContent = result.content;
          if (fullHtmlContent || targetUrl !== rawUrl) {
            success = true;
            break;
          }
        } catch (err) {
          console.warn("Thử proxy tiếp theo do lỗi:", err);
        }
      }

      if (!success) {
        alert("❌ Dịch vụ giải mã link đang bận. Vui lòng thử lại sau giây lát!");
        return;
      }
    }

    const parseText = targetUrl + " " + fullHtmlContent;

    let pickupLat = null, pickupLng = null;
    let destLat = null, destLng = null;
    let pickupName = "", destName = "";

    // 2. Tách tên địa danh trực tiếp từ cấu trúc URL (/dir/Tên_Đón/Tên_Đến/)
    const textMatch = targetUrl.match(/\/dir\/([^\/@]+)\/([^\/@]+)\//);
    if (textMatch) {
      try {
        pickupName = cleanAddressText(decodeURIComponent(textMatch[1].replace(/\+/g, ' ')));
        destName = cleanAddressText(decodeURIComponent(textMatch[2].replace(/\+/g, ' ')));
      } catch (e) {
        console.warn("Lỗi đọc tên địa danh:", e);
      }
    }

    // 3. Trích xuất Tọa độ
    // MẪU A: Đọc từ cụm data=!2m2!1d[LNG]!2d[LAT] (Chuẩn Google Maps đầy đủ)
    const dataMatches = [...parseText.matchAll(/!2m2!1d(-?\d+\.\d+)!2d(-?\d+\.\d+)/g)];
    if (dataMatches.length >= 2) {
      pickupLng = parseFloat(dataMatches[0][1]);
      pickupLat = parseFloat(dataMatches[0][2]);

      destLng = parseFloat(dataMatches[1][1]);
      destLat = parseFloat(dataMatches[1][2]);
    }

    // MẪU B: Đọc từ dạng /dir/Lat1,Lng1/Lat2,Lng2
    if (!pickupLat || !destLat) {
      const dirCoordMatch = parseText.match(/\/dir\/(-?\d+\.\d+),\s*(-?\d+\.\d+)\/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
      if (dirCoordMatch) {
        pickupLat = parseFloat(dirCoordMatch[1]);
        pickupLng = parseFloat(dirCoordMatch[2]);
        destLat = parseFloat(dirCoordMatch[3]);
        destLng = parseFloat(dirCoordMatch[4]);
      }
    }

    // MẪU C: Đọc từ dạng origin=...&destination=...
    if (!pickupLat || !destLat) {
      const queryMatch = parseText.match(/(?:origin|saddr)=(-?\d+\.\d+),\s*(-?\d+\.\d+).*(?:destination|daddr)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
      if (queryMatch) {
        pickupLat = parseFloat(queryMatch[1]);
        pickupLng = parseFloat(queryMatch[2]);
        destLat = parseFloat(queryMatch[3]);
        destLng = parseFloat(queryMatch[4]);
      }
    }

    // 4. Thiết lập vị trí và vẽ lộ trình
    if (pickupLat && pickupLng && destLat && destLng) {
      const pickupLatLng = L.latLng(pickupLat, pickupLng);
      const destLatLng = L.latLng(destLat, destLng);

      exitSelectionMode();

      // Thiết lập Điểm Đón
      setPickupLocation(pickupLatLng);
      if (pickupName) {
        const pInput = document.getElementById('pickupInput');
        if (pInput) pInput.value = pickupName;
        toggleClearButton('pickup');
        saveRecentPickup(pickupName, pickupLat, pickupLng);
      } else {
        fetchAddressForInput('pickup', pickupLatLng);
      }

      // Thiết lập Điểm Đến
      setDestLocation(destLatLng);
      if (destName) {
        const dInput = document.getElementById('destInput');
        if (dInput) dInput.value = destName;
        toggleClearButton('dest');
        saveRecentDest(destName, destLat, destLng);
      } else {
        fetchAddressForInput('dest', destLatLng);
      }

      // Vẽ tuyến đường
      calculateMapboxRoute();

      // THÔNG BÁO THÀNH CÔNG
      alert("✅ ĐÃ TRÍCH XUẤT THÀNH CÔNG LỘ TRÌNH!\n\nVị trí điểm đi, điểm đến và tuyến đường đã được thiết lập trên bản đồ.");
    } else {
      alert("❌ Không tìm thấy tọa độ lộ trình trong liên kết này. Vui lòng đảm bảo bạn dán đúng link chỉ đường của Google Maps!");
    }
  }, 400);
};

window.clearGgmapInput = function() {
  const inputEl = document.getElementById('ggmapLinkInput');
  const clearBtn = document.getElementById('clearGgmapBtn');
  
  if (inputEl) {
    inputEl.value = '';
    inputEl.focus();
  }
  if (clearBtn) {
    clearBtn.style.display = 'none';
  }
};