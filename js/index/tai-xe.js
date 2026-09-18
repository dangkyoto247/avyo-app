// ICON ĐỘNG CỦA CÁC LOẠI XE
let driverMarkers = {};

const icons = {
  'bike': L.divIcon({ html: '<div class="vehicle-icon">🛵</div>', className: 'custom-icon', iconSize: [30, 30], iconAnchor: [15, 15] }),
  'car': L.divIcon({ html: '<div class="vehicle-icon">🚕</div>', className: 'custom-icon', iconSize: [30, 30], iconAnchor: [15, 15] }),
  'driver': L.divIcon({ html: '<div class="vehicle-icon"><svg viewBox="0 0 24 24" fill="#00b14f" width="30px" height="30px"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg></div>', className: 'custom-icon', iconSize: [30, 30], iconAnchor: [15, 15] }),
  'truck': L.divIcon({ html: '<div class="vehicle-icon">🚚</div>', className: 'custom-icon', iconSize: [30, 30], iconAnchor: [15, 15] })
};

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
  if (activeLabel && typeIcons[type]) activeLabel.innerHTML = typeIcons[type];

  if (selectedDriver && selectedDriver.vehicle_type !== activeFilter) deselectDriver();
  loadDrivers();
  updatePrice();
}

function updatePrice() {
  const priceEl = document.getElementById('price');
  const rateLabelEl = document.getElementById('rate-label');
  if (!priceEl || !rateLabelEl) return;

  if (!markerStart || !markerEnd || currentDistance == 0) {
    priceEl.innerText = '0đ'; rateLabelEl.innerText = ''; return;
  }

  const type = activeFilter;
  const distVal = parseFloat(currentDistance);

  if (type === 'truck' || distVal > 100) {
    priceEl.innerText = 'Thỏa thuận'; rateLabelEl.innerText = `(${currentDistance} km)`; return;
  }

  let rateVal = 4500, minFare = 12000;
  if (type === 'car') { rateVal = 9000; minFare = 24000; }
  else if (type === 'driver') { rateVal = 10000; minFare = 50000; }

  currentPrice = Math.max(minFare, Math.round(distVal * rateVal));
  priceEl.innerText = currentPrice.toLocaleString('vi-VN') + 'đ';
  rateLabelEl.innerText = `(${currentDistance} km)`;
}

function deselectDriver() {
  selectedDriver = null;
  updatePrice();
  updateGuide();
}

function calcRating(driver) {
  const sum = driver.rating_sum || 25, count = driver.rating_count || 5;
  return { score: (sum / count).toFixed(1), count: count };
}

async function loadDrivers() {
  const centerPoint = markerStart ? markerStart.getLatLng() : (userLatLng || map.getCenter());

  if (centerPoint) {
    let { data: nearbyData } = await supabaseClient.rpc('get_nearby_drivers', {
      user_lat: centerPoint.lat, user_lng: centerPoint.lng, radius_km: 5.0, v_type: activeFilter
    });
    if (!nearbyData || nearbyData.length === 0) {
      let { data: fallbackData } = await supabaseClient.rpc('get_nearby_drivers', {
        user_lat: centerPoint.lat, user_lng: centerPoint.lng, radius_km: 15.0, v_type: activeFilter
      });
      rawDriversData = fallbackData || [];
    } else { rawDriversData = nearbyData; }
  } else {
    const { data } = await supabaseClient.from('public_drivers').select('*').eq('is_online', true).neq('is_active', false).eq('vehicle_type', activeFilter).limit(15);
    rawDriversData = data || [];
  }

  if (selectedDriver) {
    const freshDriverData = rawDriversData.find(d => d.id === selectedDriver.id);
    if (freshDriverData) selectedDriver = freshDriverData; else deselectDriver();
  }
  renderDriverMarkers();
}

