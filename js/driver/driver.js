const SUPABASE_URL = 'https://yvucyqkglbgxvozrznir.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2dWN5cWtnbGJneHZvenJ6bmlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMzA3ODAsImV4cCI6MjEwNDcwNjc4MH0.Zagl4i2LPmxW3w9ih0h4LRsrm-OOGtPcWgvEs2vHBqo';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let isOnline = false;
let watchId = null;
let currentDriverId = localStorage.getItem('avyo_driver_id');
let currentSessionToken = localStorage.getItem('avyo_session_token');

let driverData = null; 
let timeInterval = null;
let wakeLock = null;

let driverMap = null;
let driverMarker = null;
let lastSentLat = 0, lastSentLng = 0;

const LOCK_TIME_MS = 60 * 60 * 1000;
const typeLabels = { 'bike': '🛵 Xe máy', 'car': '🚕 Ô tô', 'driver': '👤 Lái xe hộ', 'truck': '🚚 Chở hàng' };

function initTheme() {
  const savedTheme = localStorage.getItem('avyo_theme') || 'dark';
  const btn = document.getElementById('themeToggleBtn');
  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
    if (btn) btn.innerText = '☀️';
  } else {
    document.body.classList.remove('light-mode');
    if (btn) btn.innerText = '🌙';
  }
}

function toggleTheme() {
  const isLight = document.body.classList.toggle('light-mode');
  localStorage.setItem('avyo_theme', isLight ? 'light' : 'dark');
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.innerText = isLight ? '☀️' : '🌙';
}

initTheme();

function initSavedPhone() {
  const savedPhone = localStorage.getItem('avyo_last_phone');
  if (savedPhone) {
    const phoneInput = document.getElementById('phoneInput');
    if (phoneInput) phoneInput.value = savedPhone;
  }
}

function showNetworkAlert() {
  const el = document.getElementById('networkAlertModal');
  if (el) el.style.display = 'block';
}

function hideNetworkAlert() {
  const el = document.getElementById('networkAlertModal');
  if (el) el.style.display = 'none';
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (err) {
    console.log('Wake Lock:', err.message);
  }
}

function releaseWakeLock() {
  if (wakeLock !== null) {
    wakeLock.release().then(() => {
      wakeLock = null;
    });
  }
}

