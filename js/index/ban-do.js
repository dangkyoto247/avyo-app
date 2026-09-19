// ============================================================================
// BỘ NHỚ ĐỆM (CACHE) TIẾT KIỆM TỐI ĐA LƯỢT GỌI GOONG MAPS API
// ============================================================================
const goongCache = {
  autocomplete: new Map(),
  detail: new Map(),
  geocode: new Map()
};

// Khôi phục Tỉnh/Thành phố & Tọa độ cache ngay khi mở ứng dụng
let userProvince = localStorage.getItem('avyo_last_province') || "";
let userCity = localStorage.getItem('avyo_last_city') || "";

if (typeof savedLat !== 'undefined' && typeof savedLng !== 'undefined' && savedLat && savedLng) {
  userLatLng = L.latLng(parseFloat(savedLat), parseFloat(savedLng));
}

// Biến quản lý trạng thái gõ Telex trên iOS & Hủy Request cũ
let searchAbortController = null;
let isComposing = false;

// Lắng nghe trạng thái gõ bàn phím Telex trên iPhone
document.addEventListener('DOMContentLoaded', () => {
  ['pickupInput', 'destInput'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('compositionstart', () => { isComposing = true; });
      el.addEventListener('compositionend', () => {
        isComposing = false;
        const type = id === 'pickupInput' ? 'pickup' : 'dest';
        onSearchInput(type);
      });
    }
  });
});

// KHỞI TẠO BẢN ĐỒ LEAFLET CHÍNH
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

// LỚP BẢN ĐỒ NỀN TỪ GOOGLE MAPS HOẶC MAPBOX
const googleLayer = L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
  subdomains: ['0', '1', '2', '3'], maxZoom: 20, tileSize: 256, zoomOffset: 0, keepBuffer: 12, updateWhenIdle: false, updateWhenZooming: true    
});

googleLayer.on('tileerror', function() {
  if (map.hasLayer(googleLayer)) {
    map.removeLayer(googleLayer);
    L.tileLayer(`https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=${MAPBOX_TOKEN}`, {
      maxZoom: 19, tileSize: 512, zoomOffset: -1, keepBuffer: 12, updateWhenIdle: false, updateWhenZooming: true
    }).addTo(map);
  }
});
googleLayer.addTo(map);

setTimeout(() => { if (map) map.invalidateSize(); }, 300);
window.addEventListener('resize', () => { if (map) map.invalidateSize(); });

// ICON CHO GHIM ĐÓN VÀ ĐẾN
const pickupIcon = L.divIcon({
  html: `<svg width="34" height="34" viewBox="0 0 24 24" fill="#dc2626" stroke="#ffffff" stroke-width="1.5" style="filter: drop-shadow(0 3px 6px rgba(0,0,0,0.4));"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`,
  className: 'custom-pin-icon', iconSize: [34, 34], iconAnchor: [17, 34]
});

const destinationIcon = L.divIcon({
  html: `<svg width="34" height="34" viewBox="0 0 24 24" fill="#2563eb" stroke="#ffffff" stroke-width="1.5" style="filter: drop-shadow(0 3px 6px rgba(0,0,0,0.4));"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`,
  className: 'custom-pin-icon', iconSize: [34, 34], iconAnchor: [17, 34]
});

// CÁC HÀM XỬ LÝ GHIM CHÍNH GIỮA (CENTER PIN)
function getPinCenterLatLng() {
  if (!map) return userLatLng || L.latLng(18.7034, 105.6832);
  try {
    const size = map.getSize();
    if (!size || !size.x || !size.y) return userLatLng || L.latLng(18.7034, 105.6832);
    const pt = map.containerPointToLatLng([size.x / 2, size.y * 0.3333]);
    if (pt && Number.isFinite(pt.lat) && Number.isFinite(pt.lng)) return pt;
  } catch (e) {}
  return userLatLng || L.latLng(18.7034, 105.6832);
}

