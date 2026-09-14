// ==========================================
// KHU VỰC ĐIỀN GOONG API KEY (TÌM KIẾM & CHỈ ĐƯỜNG)
// ==========================================
const GOONG_API_KEY = 'wZbBHiRfw0cPiZaPMXIIfRyXv7NOaMy2m5K5mF7l'; 

const map = L.map('map', { 
  preferCanvas: true,
  attributionControl: false,
  zoomControl: false,
  fadeAnimation: true
}).setView([18.7034, 105.6832], 13);

L.control.zoom({ position: 'topright' }).addTo(map);

// ĐÃ SỬA: Sử dụng nền bản đồ OpenStreetMap miễn phí để loại bỏ lỗi "API KEY REQUIRED"
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  keepBuffer: 8,         // Nạp trước 8 ô bản đồ xung quanh màn hình
  updateWhenIdle: false,  // Cập nhật ô ảnh ngay lập tức khi tay di chuyển
  updateWhenZooming: false
}).addTo(map);

setTimeout(() => { if (map) map.invalidateSize(); }, 300);

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
let rawDriversData = [];
let searchTimer = null;

function getRecentPickups() {
  try {
    const data = localStorage.getItem(RECENT_PICKUPS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
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
      map.setView(latlng, 15);
      setPickupLocation(latlng);
      saveRecentPickup(item.label, item.lat, item.lng);
    };
    listEl.appendChild(div);
  });
  listEl.style.display = 'block';
}

function getRecentDests() {
  try {
    const data = localStorage.getItem(RECENT_DESTS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
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
      map.setView(latlng, 15);
      setDestLocation(latlng);
      saveRecentDest(item.label, item.lat, item.lng);
    };
    listEl.appendChild(div);
  });
  listEl.style.display = 'block';
}

function updateGuide() {
  const guideBox = document.getElementById('guideBox');
  const guideText = document.getElementById('guideText');
  if (!guideText) return;

  const hasPickup = !!markerStart;
  const hasDest = !!markerEnd;
  const hasDriver = !!selectedDriver;

  guideBox.classList.remove('success');

  if (!hasPickup && !hasDest && !hasDriver) {
    guideText.innerHTML = "📍 <b>Bước 1:</b> Nhập địa chỉ hoặc chạm bản đồ chọn <b>Điểm đón</b>.";
  } else if (hasPickup && !hasDest && !hasDriver) {
    guideText.innerHTML = "🚩 <b>Bước 2:</b> Nhập điểm đến hoặc chọn <b>Tài xế gần nhất</b>.";
  } else if (hasPickup && hasDest && !hasDriver) {
    guideText.innerHTML = "🚕 <b>Bước 3:</b> Chọn <b>Tài xế</b> bên dưới để xem giá & liên hệ.";
  } else if (hasDriver && !hasPickup && !hasDest) {
    guideText.innerHTML = `📍 Đã chọn <b>${selectedDriver.name}</b>! Chọn <b>Điểm đón</b> để tiếp tục.`;
  } else if (hasDriver && hasPickup && !hasDest) {
    guideText.innerHTML = `🚩 Đã có điểm đón! Chọn <b>Điểm đến</b> để tính tổng tiền cước.`;
  } else if (hasDriver && !hasPickup && hasDest) {
    guideText.innerHTML = `📍 Đã có điểm đến! Chọn <b>Điểm đón</b>.`;
  } else if (hasPickup && hasDest && hasDriver) {
    guideBox.classList.add('success');
    guideText.innerHTML = `🎉 <b>Hoàn tất!</b> Bấm <b>"💬 Nhắn Zalo"</b> hoặc <b>"📞 Gọi Điện"</b> để đặt xe.`;
  }
}

const pickupIcon = L.divIcon({
  html: `<svg width="34" height="34" viewBox="0 0 24 24" fill="#dc2626" stroke="#ffffff" stroke-width="1.5" style="filter: drop-shadow(0 3px 6px rgba(0,0,0,0.4));">
           <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
         </svg>`,
  className: 'custom-pin-icon',
  iconSize: [34, 34],
  iconAnchor: [17, 34],
  popupAnchor: [0, -34]
});