document.addEventListener('visibilitychange', async () => {
  if (wakeLock !== null && document.visibilityState === 'visible' && isOnline) {
    await requestWakeLock();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  if (currentDriverId) {
    const appScreen = document.getElementById('appScreen');
    if (appScreen) appScreen.style.display = 'block';
    loadDriverProfile();
    initDriverMap();
  } else {
    const loginScreen = document.getElementById('loginScreen');
    if (loginScreen) loginScreen.style.display = 'block';
    initSavedPhone();
  }
});

async function login() {
  const phone = document.getElementById('phoneInput').value.trim();
  const pin = document.getElementById('pinInput').value.trim();

  if (!phone || !pin) {
    return alert("Vui lòng nhập đủ SĐT và Mã PIN!");
  }

  const btn = document.querySelector('#loginScreen button');
  const now = Date.now();

  const lockedUntil = parseInt(localStorage.getItem(`locked_${phone}`) || '0', 10);
  if (lockedUntil > now) {
    const remainingMinutes = Math.ceil((lockedUntil - now) / 60000);
    return alert(`❌ Thiết bị này đã bị tạm khóa đăng nhập cho SĐT ${phone}!\nVui lòng thử lại sau ${remainingMinutes} phút hoặc liên hệ Admin.`);
  }

  if (btn) btn.innerText = "Đang kiểm tra...";

  const { data: result, error } = await supabaseClient.rpc('check_driver_login', {
    p_phone: phone,
    p_pin: pin
  });

  if (error || !result || result.length === 0) {
    let failCount = parseInt(localStorage.getItem(`fail_${phone}`) || '0', 10) + 1;
    localStorage.setItem(`fail_${phone}`, failCount.toString());

    if (failCount >= 3) {
      const lockTime = now + LOCK_TIME_MS;
      localStorage.setItem(`locked_${phone}`, lockTime.toString());
      alert("❌ Bạn đã nhập sai PIN 3 lần!\nThiết bị này bị tạm khóa đăng nhập trong 60 phút.");
    } else {
      alert(`❌ Sai SĐT hoặc Mã PIN!\nCảnh báo: Còn ${3 - failCount} lần thử.`);
    }
    if (btn) btn.innerText = "ĐĂNG NHẬP";
    return;
  }

  localStorage.removeItem(`fail_${phone}`);
  localStorage.removeItem(`locked_${phone}`);

  const driverInfo = result[0];

  if (driverInfo.locked_until && parseInt(driverInfo.locked_until) > now) {
    const lockedMinutes = Math.ceil((parseInt(driverInfo.locked_until) - now) / 60000);
    if (btn) btn.innerText = "ĐĂNG NHẬP";
    return alert(`⛔ Tài khoản đang bị KHÓA TẠM THỜI (còn ${lockedMinutes} phút)!`);
  }

  if (driverInfo.is_active === false) {
    alert("⛔ Tài khoản của bạn đã bị cho nghỉ. Vui lòng liên hệ Admin!");
    if (btn) btn.innerText = "ĐĂNG NHẬP";
    return;
  }

  const newToken = Date.now().toString() + '_' + Math.random().toString(36).substring(2, 9);
  await supabaseClient.from('drivers').update({ session_token: newToken }).eq('id', driverInfo.id);

  localStorage.setItem('avyo_driver_id', driverInfo.id);
  localStorage.setItem('avyo_driver_name', driverInfo.name);
  localStorage.setItem('avyo_session_token', newToken);
  localStorage.setItem('avyo_last_phone', phone);

  window.location.reload();
}

function initDriverMap() {
  if (driverMap) return;
  const mapEl = document.getElementById('driverMap');
  if (!mapEl) return;
  driverMap = L.map('driverMap', { preferCanvas: true, attributionControl: false }).setView([18.7034, 105.6832], 14);

  const googleLayer = L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    subdomains: ['0', '1', '2', '3'],
    maxZoom: 20,
    attribution: '&copy; Google Maps'
  });

  googleLayer.on('tileerror', function() {
    if (driverMap.hasLayer(googleLayer)) {
      driverMap.removeLayer(googleLayer);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri'
      }).addTo(driverMap);
    }
  });

  googleLayer.addTo(driverMap);

  setTimeout(() => { if (driverMap) driverMap.invalidateSize(); }, 300);
}