map.on('zoomstart', () => {
  if (!isFittingBounds) {
    const pin = getPinCenterLatLng();
    if (pin && Number.isFinite(pin.lat) && Number.isFinite(pin.lng)) activeZoomPinLatLng = pin;
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
        if (Math.abs(delta.x) > 10 || Math.abs(delta.y) > 10) map.panBy(delta, { animate: false });
      }
    } catch (err) {}
    activeZoomPinLatLng = null;
  }
});

map.on('movestart', () => { document.body.classList.add('map-moving'); clearTimeout(mapMoveDebounceTimer); });

// ĐÃ SỬA: Khi dừng kéo bản đồ, CHỈ tắt hiệu ứng di chuyển, KHÔNG gọi API Geocode ngầm!
map.on('moveend', () => {
  document.body.classList.remove('map-moving');
  clearTimeout(mapMoveDebounceTimer);
});

map.on('click', () => { exitFocusInputMode(); });

function updatePinColor(color) {
  const pinSvg = document.querySelector('.fixed-center-pin .pin-svg');
  if (pinSvg) pinSvg.setAttribute('fill', color);
}

function centerMapOnPin(latlng, zoom = null, offsetY = 0, animate = true) {
  if (!map || !latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) return;
  try {
    if (zoom !== null && map.getZoom() !== zoom) map.setZoom(zoom, { animate: animate });
    const size = map.getSize();
    if (!size || !size.x || !size.y) return;
    const pinPoint = L.point(size.x / 2, (size.y * 0.3333) + offsetY);
    const currentPoint = map.latLngToContainerPoint(latlng);
    if (!currentPoint || !Number.isFinite(currentPoint.x) || !Number.isFinite(currentPoint.y)) return;
    const delta = currentPoint.subtract(pinPoint);
    map.panBy(delta, { animate: animate, duration: animate ? 0.6 : 0, easeLinearity: 0.25 });
  } catch (e) {}
}

// XỬ LÝ GPS VÀ TÌM ĐƯỜNG MAPBOX
function safeDistance(lat1, lon1, lat2, lon2) {
  if (typeof getHaversineDistance === 'function') return getHaversineDistance(lat1, lon1, lat2, lon2);
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getBBox(lat, lng, radiusKm) {
  const dLat = radiusKm / 111, dLng = radiusKm / (111 * Math.cos(lat * Math.PI / 180));
  return `${(lng - dLng).toFixed(4)},${(lat - dLat).toFixed(4)},${(lng + dLng).toFixed(4)},${(lat + dLat).toFixed(4)}`;
}

function updateGpsButtonUI(isRouteActive) {
  const btn = document.getElementById('gpsFloatBtn');
  if (!btn) return;
  if (isRouteActive) {
    btn.title = 'Xem toàn cảnh lộ trình';
    btn.innerHTML = `<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19L9 3"/><path d="M20 19L15 3"/><path d="M12 4v3"/><path d="M12 11v3"/><path d="M12 18v3"/></svg>`;
  } else {
    btn.title = 'Vị trí hiện tại';
    btn.innerHTML = `<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>`;
  }
}

function handleGpsOrRouteBtnClick() {
  if (routeLine && map.hasLayer(routeLine)) zoomToRouteOverview();
  else useCurrentLocationAsPickup();
}

function zoomToRouteOverview() {
  if (!routeLine) return;
  isFittingBounds = true;
  try {
    const bounds = routeLine.getBounds();
    if (bounds && bounds.isValid()) {
      const bottomEl = document.querySelector('.bottom-section');
      const paddingBottom = (bottomEl ? bottomEl.offsetHeight : 220) + 20;
      map.flyToBounds(bounds, { paddingTopLeft: [30, 60], paddingBottomRight: [30, paddingBottom], maxZoom: 16, duration: 1.2, easeLinearity: 0.25 });
    }
  } catch (e) {}
  setTimeout(() => { isFittingBounds = false; }, 1300);
}

async function calculateMapboxRoute() {
  if (!markerStart || !markerEnd) return;
  const start = markerStart.getLatLng();
  const end = markerEnd.getLatLng();
  if (!start || !end || !Number.isFinite(start.lat) || !Number.isFinite(start.lng) || !Number.isFinite(end.lat) || !Number.isFinite(end.lng)) return;

  const directDistKm = safeDistance(start.lat, start.lng, end.lat, end.lng);
  if (directDistKm < 0.05) alert("⚠️ Điểm đón và điểm đến đang ở quá gần nhau (dưới 50m). Vui lòng kiểm tra lại lộ trình!");

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
    } catch (e) { console.warn("Mapbox bận, vẽ đường thẳng dự phòng..."); }
  }

  if (routeLine) map.removeLayer(routeLine);
  if (routeAnimationTimer) cancelAnimationFrame(routeAnimationTimer);

  const targetPoints = (routePoints && routePoints.length > 0) ? routePoints : [[start.lat, start.lng], [end.lat, end.lng]];
  routeLine = L.polyline([], { color: '#00b14f', weight: 6, opacity: 0.9, lineCap: 'round', lineJoin: 'round', smoothFactor: 1 }).addTo(map);
  updateGpsButtonUI(true);

  const drawDuration = 1000;
  const startTime = performance.now();
  function animateDrawRoute(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / drawDuration, 1);
    const easeProgress = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    const count = Math.max(1, Math.floor(easeProgress * targetPoints.length));
    const currentPoints = targetPoints.slice(0, count);
    if (currentPoints.length > 0) routeLine.setLatLngs(currentPoints);
    if (progress < 1) routeAnimationTimer = requestAnimationFrame(animateDrawRoute);
    else zoomToRouteOverview();
  }
  routeAnimationTimer = requestAnimationFrame(animateDrawRoute);

  updatePrice();
  updateGuide();
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

  if (routeLine) routeLine.setStyle({ color: '#475569', weight: 5, dashArray: '8, 8', opacity: 0.85 });
  enterSelectionMode(type);
  if (targetLatLng) centerMapOnPin(targetLatLng, map.getZoom());
}