async function selectDriver(driver) {
  if (selectedDriver && selectedDriver.id === driver.id) {
    deselectDriver(); renderDriverMarkers(); return;
  }

  selectedDriver = driver; updateGuide();
  const centerPoint = markerStart ? markerStart.getLatLng() : userLatLng;
  if (centerPoint) {
    const distKm = safeDistance(centerPoint.lat, centerPoint.lng, driver.lat, driver.lng);
    if (distKm <= 0.1) localStorage.setItem(`avyo_unlocked_rating_${driver.id}`, 'true');
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

  const driverMarker = driverMarkers[driver.id];
  const targetLatLng = driverMarker ? driverMarker.getLatLng() : (driver.lat && driver.lng ? L.latLng(driver.lat, driver.lng) : null);
  if (targetLatLng) {
    const pinTopOffset = -60; 
    centerMapOnPin(targetLatLng, null, pinTopOffset, true);
  }

  if (driverMarker) {
    driverMarker.openPopup();
  }
}

function renderDriverMarkers() {
  const hasPickup = !!markerStart;
  const centerPoint = hasPickup ? markerStart.getLatLng() : (userLatLng || map.getCenter());

  let baseFiltered = rawDriversData.filter(driver => {
    if (driver.vehicle_type !== activeFilter) return false;
    if (!driver.lat || !driver.lng) return false;
    if (!driver.updated_at) return false;
    const lastUpdateStr = (driver.updated_at.includes('Z') || driver.updated_at.includes('+')) ? driver.updated_at : driver.updated_at.replace(' ', 'T') + 'Z';
    if ((Date.now() - new Date(lastUpdateStr).getTime()) / 1000 > 120) return false;
    return true;
  });

  let isFallback = false;
  if (centerPoint) {
    baseFiltered.sort((a, b) => safeDistance(centerPoint.lat, centerPoint.lng, a.lat, a.lng) - safeDistance(centerPoint.lat, centerPoint.lng, b.lat, b.lng));
    let withinRadius = baseFiltered.filter(driver => safeDistance(centerPoint.lat, centerPoint.lng, driver.lat, driver.lng) <= 5);
    if (withinRadius.length === 0) {
      withinRadius = baseFiltered.filter(driver => safeDistance(centerPoint.lat, centerPoint.lng, driver.lat, driver.lng) <= 15);
      if (withinRadius.length > 0) isFallback = true;
    }
    if (withinRadius.length > 0) baseFiltered = withinRadius;
  }

  const maxDisplayCount = hasPickup ? 3 : 15;
  const filteredDrivers = baseFiltered.slice(0, maxDisplayCount);
  const top3List = document.getElementById('top3List');
  const radiusBadge = document.getElementById('radiusBadge');

  if (hasPickup && filteredDrivers.length > 0) {
    if (top3List) top3List.innerHTML = '';
    if (radiusBadge) radiusBadge.innerHTML = isFallback ? '<b style="color:#d97706;">Nới rộng 15km (Xung quanh ít xe)</b>' : 'Bán kính 5km';

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
    if (top3List) top3List.innerHTML = `<div style="font-size:12px; color:#dc2626; text-align:center; padding:10px; background:#fef2f2; border-radius:10px; border:1px solid #fca5a5;">📍 Chưa tìm thấy tài xế nào trong phạm vi 15km quanh đây.<br><small style="color:#64748b; margin-top:2px; display:block;">Vui lòng chuyển loại xe khác hoặc đổi vị trí đón.</small></div>`;
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
      if (Math.abs(currPos.lat - driver.lat) > 0.00001 || Math.abs(currPos.lng - driver.lng) > 0.00001) existingMarker.moveTo(targetLatLng, 2500);
      existingMarker.setIcon(icon);
      existingMarker.setPopupContent(popupHtml);
    } else {
      const marker = L.Marker.movingMarker([targetLatLng, targetLatLng], [1000], { icon: icon }).addTo(map);
      marker.bindPopup(popupHtml, { autoPan: false });
      marker.on('click', () => selectDriver(driver));
      driverMarkers[driver.id] = marker;
    }
  });

  Object.keys(driverMarkers).forEach(id => {
    if (!currentValidIds.has(id)) { map.removeLayer(driverMarkers[id]); delete driverMarkers[id]; }
  });
}

async function trackCallById(event, driverId) {
  if (event) event.preventDefault();
  const driver = rawDriversData.find(d => d.id === driverId) || selectedDriver;
  if (!driver) return;
  if (!selectedDriver || selectedDriver.id !== driver.id) await selectDriver(driver);

  const centerPoint = markerStart ? markerStart.getLatLng() : userLatLng;
  if (centerPoint) {
    const distKm = safeDistance(centerPoint.lat, centerPoint.lng, driver.lat, driver.lng);
    if (distKm > 15) return alert(`⚠️ Tài xế đang ở cách bạn ${distKm.toFixed(1)}km (ngoài bán kính 15km). Hãy chọn tài xế ở gần hơn!`);
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
    const sLat = markerStart.getLatLng().lat.toFixed(5), sLng = markerStart.getLatLng().lng.toFixed(5);
    const eLat = markerEnd.getLatLng().lat.toFixed(5), eLng = markerEnd.getLatLng().lng.toFixed(5);
    const mapRouteUrl = `https://www.google.com/maps/dir/?api=1&origin=${sLat},${sLng}&destination=${eLat},${eLng}&travelmode=driving`;
    msg += `\n🗺️ Lộ trình Google Maps: ${mapRouteUrl}`;
    if (pickupDetailNote) msg += `\n📝 Chi tiết điểm đón: ${pickupDetailNote}`;
    msg += `\n📏 Quãng đường: ${currentDistance} km`;
    msg += `\n💰 Cước phí: ${(driver.vehicle_type === 'truck' || distVal > 100) ? 'Thỏa thuận' : currentPrice.toLocaleString('vi-VN') + 'đ'}`;
  } else if (markerStart) {
    const sLat = markerStart.getLatLng().lat.toFixed(5), sLng = markerStart.getLatLng().lng.toFixed(5);
    msg += `\n📍 Điểm đi: https://maps.google.com/?q=${sLat},${sLng}`;
    if (pickupDetailNote) msg += `\n📝 Chi tiết điểm đón: ${pickupDetailNote}`;
  }
  copyToClipboard(msg);

  if (!selectedDriver || selectedDriver.id !== driver.id) await selectDriver(driver);

  const centerPoint = markerStart ? markerStart.getLatLng() : userLatLng;
  if (centerPoint) {
    const distKm = safeDistance(centerPoint.lat, centerPoint.lng, driver.lat, driver.lng);
    if (distKm > 15) return alert(`⚠️ Tài xế đang ở cách bạn ${distKm.toFixed(1)}km (ngoài bán kính 15km). Hãy chọn tài xế ở gần hơn!`);
  }

  localStorage.setItem(`avyo_unlocked_rating_${driver.id}`, 'true');
  await supabaseClient.rpc('increment_driver_zalo', { target_id: driver.id });
  await alert("✅ ĐÃ COPY LỘ TRÌNH!\n\nHệ thống mở Zalo ngay bây giờ. Bạn hãy dán (Paste) nội dung tin nhắn gửi cho tài xế nhé!");
  
  // GỌI HÀM MỞ ZALO CHỐNG CHẶN RATE-LIMIT
  if (typeof openZaloApp === 'function') {
    openZaloApp(driver.phone);
  } else {
    window.open(`https://zalo.me/${driver.phone.replace(/\D/g, '')}`, '_blank', 'noopener,noreferrer');
  }
}