const destinationIcon = L.divIcon({
  html: `<svg width="34" height="34" viewBox="0 0 24 24" fill="#2563eb" stroke="#ffffff" stroke-width="1.5" style="filter: drop-shadow(0 3px 6px rgba(0,0,0,0.4));">
           <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
         </svg>`,
  className: 'custom-pin-icon',
  iconSize: [34, 34],
  iconAnchor: [17, 34],
  popupAnchor: [0, -34]
});

let activeFilter = 'bike';

function selectFilter(type, element) {
  if (activeFilter === type) return;
  
  activeFilter = type;
  document.querySelectorAll('.filter-bar .filter-chip').forEach(chip => chip.classList.remove('active'));
  element.classList.add('active');

  if (selectedDriver && selectedDriver.vehicle_type !== activeFilter) {
    deselectDriver();
  }

  loadDrivers();
}

map.locate({ setView: true, maxZoom: 15 });

map.on('locationfound', (e) => {
  userLatLng = e.latlng;
  setPickupLocation(e.latlng, true);
});

function setPickupLocation(latlng, isAuto = false) {
  if (markerStart) map.removeLayer(markerStart);
 
  markerStart = L.marker(latlng, { icon: pickupIcon, draggable: true }).addTo(map)
    .bindPopup(isAuto ? "<b style='color:#dc2626;'>📍 Điểm đón của bạn</b><br><small><i>(Nhấn giữ & kéo để đổi vị trí)</i></small>" : "<b style='color:#dc2626;'>📍 Điểm đón</b><br><small><i>(Nhấn giữ & kéo để đổi vị trí)</i></small>")
    .openPopup();
   
  markerStart.on('dragend', () => {
    calculateRoute();
    loadDrivers();
  });
   
  document.getElementById('resetBtn').style.display = 'block';
  if (markerEnd) calculateRoute();

  loadDrivers();
  updateGuide();
}

function setDestLocation(latlng) {
  if (markerEnd) map.removeLayer(markerEnd);

  markerEnd = L.marker(latlng, { icon: destinationIcon, draggable: true }).addTo(map)
    .bindPopup("<b style='color:#2563eb;'>🚩 Điểm đến</b><br><small><i>(Nhấn giữ & kéo để đổi vị trí)</i></small>")
    .openPopup();
   
  markerEnd.on('dragend', calculateRoute);
  document.getElementById('resetBtn').style.display = 'block';
  calculateRoute();
  loadDrivers();
  updateGuide();
}

function useCurrentLocationAsPickup() {
  if (userLatLng) {
    setPickupLocation(userLatLng, true);
    const labelText = "Vị trí hiện tại của bạn";
    document.getElementById('pickupInput').value = labelText;
    map.setView(userLatLng, 15);
    saveRecentPickup(labelText, userLatLng.lat, userLatLng.lng);
  } else {
    map.locate({ setView: true, maxZoom: 15 });
  }
}

map.on('click', function(e) {
  if (!markerStart) {
    setPickupLocation(e.latlng, false);
  } else if (!markerEnd) {
    setDestLocation(e.latlng);
  }
});

