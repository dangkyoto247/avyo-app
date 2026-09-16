// MAPBOX ACCESS TOKEN CỦA BẠN
const MAPBOX_TOKEN = 'pk.eyJ1IjoidHVhbmFuaDM0MTYyMyIsImEiOiJjbXUycmMxa2UwMjd4MnlxeWZ2ZDV5NGF5In0.o10B_hdnfqOIn1jNfbpY2w';

// Khởi tạo bản đồ Leaflet
const map = L.map('map', { 
  preferCanvas: true,
  attributionControl: false,
  zoomControl: false,
  fadeAnimation: true,
  zoomSnap: 1,
  zoomDelta: 1
}).setView([18.7034, 105.6832], 13);

L.control.zoom({ position: 'topright' }).addTo(map);

/* QUẢN LÝ PHÓNG TO / THU NHỎ LUÔN LẤY ĐIỂM MỐC 1/3 PHÍA TRÊN LÀM TÂM ZUM BẤT KỂ THAO TÁC NÀO */
let zoomAnchorLatLng = null;

map.on('zoomstart', () => {
  zoomAnchorLatLng = getPinCenterLatLng();
});

map.on('zoomend', () => {
  if (zoomAnchorLatLng) {
    const size = map.getSize();
    const pinPoint = L.point(size.x / 2, size.y * 0.3333);
    const currentPoint = map.latLngToContainerPoint(zoomAnchorLatLng);
    const delta = currentPoint.subtract(pinPoint);
    map.panBy(delta, { animate: false });
    zoomAnchorLatLng = null;
  }
});

// LỚP BẢN ĐỒ CHÍNH: GOOGLE MAPS TILES
const googleLayer = L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
  subdomains: ['0', '1', '2', '3'],
  maxZoom: 20,
  tileSize: 256,
  zoomOffset: 0,
  keepBuffer: 15,
  updateWhenIdle: false,
  updateWhenZooming: true
});

googleLayer.on('tileerror', function() {
  if (map.hasLayer(googleLayer)) {
    map.removeLayer(googleLayer);
    L.tileLayer(`https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=${MAPBOX_TOKEN}`, {
      maxZoom: 19,
      tileSize: 512,
      zoomOffset: -1
    }).addTo(map);
  }
});
googleLayer.addTo(map);

setTimeout(() => { if (map) map.invalidateSize(); }, 300);

window.addEventListener('resize', () => { if (map) map.invalidateSize(); });
map.on('moveend resize', () => { if (map) map.invalidateSize(); });

const SUPABASE_URL = 'https://yvucyqkglbgxvozrznir.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2dWN5cWtnbGJneHZvenJ6bmlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMzA3ODAsImV4cCI6MjEwNDcwNjc4MH0.Zagl4i2LPmxW3w9ih0h4LRsrm-OOGtPcWgvEs2vHBqo';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const RECENT_PICKUPS_KEY = 'avyo_recent_pickups';
const RECENT_DESTS_KEY = 'avyo_recent_dests';

let userLatLng = null;
let markerStart = null, markerEnd = null;
let routeLine = null;
let currentDistance = 0, currentPrice = 0;
let selectedDriver = null;
let ratingDriverTarget = null;
let rawDriversData = [];
let searchTimer = null;
let mapboxTimeout = null;

let currentSelectionMode = 'pickup'; // Mặc định khi vào trang chọn điểm đón qua ghim

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

/* HÀM TÍNH TỌA ĐỘ TẠI ĐIỂM NHỌN CỦA GHIM (MỐC 1/3 PHÍA TRÊN MÀN HÌNH) */
function getPinCenterLatLng() {
  if (!map) return L.latLng(18.7034, 105.6832);
  const size = map.getSize();
  const pinX = size.x / 2;
  const pinY = size.y * 0.3333; // Mốc 1/3 phía trên chiều cao bản đồ
  return map.containerPointToLatLng([pinX, pinY]);
}

