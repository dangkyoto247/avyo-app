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

function showNetworkAlert() {
  document.getElementById('networkAlertModal').style.display = 'block';
}

function hideNetworkAlert() {
  document.getElementById('networkAlertModal').style.display = 'none';
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

if (currentDriverId) {
  document.getElementById('appScreen').style.display = 'block';
  loadDriverProfile();
  initDriverMap();
} else {
  document.getElementById('loginScreen').style.display = 'block';
}

async function login() {
  const phone = document.getElementById('phoneInput').value.trim();
  const pin = document.getElementById('pinInput').value.trim();

  if (!phone || !pin) {
    return alert("Vui lòng nhập đủ SĐT và Mã PIN!");
  }

  const btn = document.querySelector('#loginScreen button');
  const now = Date.now();

  // 1. CHẶN THIẾT BỊ NGAY NẾU ĐANG TRONG THỜI GIAN KHÓA (CHỐNG NHẬP ĐÚNG Ở LẦN THỨ 4)
  const lockedUntil = parseInt(localStorage.getItem(`locked_${phone}`) || '0', 10);
  if (lockedUntil > now) {
    const remainingMinutes = Math.ceil((lockedUntil - now) / 60000);
    return alert(`❌ Thiết bị này đã bị tạm khóa đăng nhập cho SĐT ${phone}!\nVui lòng thử lại sau ${remainingMinutes} phút hoặc liên hệ Admin.`);
  }

  btn.innerText = "Đang kiểm tra...";

  // 2. GỬI YÊU CẦU KIỂM TRA LÊN SUPABASE
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
    btn.innerText = "ĐĂNG NHẬP";
    return;
  }

  // 3. ĐĂNG NHẬP THÀNH CÔNG -> RESET LỊCH SỬ SAI TRÊN THIẾT BỊ
  localStorage.removeItem(`fail_${phone}`);
  localStorage.removeItem(`locked_${phone}`);

  const driverInfo = result[0];

  if (driverInfo.locked_until && parseInt(driverInfo.locked_until) > now) {
    const lockedMinutes = Math.ceil((parseInt(driverInfo.locked_until) - now) / 60000);
    btn.innerText = "ĐĂNG NHẬP";
    return alert(`⛔ Tài khoản đang bị KHÓA TẠM THỜI (còn ${lockedMinutes} phút)!`);
  }

  if (driverInfo.is_active === false) {
    alert("⛔ Tài khoản của bạn đã bị cho nghỉ. Vui lòng liên hệ Admin!");
    btn.innerText = "ĐĂNG NHẬP";
    return;
  }

  const newToken = Date.now().toString() + '_' + Math.random().toString(36).substring(2, 9);
  await supabaseClient.from('drivers').update({ session_token: newToken }).eq('id', driverInfo.id);

  localStorage.setItem('avyo_driver_id', driverInfo.id);
  localStorage.setItem('avyo_driver_name', driverInfo.name);
  localStorage.setItem('avyo_session_token', newToken);

  alert("✅ Đăng nhập thành công!");
  window.location.reload();
}

function initDriverMap() {
  if (driverMap) return;
  // Đã thêm attributionControl: false vào object tùy chọn
  driverMap = L.map('driverMap', { preferCanvas: true, attributionControl: false }).setView([18.7034, 105.6832], 14);

  // Đã xóa dòng attribution ở tileLayer
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    subdomains: 'abcd'
  }).addTo(driverMap);

  setTimeout(() => { if (driverMap) driverMap.invalidateSize(); }, 300);
}

async function loadDriverProfile() {
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

    document.getElementById('driverNameLabel').innerText = data.name;
    document.getElementById('driverAvatar').src = getOptimizedAvatar(data.avatar_url);
    document.getElementById('cccdLabel').innerText = "CCCD: " + (data.cccd || '---');
    document.getElementById('addressLabel').innerText = "📍 " + (data.address || 'Chưa cập nhật địa chỉ');
    if (data.created_at) {
      document.getElementById('joinDateLabel').innerText = "📅 Tham gia: " + new Date(data.created_at).toLocaleDateString('vi-VN');
    }
    document.getElementById('vehicleTypeLabel').innerText = typeLabels[data.vehicle_type] || 'Phương tiện';
    document.getElementById('vehicleDetailLabel').innerText = data.vehicle || 'Chưa cập nhật chi tiết xe';
    document.getElementById('phoneLabel').innerText = data.phone;

    document.getElementById('clickCountLabel').innerText = data.click_count || 0;
    document.getElementById('zaloCountLabel').innerText = data.zalo_count || 0;
    document.getElementById('callCountLabel').innerText = data.call_count || 0;
    
    const sum = data.rating_sum || 25;
    const count = data.rating_count || 5;
    document.getElementById('ratingLabel').innerText = `${(sum / count).toFixed(1)} (${count})`;

    const todayStr = getLocalDateStr();
    const monthStr = getLocalMonthStr();
    let displayMinsToday = data.online_minutes_today || 0;
    let displayMinsMonth = data.online_minutes_month || 0;
    
    if (data.last_online_date !== todayStr) displayMinsToday = 0;
    if (data.last_online_month !== monthStr) displayMinsMonth = 0;

    document.getElementById('timeTodayLabel').innerText = formatTime(displayMinsToday);
    document.getElementById('timeMonthLabel').innerText = formatTime(displayMinsMonth);

    if (data.lat && data.lng) {
      updateMapMarker(data.lat, data.lng);
    }
  }
}