function onSearchInput(type) {
  clearTimeout(searchTimer);
  const query = document.getElementById(type + 'Input').value.trim();
  const listEl = document.getElementById(type + 'Suggestions');
 
  if (query.length < 2) {
    if (type === 'pickup') {
      showRecentPickups();
    } else if (type === 'dest') {
      showRecentDests();
    } else {
      listEl.style.display = 'none';
    }
    return;
  }

  searchTimer = setTimeout(() => {
    fetchAddressSuggestions(query, (items) => {
      listEl.innerHTML = '';
      if (!items || items.length === 0) {
        listEl.style.display = 'none';
        return;
      }
      items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.innerHTML = item.is_cached ? `⚡ <b>${item.label}</b>` : item.label;
       
        div.onclick = async () => {
          document.getElementById(type + 'Input').value = item.label;
          listEl.style.display = 'none';
         
          if (item.lat && item.lng) {
            const latlng = L.latLng(item.lat, item.lng);
            map.setView(latlng, 15);
            if (type === 'pickup') {
              setPickupLocation(latlng);
              saveRecentPickup(item.label, item.lat, item.lng);
            } else {
              setDestLocation(latlng);
              saveRecentDest(item.label, item.lat, item.lng);
            }

            if (!item.is_cached) {
              try {
                await supabaseClient.from('cached_locations').insert([{
                  name: item.label,
                  lat: item.lat,
                  lng: item.lng
                }]);
              } catch(e) {}
            }
          }
        };
        listEl.appendChild(div);
      });
      listEl.style.display = 'block';
    });
  }, 350);
}