/* HÀM CẬP NHẬT MÀU MẮT GHIM LINH HOẠT THEO TRẠNG THÁI THAO TÁC */
function updatePinColor(color) {
  const pinSvg = document.querySelector('.fixed-center-pin .pin-svg');
  if (pinSvg) pinSvg.setAttribute('fill', color);
}

/* HÀM ĐẶT BẢN ĐỒ SAO CHO TỌA ĐỘ NẰM ĐÚNG VỊ TRÍ GHIM 1/3 */
function centerMapOnPin(latlng, zoom = null) {
  if (!map || !latlng) return;
  if (zoom !== null && map.getZoom() !== zoom) {
    map.setZoom(zoom, { animate: false });
  }
  const size = map.getSize();
  const pinPoint = L.point(size.x / 2, size.y * 0.3333);
  const currentPoint = map.latLngToContainerPoint(latlng);
  const delta = currentPoint.subtract(pinPoint);
  
  map.panBy(delta, { animate: true, duration: 0.4 });
}

/* KÍCH HOẠT CHẾ ĐỘ CHỌN GHIM PIN VÀ DỊCH CHUYỂN BẢN ĐỒ GIỮ NGUYÊN ZOOM */
function triggerPinSelection(type) {
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
    map.removeLayer(routeLine);
    routeLine = null;
  }

  enterSelectionMode(type);

  if (targetLatLng) {
    centerMapOnPin(targetLatLng, map.getZoom());
  }
}

/* QUẢN LÝ QUY TRÌNH CHỌN ĐIỂM ĐÓN / ĐẾN QUA BẢN ĐỒ CỐ ĐỊNH + THAY ĐỔI MÀU GHIM */
function enterSelectionMode(mode) {
  currentSelectionMode = mode;
  document.body.classList.remove('selecting-pickup', 'selecting-dest');
  
  const confirmBtn = document.getElementById('confirmSelectBtn');

  if (mode === 'pickup') {
    document.body.classList.add('selecting-pickup');
    updatePinColor('#dc2626'); // Đỏ cho Điểm Đón
    if (confirmBtn) confirmBtn.innerText = "📍 CHỌN ĐIỂM ĐÓN NÀY";
    if (markerStart) {
      map.removeLayer(markerStart);
      markerStart = null;
    }
  } else if (mode === 'dest') {
    document.body.classList.add('selecting-dest');
    updatePinColor('#2563eb'); // Xanh cho Điểm Đến
    if (confirmBtn) confirmBtn.innerText = "🚩 CHỌN ĐIỂM ĐẾN NÀY";
    if (markerEnd) {
      map.removeLayer(markerEnd);
      markerEnd = null;
    }
  }
}