function enterSelectionMode(mode) {
  currentSelectionMode = mode;
  document.body.classList.remove('selecting-pickup', 'selecting-dest');
  const confirmBtn = document.getElementById('confirmSelectBtn');

  if (mode === 'pickup') {
    document.body.classList.add('selecting-pickup');
    updatePinColor('#dc2626');
    if (confirmBtn) confirmBtn.innerText = "CHỌN ĐIỂM ĐÓN NÀY";
    if (markerStart) { map.removeLayer(markerStart); markerStart = null; }
  } else if (mode === 'dest') {
    document.body.classList.add('selecting-dest');
    updatePinColor('#2563eb');
    if (confirmBtn) confirmBtn.innerText = "CHỌN ĐIỂM ĐẾN NÀY";
    if (markerEnd) { map.removeLayer(markerEnd); markerEnd = null; }
  }

  updateGpsButtonUI(false);
  updateSwapButtonVisibility();
}

// ĐÃ SỬA: Chỉ khi người dùng bấm nút "XÁC NHẬN CHỌN VỊ TRÍ", ứng dụng mới gọi API Geocode 1 lần duy nhất!
async function confirmAndExitSelection() {
  const pinLatLng = getPinCenterLatLng();
  if (currentSelectionMode === 'pickup') {
    setPickupLocation(pinLatLng);
    const pickupInput = document.getElementById('pickupInput');
    if (pickupInput) pickupInput.value = "⏳ Đang lấy địa chỉ...";
    await fetchAddressForInput('pickup', pinLatLng);
    if (!markerEnd) enterSelectionMode('dest'); else exitSelectionMode();
  } else if (currentSelectionMode === 'dest') {
    setDestLocation(pinLatLng);
    const destInput = document.getElementById('destInput');
    if (destInput) destInput.value = "⏳ Đang lấy địa chỉ...";
    await fetchAddressForInput('dest', pinLatLng);
    exitSelectionMode();
  }
}

function exitSelectionMode() {
  currentSelectionMode = null;
  document.body.classList.remove('selecting-pickup', 'selecting-dest');
  updatePinColor('#00b14f');
  if (markerStart && markerEnd) calculateMapboxRoute();
  updateSwapButtonVisibility();
}