function updateMapMarker(lat, lng) {
  if (!driverMap) initDriverMap();
  const latLng = [lat, lng];
  if (!driverMarker) {
    driverMarker = L.marker(latLng).addTo(driverMap).bindPopup("📍 <b>Vị trí của bạn</b>").openPopup();
  } else {
    driverMarker.setLatLng(latLng);
  }
  driverMap.setView(latLng, 16);
}

function logout(force = false) {
  if (force || confirm("Bạn có chắc chắn muốn đăng xuất không?")) {
    if (isOnline) toggleOnline();
    releaseWakeLock();
    hideNetworkAlert();
    localStorage.removeItem('avyo_driver_id');
    localStorage.removeItem('avyo_driver_name');
    localStorage.removeItem('avyo_session_token');
    window.location.reload();
  }
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

    lastSentLat = 0;
    lastSentLng = 0;
    await supabaseClient.from('drivers').update({
      is_online: true,
      updated_at: new Date().toISOString()
    }).eq('id', currentDriverId);

    btn.innerText = 'TẮT NHẬN KHÁCH (NGHỈ NGƠI)';
    btn.style.background = '#ef4444';
    status.innerHTML = '🟢 ĐANG PHÁT GPS ĐỂ ĐÓN KHÁCH';
    status.style.color = '#16a34a';

    setTimeout(() => { if (driverMap) driverMap.invalidateSize(); }, 200);

    const todayStr = getLocalDateStr();
    const monthStr = getLocalMonthStr();

    if (driverData.last_online_date !== todayStr) driverData.online_minutes_today = 0;
    if (driverData.last_online_month !== monthStr) driverData.online_minutes_month = 0;

    document.getElementById('timeTodayLabel').innerText = formatTime(driverData.online_minutes_today);
    document.getElementById('timeMonthLabel').innerText = formatTime(driverData.online_minutes_month);

    let heartbeatTicks = 0;
    timeInterval = setInterval(async () => {
      if (!isOnline || !navigator.onLine) return;
      
      heartbeatTicks++;
      let updateObj = { updated_at: new Date().toISOString() };

      if (heartbeatTicks % 2 === 0) {
        driverData.online_minutes_today = (driverData.online_minutes_today || 0) + 1;
        driverData.online_minutes_month = (driverData.online_minutes_month || 0) + 1;

        document.getElementById('timeTodayLabel').innerText = formatTime(driverData.online_minutes_today);
        document.getElementById('timeMonthLabel').innerText = formatTime(driverData.online_minutes_month);

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
      document.getElementById('coords').innerText = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      updateMapMarker(lat, lng);

      const now = Date.now();
      const movedKm = getHaversineDistance(lat, lng, lastSentLat, lastSentLng);

      if ((now - lastUpdateTime >= 3000 && movedKm > 0.01) || lastSentLat === 0) {
        await updateLocation(lat, lng);
        lastUpdateTime = now;
        lastSentLat = lat;
        lastSentLng = lng;
      }
    }, (err) => {
      alert('Lỗi GPS: ' + err.message);
    }, { enableHighAccuracy: true });

  } else {
    isOnline = false;
    releaseWakeLock();
    hideNetworkAlert();

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
    
    status.innerHTML = '🔴 ĐÃ TẮT ĐỊNH VỊ (Nghỉ ngơi)';
    status.style.color = '#ef4444';
    btn.innerText = 'BẮT ĐẦU NHẬN KHÁCH (BẬT GPS)';
    btn.style.background = '#22c55e';
  }
}

window.addEventListener('online', async () => {
  hideNetworkAlert();
  const status = document.getElementById('status');
  if (isOnline) {
    status.innerHTML = '🟢 ĐÃ KHÔI PHỤC INTERNET - ĐANG PHÁT GPS';
    status.style.color = '#16a34a';

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
    status.innerHTML = '⚠️ Mất kết nối 4G/5G/WIFI! Vui lòng kết nối lại Internet';
    status.style.color = '#dc2626';
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
        
        if (payload.new.click_count !== undefined) {
          document.getElementById('clickCountLabel').innerText = payload.new.click_count;
        }
        if (payload.new.zalo_count !== undefined) {
          document.getElementById('zaloCountLabel').innerText = payload.new.zalo_count;
        }
        if (payload.new.call_count !== undefined) {
          document.getElementById('callCountLabel').innerText = payload.new.call_count;
        }
        if (payload.new.rating_sum !== undefined && payload.new.rating_count !== undefined) {
          const sum = payload.new.rating_sum || 25;
          const count = payload.new.rating_count || 5;
          document.getElementById('ratingLabel').innerText = `${(sum / count).toFixed(1)} (${count})`;
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