async function fetchAddressSuggestions(query, callback) {
  const qLower = query.toLowerCase();
  const localKey = `avyo_search_${qLower}`;
  const localCache = localStorage.getItem(localKey);
 
  if (localCache) {
    try {
      return callback(JSON.parse(localCache));
    } catch(e) {}
  }

  try {
    const { data: cachedData } = await supabaseClient
      .from('cached_locations')
      .select('*')
      .ilike('name', `%${query}%`)
      .limit(5);

    if (cachedData && cachedData.length > 0) {
      const resList = cachedData.map(item => ({
        label: item.name,
        lat: item.lat,
        lng: item.lng,
        is_cached: true
      }));
      localStorage.setItem(localKey, JSON.stringify(resList));
      return callback(resList);
    }
  } catch (err) {}

  if (GOONG_API_KEY && GOONG_API_KEY !== 'NHẬP_GOONG_API_KEY_CỦA_BẠN_TẠI_ĐÂY') {
    try {
      const res = await fetch(`https://api.goong.io/Place/AutoComplete?api_key=${GOONG_API_KEY}&input=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.predictions) {
        const results = [];
        for (let p of data.predictions.slice(0, 5)) {
          const detailRes = await fetch(`https://api.goong.io/Place/Detail?api_key=${GOONG_API_KEY}&place_id=${p.place_id}`);
          const detailData = await detailRes.json();
          if (detailData.result && detailData.result.geometry) {
            results.push({
              label: p.description,
              lat: detailData.result.geometry.location.lat,
              lng: detailData.result.geometry.location.lng,
              is_cached: false
            });
          }
        }
        if (results.length > 0) {
          localStorage.setItem(localKey, JSON.stringify(results));
          return callback(results);
        }
      }
    } catch(e) {}
  }

  try {
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`);
    const data = await res.json();
    if (data.features) {
      const results = data.features.map(f => {
        const p = f.properties;
        const fullAddr = [p.name, p.street, p.district, p.city, p.country].filter(Boolean).join(', ');
        return {
          label: fullAddr || p.name,
          lat: f.geometry.coordinates[1],
          lng: f.geometry.coordinates[0],
          is_cached: false
        };
      });
      if (results.length > 0) {
        localStorage.setItem(localKey, JSON.stringify(results));
      }
      return callback(results);
    }
  } catch(e) {
    callback([]);
  }
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-input-group')) {
    document.getElementById('pickupSuggestions').style.display = 'none';
    document.getElementById('destSuggestions').style.display = 'none';
  }
});

async function calculateRoute() {
  if (!markerStart || !markerEnd) return;

  const start = markerStart.getLatLng();
  const end = markerEnd.getLatLng();

  if (routeLine) map.removeLayer(routeLine);

  const rawKm = calculateDistance(start.lat, start.lng, end.lat, end.lng);
  currentDistance = rawKm.toFixed(1);

  if (GOONG_API_KEY && GOONG_API_KEY !== 'NHẬP_GOONG_API_KEY_CỦA_BẠN_TẠI_ĐÂY') {
    try {
      const res = await fetch(`https://api.goong.io/Direction?origin=${start.lat},${start.lng}&destination=${end.lat},${end.lng}&vehicle=car&api_key=${GOONG_API_KEY}`);
      const data = await res.json();
      if (data.routes && data.routes.length > 0) {
        currentDistance = (data.routes[0].legs[0].distance.value / 1000).toFixed(1);
        drawFallbackRoute(start, end);
      } else {
        drawFallbackRoute(start, end);
      }
    } catch(err) { drawFallbackRoute(start, end); }
  } else {
    try {
      const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`);
      const data = await response.json();

      if (data.routes && data.routes.length > 0) {
        const coordinates = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
        routeLine = L.polyline(coordinates, { color: '#00b14f', weight: 5, opacity: 0.85 }).addTo(map);
        map.fitBounds(routeLine.getBounds(), { padding: [40, 40] });
        currentDistance = (data.routes[0].distance / 1000).toFixed(1);
      } else {
        drawFallbackRoute(start, end);
      }
    } catch (err) {
      drawFallbackRoute(start, end);
    }
  }

  document.getElementById('distance').innerText = currentDistance;
  updatePrice();
  updateGuide();
}

function drawFallbackRoute(start, end) {
  routeLine = L.polyline([start, end], { color: '#00b14f', weight: 4, dashArray: '8, 8' }).addTo(map);
  map.fitBounds(routeLine.getBounds(), { padding: [40, 40] });
  const km = calculateDistance(start.lat, start.lng, end.lat, end.lng);
  currentDistance = km.toFixed(1);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  return getHaversineDistance(lat1, lon1, lat2, lon2) * 1.28;
}

function updatePrice() {
  const priceEl = document.getElementById('price');
  const rateLabelEl = document.getElementById('rate-label');

  if (!selectedDriver) {
    priceEl.innerText = '0 VNĐ';
    rateLabelEl.innerText = currentDistance > 0 ? '(Vui lòng chọn tài xế)' : '';
    return;
  }

  const type = selectedDriver.vehicle_type;
  let rateText = '';
  let rateVal = 0;

  if (type === 'truck') {
    rateText = 'Thỏa thuận với tài xế';
  } else if (type === 'car') {
    rateVal = 11000;
    rateText = 'Đơn giá: 11.000 VNĐ/km (Ô tô)';
  } else if (type === 'driver') {
    rateVal = 11000;
    rateText = 'Đơn giá: 11.000 VNĐ/km (Lái xe hộ)';
  } else {
    rateVal = 6000;
    rateText = 'Đơn giá: 6.000 VNĐ/km (Xe máy)';
  }

  if (!markerStart || !markerEnd || currentDistance == 0) {
    priceEl.innerText = type === 'truck' ? 'Thỏa thuận' : '0 VNĐ';
    rateLabelEl.innerText = rateText;
  } else {
    if (type === 'truck') {
      priceEl.innerText = 'Thỏa thuận';
      rateLabelEl.innerText = '(Xe chở hàng)';
      currentPrice = 'Thỏa thuận';
    } else {
      const isMinFare = parseFloat(currentDistance) < 3.0;
      const calcDistance = isMinFare ? 3.0 : parseFloat(currentDistance);

      currentPrice = Math.round(calcDistance * rateVal);
      priceEl.innerText = currentPrice.toLocaleString('vi-VN') + ' VNĐ';

      if (isMinFare) {
        rateLabelEl.innerText = `⚠️ Cước tối thiểu 3km (${currentDistance} km)`;
      } else {
        rateLabelEl.innerText = `(${rateText} • ${currentDistance} km)`;
      }
    }
  }
}

function resetRoute() {
  if (markerStart) map.removeLayer(markerStart);
  if (markerEnd) map.removeLayer(markerEnd);
  if (routeLine) map.removeLayer(routeLine);
  markerStart = null;
  markerEnd = null;
  routeLine = null;
  currentDistance = 0;
  currentPrice = 0;
  document.getElementById('distance').innerText = '0';
  document.getElementById('resetBtn').style.display = 'none';
  document.getElementById('pickupInput').value = '';
  document.getElementById('destInput').value = '';

  updatePrice();
  loadDrivers();
  updateGuide();
}

function deselectDriver() {
  selectedDriver = null;
  document.getElementById('driver-info').innerHTML = '<i>Chạm chọn tài xế từ danh sách hoặc trên bản đồ...</i>';
  document.getElementById('zaloBtn').style.display = 'none';
  document.getElementById('phoneBtn').style.display = 'none';
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

const typeNames = { 'bike': '🛵 Xe máy', 'car': '🚕 Ô tô', 'driver': '👤 Lái xe hộ', 'truck': '🚚 Xe chở hàng' };

async function trackCall(event) {
  if (event) event.preventDefault();
  if (!selectedDriver) return;

  const centerPoint = markerStart ? markerStart.getLatLng() : userLatLng;
  if (centerPoint) {
    const distKm = getHaversineDistance(centerPoint.lat, centerPoint.lng, selectedDriver.lat, selectedDriver.lng);
    if (distKm > 15) {
      return alert(`⚠️ Tài xế đang ở cách bạn ${distKm.toFixed(1)}km (ngoài bán kính 15km). Hãy chọn tài xế ở gần hơn!`);
    }
  }

  localStorage.setItem(`avyo_unlocked_rating_${selectedDriver.id}`, 'true');
  await supabaseClient.rpc('increment_driver_call', { target_id: selectedDriver.id });
  window.location.href = `tel:${selectedDriver.phone}`;
}

async function openZalo() {
  if (!selectedDriver) return;

  const centerPoint = markerStart ? markerStart.getLatLng() : userLatLng;
  if (centerPoint) {
    const distKm = getHaversineDistance(centerPoint.lat, centerPoint.lng, selectedDriver.lat, selectedDriver.lng);
    if (distKm > 15) {
      return alert(`⚠️ Tài xế đang ở cách bạn ${distKm.toFixed(1)}km (ngoài bán kính 15km). Hãy chọn tài xế ở gần hơn!`);
    }
  }

  localStorage.setItem(`avyo_unlocked_rating_${selectedDriver.id}`, 'true');
  await supabaseClient.rpc('increment_driver_zalo', { target_id: selectedDriver.id });

  const typeName = typeNames[selectedDriver.vehicle_type] || 'Tài xế';
  let msg = `Chào ${typeName}, tôi muốn sử dụng dịch vụ Avyo:\n`;

  if (markerStart) {
    msg += `\n📍 Điểm đi: https://maps.google.com/?q=${markerStart.getLatLng().lat.toFixed(5)},${markerStart.getLatLng().lng.toFixed(5)}`;
  }
  if (markerEnd) {
    msg += `\n🚩 Điểm đến: https://maps.google.com/?q=${markerEnd.getLatLng().lat.toFixed(5)},${markerEnd.getLatLng().lng.toFixed(5)}`;
    msg += `\n📏 Quãng đường: ${currentDistance} km`;
    msg += `\n💰 Cước ước tính: ${selectedDriver.vehicle_type === 'truck' ? 'Thỏa thuận' : currentPrice.toLocaleString('vi-VN') + ' VNĐ'}`;
  }

  navigator.clipboard.writeText(msg).then(() => {
    alert("✅ ĐÃ COPY LỘ TRÌNH!\n\nHệ thống mở Zalo ngay bây giờ. Bạn hãy dán (Paste) nội dung tin nhắn gửi cho tài xế nhé!");
    window.open(`https://zalo.me/${selectedDriver.phone}`, '_blank');
  }).catch(() => {
    window.open(`https://zalo.me/${selectedDriver.phone}?text=${encodeURIComponent(msg)}`, '_blank');
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

function highlightStars(count) {
  const stars = document.querySelectorAll('.star-btn');
  stars.forEach((star, index) => {
    if (index < count) star.classList.add('active');
    else star.classList.remove('active');
  });
}

async function submitRating(stars) {
  if (!selectedDriver) return;

  const isUnlocked = localStorage.getItem(`avyo_unlocked_rating_${selectedDriver.id}`);
  if (!isUnlocked) {
    return alert("⚠️ Bạn cần bấm '📞 Gọi Điện' hoặc '💬 Nhắn Zalo' liên hệ với tài xế để mở quyền đánh giá!");
  }

  const todayStr = new Date().toDateString();
  const ratedKey = `avyo_rated_date_${selectedDriver.id}`;
  if (localStorage.getItem(ratedKey) === todayStr) {
    return alert("⭐ Hôm nay bạn đã gửi đánh giá cho tài xế này rồi!");
  }

  const { data: isSuccess, error } = await supabaseClient.rpc('add_driver_rating', { 
    target_id: selectedDriver.id, 
    stars: stars 
  });

  if (error || isSuccess === false) {
    return alert("⚠️ Tài xế này đã đạt giới hạn tối đa 50 lượt đánh giá trong ngày hôm nay!");
  }

  localStorage.setItem(ratedKey, todayStr);
  selectedDriver.rating_sum = (selectedDriver.rating_sum || 25) + stars;
  selectedDriver.rating_count = (selectedDriver.rating_count || 5) + 1;
  const rating = calcRating(selectedDriver);
 
  document.getElementById('rating-display').innerText = `${rating.score} / 5.0 (${rating.count} lượt)`;
  alert(`🌟 Cảm ơn bạn đã đánh giá ${stars} sao cho tài xế ${selectedDriver.name}!`);
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
    const distKm = getHaversineDistance(centerPoint.lat, centerPoint.lng, driver.lat, driver.lng);
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

  const avatarUrl = getOptimizedAvatar(driver.avatar_url);
  const typeBadge = typeNames[driver.vehicle_type] || 'Tài xế';
  const rating = calcRating(driver);

  document.getElementById('driver-info').innerHTML = `
    <div class="driver-profile-box">
      <img src="${avatarUrl}" class="driver-avatar-img" alt="${driver.name}" onerror="this.src='https://cdn-icons-png.flaticon.com/512/149/149071.png'">
      <div>
        <div style="font-size: 15px; font-weight: bold; color: #0f172a;">${driver.name}</div>
        <div style="font-size: 13px; color: #00b14f; font-weight: 600;">${typeBadge} • ${driver.vehicle || 'Xe chuẩn'}</div>
        <div style="font-size: 12px; color: #eab308; font-weight: bold; margin-top: 2px;">
          ⭐ <span id="rating-display">${rating.score} / 5.0 (${rating.count} lượt)</span>
        </div>
      </div>
    </div>
   
    <div style="margin-top: 8px; padding-top: 6px; border-top: 1px dashed #e2e8f0; text-align: center;">
      <span style="font-size: 11px; color: #64748b; display: block; margin-bottom: 2px;">Chạm chọn số sao để đánh giá dịch vụ:</span>
      <div style="font-size: 22px; user-select: none;" onmouseleave="highlightStars(0)">
        <span class="star-btn" onmouseover="highlightStars(1)" onclick="submitRating(1)">⭐</span>
        <span class="star-btn" onmouseover="highlightStars(2)" onclick="submitRating(2)">⭐</span>
        <span class="star-btn" onmouseover="highlightStars(3)" onclick="submitRating(3)">⭐</span>
        <span class="star-btn" onmouseover="highlightStars(4)" onclick="submitRating(4)">⭐</span>
        <span class="star-btn" onmouseover="highlightStars(5)" onclick="submitRating(5)">⭐</span>
      </div>
    </div>
  `;

  document.getElementById('phoneBtn').href = `tel:${driver.phone}`;
  updatePrice();
  document.getElementById('zaloBtn').style.display = 'block';
  document.getElementById('phoneBtn').style.display = 'block';

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
      const distA = getHaversineDistance(centerPoint.lat, centerPoint.lng, a.lat, a.lng);
      const distB = getHaversineDistance(centerPoint.lat, centerPoint.lng, b.lat, b.lng);
      return distA - distB;
    });

    filteredDrivers = baseFiltered.filter(driver => {
      return getHaversineDistance(centerPoint.lat, centerPoint.lng, driver.lat, driver.lng) <= 5;
    });

    if (filteredDrivers.length === 0) {
      filteredDrivers = baseFiltered.filter(driver => {
        return getHaversineDistance(centerPoint.lat, centerPoint.lng, driver.lat, driver.lng) <= 15;
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
      const distKm = getHaversineDistance(centerPoint.lat, centerPoint.lng, driver.lat, driver.lng);
      const rating = calcRating(driver);
      const avatarUrl = getOptimizedAvatar(driver.avatar_url);
      const typeBadge = typeNames[driver.vehicle_type] || 'Tài xế';

      const div = document.createElement('div');
      div.className = `top3-item ${isSelected ? 'selected' : ''}`;
      div.onclick = () => selectDriver(driver);

      div.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
          <img src="${avatarUrl}" class="driver-avatar-img" style="width:40px; height:40px;" onerror="this.src='https://cdn-icons-png.flaticon.com/512/149/149071.png'">
          <div>
            <div style="font-weight:bold; font-size:13px; color:#0f172a;">${driver.name}</div>
            <div style="font-size:11px; color:#64748b;">${typeBadge} • Cách <b>${distKm.toFixed(1)} km</b></div>
            <div style="font-size:11px; color:#eab308; font-weight:bold;">⭐ ${rating.score} (${rating.count} lượt)</div>
          </div>
        </div>
        <button class="btn-select-driver ${isSelected ? 'active' : 'normal'}">
          ${isSelected ? 'ĐÃ CHỌN' : 'CHỌN XE'}
        </button>
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
    const typeBadge = typeNames[driver.vehicle_type] || 'Tài xế';
    const rating = calcRating(driver);
    const targetLatLng = [driver.lat, driver.lng];

    if (driverMarkers[driver.id]) {
      const existingMarker = driverMarkers[driver.id];
      const currPos = existingMarker.getLatLng();

      if (Math.abs(currPos.lat - driver.lat) > 0.00001 || Math.abs(currPos.lng - driver.lng) > 0.00001) {
        existingMarker.moveTo(targetLatLng, 2500);
      }

      existingMarker.setIcon(icon);
      existingMarker.setPopupContent(`
        <div style="text-align:center;">
          <b>${typeBadge}: ${driver.name}</b><br>
          <span style="color:#eab308; font-weight:bold;">⭐ ${rating.score} / 5.0</span> 
          <small style="color:#64748b;">(${rating.count} lượt)</small>
        </div>
      `);
    } else {
      const marker = L.Marker.movingMarker([targetLatLng, targetLatLng], [1000], { icon: icon }).addTo(map);
      
      marker.bindPopup(`
        <div style="text-align:center;">
          <b>${typeBadge}: ${driver.name}</b><br>
          <span style="color:#eab308; font-weight:bold;">⭐ ${rating.score} / 5.0</span> 
          <small style="color:#64748b;">(${rating.count} lượt)</small>
        </div>
      `);
     
      marker.on('click', () => selectDriver(driver));
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

loadDrivers();
updateGuide();

setInterval(() => {
  if (typeof loadDrivers === 'function') {
    loadDrivers();
  }
}, 12000);

document.addEventListener('gesturestart', function (e) {
  e.preventDefault();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => {
    console.log("App đã sẵn sàng hoạt động!");
  });
}

// ==========================================
// CHỨC NĂNG CHẾ ĐỘ TỐI (DARK MODE)
// ==========================================

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

// ==========================================
// GHI ĐÈ HÀM ALERT BẰNG POPUP SANG TRỌNG (CUSTOM ALERT)
// ==========================================

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