async function fetchAddressForInput(type, latlng) {
  if (!GOONG_API_KEY || !latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) return;
  
  const cacheKey = `${latlng.lat.toFixed(4)},${latlng.lng.toFixed(4)}`;
  if (goongCache.geocode.has(cacheKey)) {
    const cachedAddress = goongCache.geocode.get(cacheKey);
    const inputEl = document.getElementById(type + 'Input');
    if (inputEl) { inputEl.value = cachedAddress; toggleClearButton(type); }
    if (type === 'pickup') saveRecentPickup(cachedAddress, latlng.lat, latlng.lng);
    if (type === 'dest') saveRecentDest(cachedAddress, latlng.lat, latlng.lng);
    return;
  }

  try {
    const url = `https://rsapi.goong.io/Geocode?latlng=${latlng.lat},${latlng.lng}&api_key=${GOONG_API_KEY}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const fullAddr = data.results[0].formatted_address || data.results[0].name || "";
        const placeName = cleanAddressText(fullAddr);
        goongCache.geocode.set(cacheKey, placeName);

        const cleanFull = cleanAddressText(fullAddr);
        const parts = cleanFull.split(',').map(p => p.trim().toLowerCase()).filter(p => p.length > 0);
        
        if (parts.length >= 1) {
          userProvince = parts[parts.length - 1];
          localStorage.setItem('avyo_last_province', userProvince);
        }
        if (parts.length >= 2) {
          userCity = parts[parts.length - 2].replace(/thành phố|thị xã|huyện/gi, '').trim();
          localStorage.setItem('avyo_last_city', userCity);
        }

        const inputEl = document.getElementById(type + 'Input');
        if (inputEl) { inputEl.value = placeName; toggleClearButton(type); }
        if (type === 'pickup') saveRecentPickup(placeName, latlng.lat, latlng.lng);
        if (type === 'dest') saveRecentDest(placeName, latlng.lat, latlng.lng);
      }
    }
  } catch (e) {
    console.warn("Lỗi giải mã tọa độ:", e);
  }
}

function setPickupLocation(latlng, isAuto = false) {
  if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) return;
  if (markerStart) map.removeLayer(markerStart);
  markerStart = L.marker(latlng, { icon: pickupIcon, draggable: false }).addTo(map);
  markerStart.on('click', () => { triggerPinSelection('pickup'); });
    
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) resetBtn.style.display = 'inline-flex';
  
  if (markerEnd) calculateMapboxRoute();
  else if (!isAuto) setTimeout(() => { centerMapOnPin(latlng); }, 150);

  updateSwapButtonVisibility();
  loadDrivers();
  updateGuide();
}

function setDestLocation(latlng) {
  if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) return;
  if (markerEnd) map.removeLayer(markerEnd);
  markerEnd = L.marker(latlng, { icon: destinationIcon, draggable: false }).addTo(map);
  markerEnd.on('click', () => { triggerPinSelection('dest'); });
    
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) resetBtn.style.display = 'inline-flex';
  
  if (markerStart && markerEnd) calculateMapboxRoute();
  else setTimeout(() => { centerMapOnPin(latlng); }, 150);

  updateSwapButtonVisibility();
  loadDrivers();
  updateGuide();
}

function resetRoute() {
  if (routeAnimationTimer) cancelAnimationFrame(routeAnimationTimer);
  clearTimeout(mapboxTimeout);
  if (markerStart) map.removeLayer(markerStart);
  if (markerEnd) map.removeLayer(markerEnd);
  if (routeLine) map.removeLayer(routeLine);
  markerStart = null; markerEnd = null; routeLine = null;
  currentDistance = 0; currentPrice = 0; pickupDetailNote = '';
  
  const detailBtn = document.getElementById('btnPickupDetail');
  if (detailBtn) { detailBtn.classList.remove('has-note'); detailBtn.innerText = '📝 Chi tiết'; }
  const card = document.getElementById('top3Card'), toggleBtn = document.getElementById('btnToggleDrivers'), toggleArrow = document.getElementById('toggleArrow');
  if (card) card.classList.remove('show');
  if (toggleBtn) toggleBtn.classList.remove('active');
  if (toggleArrow) toggleArrow.innerText = '▾';
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) resetBtn.style.display = 'none';
  
  document.getElementById('pickupInput').value = '';
  document.getElementById('destInput').value = '';
  toggleClearButton('pickup'); toggleClearButton('dest');

  updateGpsButtonUI(false);
  updatePrice();
  loadDrivers();
  enterSelectionMode('pickup');
  updateSwapButtonVisibility();
}

function swapRoute() {
  const swapBtn = document.querySelector('.btn-swap-route');
  if (swapBtn) { swapDegree += 180; swapBtn.style.transform = `rotate(${swapDegree}deg)`; }

  const pickupInput = document.getElementById('pickupInput'), destInput = document.getElementById('destInput');
  const tempVal = pickupInput.value; pickupInput.value = destInput.value; destInput.value = tempVal;
  toggleClearButton('pickup'); toggleClearButton('dest');

  if (markerStart || markerEnd) {
    const tempMarker = markerStart; markerStart = markerEnd; markerEnd = tempMarker;
    if (markerStart) { markerStart.setIcon(pickupIcon); markerStart.off('click'); markerStart.on('click', () => triggerPinSelection('pickup')); }
    if (markerEnd) { markerEnd.setIcon(destinationIcon); markerEnd.off('click'); markerEnd.on('click', () => triggerPinSelection('dest')); }
    if (markerStart && markerEnd) calculateMapboxRoute();
    else {
      if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
      currentDistance = 0; updatePrice();
      if (markerStart) setTimeout(() => centerMapOnPin(markerStart.getLatLng()), 150);
    }
    loadDrivers();
  }
  updateSwapButtonVisibility();
}

// BẮT GPS HIỆN TẠI VÀ CHUẨN HÓA VĂN BẢN TÌM KIẾM
map.locate({ setView: false, maxZoom: 15, enableHighAccuracy: true });

map.on('locationfound', (e) => {
  userLatLng = e.latlng;
  localStorage.setItem('avyo_last_lat', e.latlng.lat);
  localStorage.setItem('avyo_last_lng', e.latlng.lng);
  
  if (isFirstLocationLoad) {
    // 1. Căn giữa bản đồ vào vị trí GPS
    centerMapOnPin(e.latlng, 15, 0, false);
    
    // 2. Chốt luôn vị trí này làm Điểm Đón (Pickup)
    setPickupLocation(e.latlng, true);
    
    // 3. Hiển thị chữ tạm thời vào ô input trong lúc chờ API load tên đường
    const pickupInput = document.getElementById('pickupInput');
    if (pickupInput) {
      pickupInput.value = "📍 Vị trí hiện tại của bạn";
      if (typeof toggleClearButton === 'function') toggleClearButton('pickup');
    }
    
    // Gọi API ngầm để dịch tọa độ thành tên đường thật
    fetchAddressForInput('pickup', e.latlng);
    
    // 4. Chuyển Ứng dụng sang trạng thái "Sẵn sàng chọn Điểm Đến" (Màu xanh dương)
    if (typeof enterSelectionMode === 'function') {
      enterSelectionMode('dest');
    }
    
    isFirstLocationLoad = false;
  } else {
    // Các lần update GPS tiếp theo (nếu đang ở chế độ chọn thì pan theo)
    if (currentSelectionMode) centerMapOnPin(e.latlng, 15);
  }
  loadDrivers();
});

map.on('locationerror', (e) => { console.warn("Không thể lấy vị trí GPS hiện tại:", e.message); });

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
  return text.replace(/\b\d{5,6}\b,?\s*/g, '').replace(/,?\s*(Việt Nam|Vietnam)$/gi, '').replace(/\s*,\s*,/g, ', ').replace(/^,\s*/, '').trim();
}

async function fetchGoongPlaceDetail(placeId, signal) {
  if (goongCache.detail.has(placeId)) {
    return goongCache.detail.get(placeId);
  }
  try {
    const detailUrl = `https://rsapi.goong.io/Place/Detail?place_id=${placeId}&api_key=${GOONG_API_KEY}`;
    const detailRes = await fetch(detailUrl, { signal });
    if (!detailRes.ok) return null;
    const detailData = await detailRes.json();
    const result = detailData.result || null;
    if (result) goongCache.detail.set(placeId, result);
    return result;
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    return null;
  }
}