async function loadDriverProfile() {
  if (!currentDriverId) return;
  const { data } = await supabaseClient.from('drivers').select('*').eq('id', currentDriverId).single();
  if (data) {
    if (data.session_token && data.session_token !== currentSessionToken) {
      alert("⚠️ Tài khoản của bạn vừa được đăng nhập trên một thiết bị khác!\nThiết bị này sẽ bị đăng xuất tự động.");
      logout(true); return;
    }

    if (data.is_active === false) {
      alert("⛔ Tài khoản của bạn đã tạm ngưng hoạt động (Đã nghỉ). Vui lòng liên hệ Admin!");
      logout(true); return;
    }

    driverData = data; 

    const nameLabel = document.getElementById('driverNameLabel');
    if (nameLabel) nameLabel.innerText = data.name || '--';

    const avatarImg = document.getElementById('driverAvatar');
    if (avatarImg) avatarImg.src = typeof getOptimizedAvatar === 'function' ? getOptimizedAvatar(data.avatar_url) : (data.avatar_url || 'https://cdn-icons-png.flaticon.com/512/149/149071.png');

    const cccdLabel = document.getElementById('cccdLabel');
    if (cccdLabel) cccdLabel.innerText = "CCCD: " + (data.cccd || '---');

    const addressLabel = document.getElementById('addressLabel');
    if (addressLabel) addressLabel.innerText = "📍 " + (data.address || 'Chưa cập nhật địa chỉ');

    const joinDateLabel = document.getElementById('joinDateLabel');
    if (joinDateLabel && data.created_at) {
      joinDateLabel.innerText = "📅 Tham gia: " + new Date(data.created_at).toLocaleDateString('vi-VN');
    }

    const vehicleTypeLabel = document.getElementById('vehicleTypeLabel');
    if (vehicleTypeLabel) vehicleTypeLabel.innerText = typeLabels[data.vehicle_type] || 'Phương tiện';

    const vehicleDetailLabel = document.getElementById('vehicleDetailLabel');
    if (vehicleDetailLabel) vehicleDetailLabel.innerText = data.vehicle || 'Chưa cập nhật chi tiết xe';

    const phoneLabel = document.getElementById('phoneLabel');
    if (phoneLabel) phoneLabel.innerText = data.phone || '--';

    const clickLabel = document.getElementById('clickCountLabel');
    if (clickLabel) clickLabel.innerText = data.click_count || 0;

    const zaloLabel = document.getElementById('zaloCountLabel');
    if (zaloLabel) zaloLabel.innerText = data.zalo_count || 0;

    const callLabel = document.getElementById('callCountLabel');
    if (callLabel) callLabel.innerText = data.call_count || 0;
    
    const sum = data.rating_sum || 25;
    const count = data.rating_count || 5;
    const ratingLabel = document.getElementById('ratingLabel');
    if (ratingLabel) ratingLabel.innerText = `${(sum / count).toFixed(1)} (${count})`;

    const todayStr = typeof getLocalDateStr === 'function' ? getLocalDateStr() : new Date().toISOString().split('T')[0];
    const monthStr = typeof getLocalMonthStr === 'function' ? getLocalMonthStr() : new Date().toISOString().slice(0, 7);
    let displayMinsToday = data.online_minutes_today || 0;
    let displayMinsMonth = data.online_minutes_month || 0;
    
    if (data.last_online_date !== todayStr) displayMinsToday = 0;
    if (data.last_online_month !== monthStr) displayMinsMonth = 0;

    const timeTodayLabel = document.getElementById('timeTodayLabel');
    if (timeTodayLabel) timeTodayLabel.innerText = typeof formatTime === 'function' ? formatTime(displayMinsToday) : displayMinsToday + 'p';

    const timeMonthLabel = document.getElementById('timeMonthLabel');
    if (timeMonthLabel) timeMonthLabel.innerText = typeof formatTime === 'function' ? formatTime(displayMinsMonth) : displayMinsMonth + 'p';

    if (data.lat && data.lng) {
      updateMapMarker(data.lat, data.lng);
    }
  }
}