async function fetchAddressForInput(type, latlng) {
  if (!MAPBOX_TOKEN) return;
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${latlng.lng},${latlng.lat}.json?access_token=${MAPBOX_TOKEN}&country=vn&language=vi&limit=1`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.features && data.features.length > 0) {
        const placeName = cleanAddressText(data.features[0].text || data.features[0].place_name);
        const inputEl = document.getElementById(type + 'Input');
        if (inputEl) inputEl.value = placeName;
        if (type === 'pickup') saveRecentPickup(placeName, latlng.lat, latlng.lng);
        if (type === 'dest') saveRecentDest(placeName, latlng.lat, latlng.lng);
      }
    }
  } catch (e) {
    console.warn("Lỗi lấy địa chỉ ngược", e);
  }
}

/* XÁC NHẬN CHỌN GHIM PIN: CHUYỂN SANG ĐIỂM ĐẾN NẾU CHƯA CÓ ĐIỂM ĐẾN */
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
  updatePinColor('#00b14f'); // Xanh lá Avyo khi duyệt xem bản đồ/xem đường đi
  
  if (markerStart && markerEnd) {
    calculateMapboxRoute();
  }
}

/* SỰ KIỆN DI CHUYỂN BẢN ĐỒ */
map.on('movestart', () => {
  document.body.classList.add('map-moving');
});

map.on('moveend', () => {
  document.body.classList.remove('map-moving');
  if (map) map.invalidateSize();

  if (currentSelectionMode) {
    fetchAddressForInput(currentSelectionMode, getPinCenterLatLng());
  }
});

function getRecentPickups() {
  try {
    const data = localStorage.getItem(RECENT_PICKUPS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) { return []; }
}

function saveRecentPickup(label, lat, lng) {
  if (!label || !lat || !lng) return;
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
      document.getElementById('pickupInput').value = item.label;
      listEl.style.display = 'none';
      const latlng = L.latLng(item.lat, item.lng);
      setPickupLocation(latlng);
      saveRecentPickup(item.label, item.lat, item.lng);
      exitSelectionMode();
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
  if (!label || !lat || !lng) return;
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
      document.getElementById('destInput').value = item.label;
      listEl.style.display = 'none';
      const latlng = L.latLng(item.lat, item.lng);
      setDestLocation(latlng);
      saveRecentDest(item.label, item.lat, item.lng);
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

let activeFilter = 'bike';

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
  document.querySelectorAll('.vehicle-option').forEach(opt => opt.classList.remove('active'));
  if (element) element.classList.add('active');

  const activeLabel = document.getElementById('activeVehicleLabel');
  if (activeLabel && typeNames[type]) {
    activeLabel.innerText = typeNames[type];
  }

  if (selectedDriver && selectedDriver.vehicle_type !== activeFilter) {
    deselectDriver();
  }

  loadDrivers();
  updatePrice();
}

map.locate({ setView: true, maxZoom: 15 });

map.on('locationfound', (e) => {
  userLatLng = e.latlng;
  if (currentSelectionMode) {
    centerMapOnPin(e.latlng, 15);
  } else if (!markerStart) {
    setPickupLocation(e.latlng, true);
  }
});

/* ĐẶT ĐIỂM ĐÓN CỐ ĐỊNH, CHẠM VÀO GHIM ĐỂ MỞ BẢN ĐỒ CHỈNH SỬA VỊ TRÍ */
function setPickupLocation(latlng, isAuto = false) {
  if (markerStart) map.removeLayer(markerStart);
 
  markerStart = L.marker(latlng, { icon: pickupIcon, draggable: false }).addTo(map);
    
  markerStart.on('click', () => {
    triggerPinSelection('pickup');
  });
    
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) resetBtn.style.display = 'inline-flex';
  
  if (markerEnd) calculateMapboxRoute();

  loadDrivers();
  updateGuide();
}

/* ĐẶT ĐIỂM ĐẾN CỐ ĐỊNH, CHẠM VÀO GHIM ĐỂ MỞ BẢN ĐỒ CHỈNH SỬA VỊ TRÍ */
function setDestLocation(latlng) {
  if (markerEnd) map.removeLayer(markerEnd);

  markerEnd = L.marker(latlng, { icon: destinationIcon, draggable: false }).addTo(map);
    
  markerEnd.on('click', () => {
    triggerPinSelection('dest');
  });
    
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) resetBtn.style.display = 'inline-flex';
  
  calculateMapboxRoute();
  loadDrivers();
  updateGuide();
}

function useCurrentLocationAsPickup() {
  if (userLatLng) {
    if (currentSelectionMode) {
      centerMapOnPin(userLatLng, map.getZoom());
      fetchAddressForInput(currentSelectionMode, userLatLng);
    } else {
      map.setView(userLatLng, 15);
      setPickupLocation(userLatLng, true);
      const labelText = "Vị trí hiện tại của bạn";
      document.getElementById('pickupInput').value = labelText;
      saveRecentPickup(labelText, userLatLng.lat, userLatLng.lng);
    }
  } else {
    map.locate({ setView: true, maxZoom: 15 });
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
  const query = document.getElementById(type + 'Input').value.trim().substring(0, 200);
  const listEl = document.getElementById(type + 'Suggestions');
 
  if (query.length < 2) {
    if (type === 'pickup') showRecentPickups();
    else if (type === 'dest') showRecentDests();
    else listEl.style.display = 'none';
    return;
  }

  const executeSearch = async () => {
    let rawCenter = markerStart ? markerStart.getLatLng() : (userLatLng || getPinCenterLatLng());
    
    if (rawCenter && typeof rawCenter.wrap === 'function') {
      rawCenter = rawCenter.wrap();
    }

    const lat = Number(rawCenter.lat);
    const lng = Number(rawCenter.lng);

    const fetchGeocoding = async (bboxStr) => {
      let url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&country=vn&language=vi&limit=8`;
      if (rawCenter && lat && lng) {
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

    if (rawCenter && lat && lng) {
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
      listEl.style.display = 'none';
      return;
    }

    if (rawCenter && lat && lng) {
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
      
      document.getElementById(type + 'Input').value = placeName;
      listEl.style.display = 'none';
      const latlng = L.latLng(resLat, resLng);

      if (type === 'pickup') {
        setPickupLocation(latlng);
        saveRecentPickup(placeName, resLat, resLng);
        exitSelectionMode();
      } else {
        setDestLocation(latlng);
        saveRecentDest(placeName, resLat, resLng);
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
      if (rawCenter && lat && lng) {
        const d = safeDistance(lat, lng, fLat, fLng);
        distTag = ` • Cách ${d < 1 ? Math.round(d * 1000) + 'm' : d.toFixed(1) + 'km'}`;
      }

      const div = document.createElement('div');
      div.className = 'suggestion-item';
      div.innerHTML = `📍 <b>${mainTitle}</b> <small style="color:#64748b; font-size:11px;">(${addressSub}<b style="color:#00b14f;">${distTag}</b>)</small>`;
      
      div.onclick = () => {
        document.getElementById(type + 'Input').value = mainTitle;
        listEl.style.display = 'none';
        
        const latlng = L.latLng(fLat, fLng);

        if (type === 'pickup') {
          setPickupLocation(latlng);
          saveRecentPickup(mainTitle, fLat, fLng);
          exitSelectionMode();
        } else {
          setDestLocation(latlng);
          saveRecentDest(mainTitle, fLat, fLng);
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

document.addEventListener('click', (e) => {
  if (!e.target.closest('#vehicleFloatBtn') && !e.target.closest('#vehicleMenu')) {
    const menu = document.getElementById('vehicleMenu');
    if (menu) menu.style.display = 'none';
  }

  if (!e.target.closest('.search-input-group')) {
    document.getElementById('pickupSuggestions').style.display = 'none';
    document.getElementById('destSuggestions').style.display = 'none';
  }
});

function calculateFastRoute() {
  if (!markerStart || !markerEnd) return;
  const start = markerStart.getLatLng();
  const end = markerEnd.getLatLng();

  if (routeLine) map.removeLayer(routeLine);

  const straightKm = safeDistance(start.lat, start.lng, end.lat, end.lng);
  currentDistance = (straightKm * 1.3).toFixed(1);

  routeLine = L.polyline([start, end], { 
    color: '#94a3b8', 
    weight: 4, 
    dashArray: '8, 8', 
    opacity: 0.8 
  }).addTo(map);

  updatePrice();
}

/* TÍNH TOÁN LỘ TRÌNH VÀ TỰ ĐỘNG THU NHỎ BẢN ĐỒ KHÔNG CÓ HIỆU ỨNG TRƯỢT KÉO DÀI (ANIMATE: FALSE) */
async function calculateMapboxRoute() {
  if (!markerStart || !markerEnd) return;

  const start = markerStart.getLatLng();
  const end = markerEnd.getLatLng();
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

  if (routePoints && routePoints.length > 0) {
    routeLine = L.polyline(routePoints, { 
      color: '#00b14f', 
      weight: 6, 
      opacity: 0.9,
      lineCap: 'round',    
      lineJoin: 'round',   
      smoothFactor: 1 
    }).addTo(map);
  } else {
    const straightKm = safeDistance(start.lat, start.lng, end.lat, end.lng);
    currentDistance = (straightKm * 1.3).toFixed(1);
    routeLine = L.polyline([start, end], { 
      color: '#00b14f', 
      weight: 4, 
      dashArray: '8, 8', 
      opacity: 0.85 
    }).addTo(map);
  }

  // TẮT CHUYỂN CẢNH KÉO DÀI ĐỂ ÔM TOÀN CẢNH TỨC THÌ
  map.fitBounds(routeLine.getBounds(), { 
    padding: [60, 60],
    animate: false 
  });

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

  if (type === 'truck') {
    priceEl.innerText = 'Thỏa thuận';
    rateLabelEl.innerText = `(${currentDistance} km)`;
    return;
  }

  let rateVal = (type === 'car' || type === 'driver') ? 11000 : 6000;
  const isMinFare = parseFloat(currentDistance) < 3.0;
  const calcDistance = isMinFare ? 3.0 : parseFloat(currentDistance);

  currentPrice = Math.round(calcDistance * rateVal);
  priceEl.innerText = currentPrice.toLocaleString('vi-VN') + 'đ';
  rateLabelEl.innerText = `(${currentDistance} km)`;
}

function resetRoute() {
  clearTimeout(mapboxTimeout);
  if (markerStart) map.removeLayer(markerStart);
  if (markerEnd) map.removeLayer(markerEnd);
  if (routeLine) map.removeLayer(routeLine);
  markerStart = null;
  markerEnd = null;
  routeLine = null;
  currentDistance = 0;
  currentPrice = 0;
  
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) resetBtn.style.display = 'none';
  
  document.getElementById('pickupInput').value = '';
  document.getElementById('destInput').value = '';

  updatePrice();
  loadDrivers();
  enterSelectionMode('pickup');
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

const typeNames = { 
  'bike': '🛵 Xe máy (6.000đ/km)', 
  'car': '🚕 Ô tô (11.000đ/km)', 
  'driver': '👤 Lái xe hộ (11.000đ/km)', 
  'truck': '🚚 Chở hàng (Thỏa thuận)'
};

function showRatingModal(driver) {
  if (!driver) return;
  const todayStr = new Date().toDateString();
  const ratedKey = `avyo_rated_date_${driver.id}`;
  if (localStorage.getItem(ratedKey) === todayStr) {
    return;
  }
  ratingDriverTarget = driver;
  const titleEl = document.getElementById('ratingModalTitle');
  if (titleEl) titleEl.innerText = `Đánh Giá Tài Xế ${driver.name}`;
  
  highlightModalStars(0);

  const overlay = document.getElementById('ratingModalOverlay');
  if (overlay) overlay.classList.add('active');
}

function closeRatingModal() {
  const overlay = document.getElementById('ratingModalOverlay');
  if (overlay) overlay.classList.remove('active');
}

function highlightModalStars(count) {
  const stars = document.querySelectorAll('#modalStarBox .star-btn');
  stars.forEach((star) => {
    const starVal = parseInt(star.getAttribute('data-star'), 10);
    if (starVal <= count) star.classList.add('active');
    else star.classList.remove('active');
  });
}

async function submitModalRating(stars) {
  if (!ratingDriverTarget) return;
  const driver = ratingDriverTarget;
  closeRatingModal();

  const todayStr = new Date().toDateString();
  const ratedKey = `avyo_rated_date_${driver.id}`;

  const { data: isSuccess, error } = await supabaseClient.rpc('add_driver_rating', { 
    target_id: driver.id, 
    stars: stars 
  });

  if (error || isSuccess === false) {
    return alert("⚠️ Tài xế này đã đạt giới hạn tối đa 50 lượt đánh giá trong ngày hôm nay!");
  }

  localStorage.setItem(ratedKey, todayStr);
  driver.rating_sum = (driver.rating_sum || 25) + stars;
  driver.rating_count = (driver.rating_count || 5) + 1;

  alert(`🌟 Cảm ơn bạn đã đánh giá ${stars} sao cho tài xế ${driver.name}!`);
}

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
  
  setTimeout(() => showRatingModal(driver), 1000);
  window.location.href = `tel:${driver.phone}`;
}

async function openZaloById(driverId) {
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
  await supabaseClient.rpc('increment_driver_zalo', { target_id: driver.id });

  const typeName = typeNames[driver.vehicle_type] || 'Tài xế';
  let msg = `Chào ${typeName}, tôi muốn sử dụng dịch vụ Avyo:\n`;

  if (markerStart) {
    msg += `\n📍 Điểm đi: https://maps.google.com/?q=${markerStart.getLatLng().lat.toFixed(5)},${markerStart.getLatLng().lng.toFixed(5)}`;
  }
  if (markerEnd) {
    msg += `\n🚩 Điểm đến: https://maps.google.com/?q=${markerEnd.getLatLng().lat.toFixed(5)},${markerEnd.getLatLng().lng.toFixed(5)}`;
    msg += `\n📏 Quãng đường: ${currentDistance} km`;
    msg += `\n💰 Cước phí: ${driver.vehicle_type === 'truck' ? 'Thỏa thuận' : currentPrice.toLocaleString('vi-VN') + 'đ'}`;
  }

  setTimeout(() => showRatingModal(driver), 1000);

  navigator.clipboard.writeText(msg).then(() => {
    alert("✅ ĐÃ COPY LỘ TRÌNH!\n\nHệ thống mở Zalo ngay bây giờ. Bạn hãy dán (Paste) nội dung tin nhắn gửi cho tài xế nhé!");
    window.open(`https://zalo.me/${driver.phone}`, '_blank');
  }).catch(() => {
    window.open(`https://zalo.me/${driver.phone}?text=${encodeURIComponent(msg)}`, '_blank');
  });
}

async function loadDrivers() {
  const centerPoint = markerStart ? markerStart.getLatLng() : userLatLng;

  if (!centerPoint) {
    const { data } = await supabaseClient
      .from('public_drivers')
      .select('*')
      .eq('is_online', true)
      .neq('is_active', false)
      .eq('vehicle_type', activeFilter)
      .limit(15);
    
    rawDriversData = data || [];
  } else {
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

  if (driverMarkers[driver.id]) {
    map.panTo([driver.lat, driver.lng]);
    driverMarkers[driver.id].openPopup();
  }
}

function renderDriverMarkers() {
  const centerPoint = markerStart ? markerStart.getLatLng() : userLatLng;

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
  let filteredDrivers = [];

  if (centerPoint) {
    baseFiltered.sort((a, b) => {
      const distA = safeDistance(centerPoint.lat, centerPoint.lng, a.lat, a.lng);
      const distB = safeDistance(centerPoint.lat, centerPoint.lng, b.lat, b.lng);
      return distA - distB;
    });

    filteredDrivers = baseFiltered.filter(driver => {
      return safeDistance(centerPoint.lat, centerPoint.lng, driver.lat, driver.lng) <= 5;
    });

    if (filteredDrivers.length === 0) {
      filteredDrivers = baseFiltered.filter(driver => {
        return safeDistance(centerPoint.lat, centerPoint.lng, driver.lat, driver.lng) <= 15;
      });
      if (filteredDrivers.length > 0) isFallback = true;
    }
  } else {
    filteredDrivers = baseFiltered;
  }

  const top3Card = document.getElementById('top3Card');
  const top3List = document.getElementById('top3List');
  const radiusBadge = document.getElementById('radiusBadge');

  if (centerPoint && filteredDrivers.length > 0) {
    top3Card.style.display = 'block';
    top3List.innerHTML = '';

    if (isFallback) {
      radiusBadge.innerHTML = '<b style="color:#d97706;">Nới rộng 15km (Xung quanh ít xe)</b>';
    } else {
      radiusBadge.innerHTML = 'Bán kính 5km';
    }

    const top3 = filteredDrivers.slice(0, 3);
    top3.forEach(driver => {
      const isSelected = selectedDriver && selectedDriver.id === driver.id;
      const distKm = safeDistance(centerPoint.lat, centerPoint.lng, driver.lat, driver.lng);
      const rating = calcRating(driver);
      const avatarUrl = getOptimizedAvatar(driver.avatar_url);
      const typeBadge = typeNames[driver.vehicle_type] || 'Tài xế';

      const div = document.createElement('div');
      div.className = `top3-item ${isSelected ? 'selected' : ''}`;

      div.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; flex: 1;" onclick="selectDriver(rawDriversData.find(d => d.id === '${driver.id}'))">
          <img src="${avatarUrl}" class="driver-avatar-img" style="width:40px; height:40px;" onerror="this.src='https://cdn-icons-png.flaticon.com/512/149/149071.png'">
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
      top3List.appendChild(div);
    });
  } else {
    if (!centerPoint) {
      top3Card.style.display = 'none';
    } else {
      top3Card.style.display = 'block';
      radiusBadge.innerText = 'Bán kính 15km';
      top3List.innerHTML = `
        <div style="font-size:12px; color:#dc2626; text-align:center; padding:10px; background:#fef2f2; border-radius:10px; border:1px solid #fca5a5;">
          📍 Chưa tìm thấy tài xế nào trong phạm vi 15km quanh đây.<br>
          <small style="color:#64748b; margin-top:2px; display:block;">Vui lòng chuyển loại xe khác hoặc đổi vị trí đón.</small>
        </div>`;
    }
  }

  const currentValidIds = new Set();

  filteredDrivers.slice(0, 15).forEach(driver => {
    currentValidIds.add(driver.id);
    const icon = icons[driver.vehicle_type] || icons['bike'];
    const rating = calcRating(driver);
    const targetLatLng = [driver.lat, driver.lng];

    const popupHtml = `
      <div style="text-align:center; padding:2px; min-width:130px;">
        <b style="font-size:13px; color:#0f172a;">${driver.name}</b><br>
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

// Bật mặc định chọn ghim điểm đón ngay khi tải trang
enterSelectionMode('pickup');
loadDrivers();
updateGuide();

setInterval(() => {
  if (typeof loadDrivers === 'function') {
    loadDrivers();
  }
}, 12000);

document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

/* TỰ ĐỘNG LÀM MỚI KHI CÓ PHIÊN BẢN CẮT CACHE MỚI */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    console.log("App đã sẵn sàng hoạt động!");
    
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
  const themeToggleBtn = document.getElementById('themeToggle');
  const isDark = body.classList.toggle('dark-mode');
  
  localStorage.setItem('avyo_theme', isDark ? 'dark' : 'light');
  if (themeToggleBtn) {
    themeToggleBtn.innerText = isDark ? '☀️' : '🌙';
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
  const themeToggleBtn = document.getElementById('themeToggle');
  if (savedTheme === 'dark' && themeToggleBtn) {
    themeToggleBtn.innerText = '☀️';
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

    const emojiMatch = displayMsg.match(/^([\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|⚡|💡|⚠️|✅|⭐|🌟|📍|🎉)\s*/u);
    if (emojiMatch) {
      displayIcon = emojiMatch[1];
      displayMsg = displayMsg.replace(emojiMatch[0], '');
      
      if (displayIcon === '⚠️') displayTitle = 'Lưu ý';
      else if (displayIcon === '✅' || displayIcon === '🎉') displayTitle = 'Thành công';
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