// GỢI Ý ĐỊA ĐIỂM - XỬ LÝ CHUẨN TELEX IPHONE VÀ CHỐNG TRÙNG KẾT QUẢ CŨ
function onSearchInput(type, isDirectCall = false) {
  clearTimeout(searchTimer);

  // Bỏ qua nếu người dùng đang trong quá trình gõ tổ hợp dấu tiếng Việt Telex trên iPhone
  if (isComposing && !isDirectCall) return;

  const inputEl = document.getElementById(type + 'Input');
  const listEl = document.getElementById(type + 'Suggestions');
  const query = inputEl ? inputEl.value.trim() : '';

  if (query.length < 2) {
    if (type === 'pickup') showRecentPickups();
    else if (type === 'dest') showRecentDests();
    else listEl.style.display = 'none';
    return;
  }

  const isMobileApp = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const delayTime = isDirectCall ? 0 : (isMobileApp ? 400 : 250);

  searchTimer = setTimeout(async () => {
    // Hủy bỏ request tìm kiếm cũ trước đó nếu chưa chạy xong
    if (searchAbortController) {
      searchAbortController.abort();
    }
    searchAbortController = new AbortController();
    const signal = searchAbortController.signal;

    listEl.innerHTML = '<div class="suggestion-loading">⏳ Đang tìm địa chỉ...</div>';
    listEl.style.display = 'block';

    try {
      let url = `https://rsapi.goong.io/Place/AutoComplete?api_key=${GOONG_API_KEY}&input=${encodeURIComponent(query)}`;

      const center = markerStart ? markerStart.getLatLng() : (userLatLng || getPinCenterLatLng());
      if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) {
        url += `&location=${center.lat.toFixed(5)},${center.lng.toFixed(5)}`;
      }

      const res = await fetch(url, { signal });
      const data = await res.json();

      if (data.status === "OK" && data.predictions && data.predictions.length > 0) {
        let predictions = data.predictions;

        if (userCity || userProvince) {
          const targetCity = userCity || userProvince;
          predictions.sort((a, b) => {
            const aMatch = a.description.toLowerCase().includes(targetCity);
            const bMatch = b.description.toLowerCase().includes(targetCity);
            if (aMatch && !bMatch) return -1;
            if (!aMatch && bMatch) return 1;
            return 0;
          });
        }

        predictions = predictions.slice(0, 5);

        listEl.innerHTML = '';
        predictions.forEach(p => {
          const div = document.createElement('div');
          div.className = 'suggestion-item';
          div.innerHTML = `📍 <b>${typeof escapeHTML === 'function' ? escapeHTML(p.description) : p.description}</b>`;

          div.onclick = async () => {
            if (document.activeElement) document.activeElement.blur();
            inputEl.value = p.description;
            toggleClearButton(type);
            listEl.style.display = 'none';

            const detail = await fetchGoongPlaceDetail(p.place_id);
            if (detail && detail.geometry && detail.geometry.location) {
              const latlng = L.latLng(detail.geometry.location.lat, detail.geometry.location.lng);
              if (type === 'pickup') {
                setPickupLocation(latlng);
                saveRecentPickup(p.description, latlng.lat, latlng.lng);
                exitFocusInputMode('pickup');
                if (!markerEnd) enterSelectionMode('dest'); else exitSelectionMode();
              } else {
                setDestLocation(latlng);
                saveRecentDest(p.description, latlng.lat, latlng.lng);
                exitFocusInputMode('dest');
                exitSelectionMode();
              }
            }
          };
          listEl.appendChild(div);
        });
        listEl.style.display = 'block';
      } else {
        listEl.innerHTML = '<div class="suggestion-loading">❌ Không tìm thấy địa chỉ phù hợp</div>';
        listEl.style.display = 'block';
      }
    } catch (err) {
      if (err.name === 'AbortError') return; // Bỏ qua nếu bị hủy chủ động
      console.error('Lỗi API Goong:', err);
    }
  }, delayTime);
}