function updateMapMarker(lat, lng) {
  if (!driverMap) initDriverMap();
  if (!driverMap) return;
  const latLng = [lat, lng];
  
  const ringHtml = isOnline ? '<div class="radar-ring"></div>' : '';

  const radarIcon = L.divIcon({
    className: 'custom-radar-icon',
    html: `<div class="radar-container">
             ${ringHtml}
             <div class="radar-center"></div>
           </div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });

  if (!driverMarker) {
    driverMarker = L.marker(latLng, { icon: radarIcon }).addTo(driverMap).bindPopup("📍 <b>Vị trí của bạn</b>");
  } else {
    driverMarker.setLatLng(latLng);
    driverMarker.setIcon(radarIcon);
  }
  driverMap.setView(latLng, 16);
}

function logout(force = false) {
  if (force) {
    executeLogout();
  } else {
    const modal = document.getElementById('logoutModal');
    if (modal) modal.style.display = 'flex';
  }
}

function closeLogoutModal() {
  const modal = document.getElementById('logoutModal');
  if (modal) modal.style.display = 'none';
}

function confirmLogout() {
  closeLogoutModal();
  executeLogout();
}

function executeLogout() {
  if (isOnline) toggleOnline();
  releaseWakeLock();
  hideNetworkAlert();
  localStorage.removeItem('avyo_driver_id');
  localStorage.removeItem('avyo_driver_name');
  localStorage.removeItem('avyo_session_token');
  window.location.reload();
}

async function updateLocation(lat, lng) {
  if (!currentDriverId || !isOnline || !navigator.onLine) return;
  await supabaseClient.rpc('update_driver_location', {
    p_driver_id: currentDriverId,
    p_lat: lat,
    p_lng: lng
  });
}

async function toggleOnline() {
  if (!currentDriverId) return alert('Lỗi tài khoản, vui lòng đăng xuất và đăng nhập lại!');

  const btn = document.getElementById('toggleBtn');
  const status = document.getElementById('status');

  if (!isOnline) {
    if (!navigator.onLine) {
      showNetworkAlert();
      return alert('Mất kết nối 4G/5G/WIFI! Vui lòng kết nối lại Internet');
    }

    if (!navigator.geolocation) return alert('Thiết bị không hỗ trợ GPS');
    
    isOnline = true;
    hideNetworkAlert();
    await requestWakeLock();

    if (driverMarker) {
      const currentPos = driverMarker.getLatLng();
      updateMapMarker(currentPos.lat, currentPos.lng);
    }

    lastSentLat = 0;
    lastSentLng = 0;
    await supabaseClient.from('drivers').update({
      is_online: true,
      updated_at: new Date().toISOString()
    }).eq('id', currentDriverId);

    if (btn) {
      btn.innerText = 'TẮT NHẬN KHÁCH (NGHỈ NGƠI)';
      btn.style.background = '#ef4444';
    }
    
    if (status) {
      status.innerHTML = '<span class="live-dot"></span> ĐANG PHÁT GPS ĐỂ ĐÓN KHÁCH';
      status.style.color = '#10b981';
    }

    setTimeout(() => { if (driverMap) driverMap.invalidateSize(); }, 200);

    const todayStr = typeof getLocalDateStr === 'function' ? getLocalDateStr() : new Date().toISOString().split('T')[0];
    const monthStr = typeof getLocalMonthStr === 'function' ? getLocalMonthStr() : new Date().toISOString().slice(0, 7);

    if (!driverData) driverData = {};
    if (driverData.last_online_date !== todayStr) driverData.online_minutes_today = 0;
    if (driverData.last_online_month !== monthStr) driverData.online_minutes_month = 0;

    const timeTodayLabel = document.getElementById('timeTodayLabel');
    if (timeTodayLabel) timeTodayLabel.innerText = typeof formatTime === 'function' ? formatTime(driverData.online_minutes_today || 0) : (driverData.online_minutes_today || 0) + 'p';

    const timeMonthLabel = document.getElementById('timeMonthLabel');
    if (timeMonthLabel) timeMonthLabel.innerText = typeof formatTime === 'function' ? formatTime(driverData.online_minutes_month || 0) : (driverData.online_minutes_month || 0) + 'p';

    let heartbeatTicks = 0;
    timeInterval = setInterval(async () => {
      if (!isOnline || !navigator.onLine) return;
      
      heartbeatTicks++;
      let updateObj = { updated_at: new Date().toISOString() };

      if (heartbeatTicks % 2 === 0) {
        if (!driverData) driverData = {};
        driverData.online_minutes_today = (driverData.online_minutes_today || 0) + 1;
        driverData.online_minutes_month = (driverData.online_minutes_month || 0) + 1;

        if (timeTodayLabel) timeTodayLabel.innerText = typeof formatTime === 'function' ? formatTime(driverData.online_minutes_today) : driverData.online_minutes_today + 'p';
        if (timeMonthLabel) timeMonthLabel.innerText = typeof formatTime === 'function' ? formatTime(driverData.online_minutes_month) : driverData.online_minutes_month + 'p';

        updateObj.online_minutes_today = driverData.online_minutes_today;
        updateObj.online_minutes_month = driverData.online_minutes_month;
        updateObj.last_online_date = todayStr;
        updateObj.last_online_month = monthStr;
      }

      await supabaseClient.from('drivers').update(updateObj).eq('id', currentDriverId);
    }, 30000);

    let lastUpdateTime = 0;
    watchId = navigator.geolocation.watchPosition(async (pos) => {
      if (!isOnline) return;
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const coordsEl = document.getElementById('coords');
      if (coordsEl) coordsEl.innerText = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      updateMapMarker(lat, lng);

      const now = Date.now();
      const movedKm = typeof getHaversineDistance === 'function' ? getHaversineDistance(lat, lng, lastSentLat, lastSentLng) : 0;

      // Tối ưu pin: Chỉ gửi vị trí mới khi di chuyển >= 0.03 km (30m) VÀ cách nhau tối thiểu 5s, hoặc lần gửi đầu tiên
      if ((now - lastUpdateTime >= 5000 && movedKm >= 0.03) || lastSentLat === 0) {
        await updateLocation(lat, lng);
        lastUpdateTime = now;
        lastSentLat = lat;
        lastSentLng = lng;
      }
    }, (err) => {
      alert('Lỗi GPS: ' + err.message);
    }, { 
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 10000
    });

  } else {
    isOnline = false;
    releaseWakeLock();
    hideNetworkAlert();

    if (driverMarker) {
      const currentPos = driverMarker.getLatLng();
      updateMapMarker(currentPos.lat, currentPos.lng);
    }

    if (watchId) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (timeInterval) {
      clearInterval(timeInterval);
      timeInterval = null;
    }

    if (navigator.onLine) {
      await supabaseClient.from('drivers').update({
        is_online: false,
        updated_at: new Date().toISOString()
      }).eq('id', currentDriverId);
    }
    
    if (status) {
      status.innerHTML = '🔴 ĐÃ TẮT ĐỊNH VỊ (Nghỉ ngơi)';
      status.style.color = '#f87171';
    }
    if (btn) {
      btn.innerText = 'BẮT ĐẦU NHẬN KHÁCH (BẬT GPS)';
      btn.style.background = 'linear-gradient(135deg, #10b981, #047857)';
    }
  }
}

window.addEventListener('online', async () => {
  hideNetworkAlert();
  const status = document.getElementById('status');
  if (isOnline) {
    if (status) {
      status.innerHTML = '<span class="live-dot"></span> ĐÃ KHÔI PHỤC INTERNET - ĐANG PHÁT GPS';
      status.style.color = '#10b981';
    }

    lastSentLat = 0;
    lastSentLng = 0;
    if (currentDriverId) {
      await supabaseClient.from('drivers').update({
        is_online: true,
        updated_at: new Date().toISOString()
      }).eq('id', currentDriverId);
    }
  }
});

window.addEventListener('offline', () => {
  if (isOnline) {
    showNetworkAlert();
    const status = document.getElementById('status');
    if (status) {
      status.innerHTML = '⚠️ Mất kết nối 4G/5G/WIFI! Vui lòng kết nối lại Internet';
      status.style.color = '#dc2626';
    }
  }
});

if (currentDriverId) {
  supabaseClient.channel('driver-self-update')
    .on('postgres_changes', { 
      event: 'UPDATE', 
      schema: 'public', 
      table: 'drivers', 
      filter: `id=eq.${currentDriverId}` 
    }, (payload) => {
      if (payload.new) {
        if (payload.new.session_token && payload.new.session_token !== currentSessionToken) {
          alert("⚠️ Tài khoản của bạn vừa được đăng nhập ở một thiết bị khác!\nỨng dụng sẽ đăng xuất thiết bị này.");
          logout(true); 
          return;
        }
        if (payload.new.is_active === false) {
          alert("⛔ Tài khoản của bạn đã chuyển sang trạng thái Đã nghỉ!");
          logout(true); 
          return;
        }
        
        const clickEl = document.getElementById('clickCountLabel');
        if (clickEl && payload.new.click_count !== undefined) {
          clickEl.innerText = payload.new.click_count;
        }
        const zaloEl = document.getElementById('zaloCountLabel');
        if (zaloEl && payload.new.zalo_count !== undefined) {
          zaloEl.innerText = payload.new.zalo_count;
        }
        const callEl = document.getElementById('callCountLabel');
        if (callEl && payload.new.call_count !== undefined) {
          callEl.innerText = payload.new.call_count;
        }
        const ratingEl = document.getElementById('ratingLabel');
        if (ratingEl && payload.new.rating_sum !== undefined && payload.new.rating_count !== undefined) {
          const sum = payload.new.rating_sum || 25;
          const count = payload.new.rating_count || 5;
          ratingEl.innerText = `${(sum / count).toFixed(1)} (${count})`;
        }
      }
    })
    .subscribe();
}

window.addEventListener('beforeunload', () => {
  if (isOnline && currentDriverId && navigator.onLine) {
    fetch(`${SUPABASE_URL}/rest/v1/drivers?id=eq.${currentDriverId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({ is_online: false, updated_at: new Date().toISOString() }),
      keepalive: true
    });
  }
});

document.addEventListener('gesturestart', function (e) {
  e.preventDefault();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

if (window.Capacitor && window.Capacitor.isNativePlatform()) {
  const CapacitorUpdater = window.Capacitor.Plugins?.CapacitorUpdater;
  if (CapacitorUpdater) {
    CapacitorUpdater.notifyAppReady();
  }
}