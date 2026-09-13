const SUPABASE_URL = 'https://yvucyqkglbgxvozrznir.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2dWN5cWtnbGJneHZvenJ6bmlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMzA3ODAsImV4cCI6MjEwNDcwNjc4MH0.Zagl4i2LPmxW3w9ih0h4LRsrm-OOGtPcWgvEs2vHBqo';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentPage = 1;
const ITEMS_PER_PAGE = 50;

async function checkDeviceLockState(email) {
  if (!email) return false;

  const { data, error } = await supabaseClient.rpc('check_admin_lock', { p_email: email });
  if (error || !data || data.length === 0) return false;

  const result = data[0];
  const loginBtn = document.getElementById('loginBtn');

  if (result.is_locked) {
    loginBtn.disabled = true;
    loginBtn.style.background = '#94a3b8';
    loginBtn.innerText = `⛔ TÀI KHOẢN BỊ KHÓA (${result.remaining_minutes}p)`;
    alert(`⛔ Tài khoản [${email}] đang bị KHÓA đăng nhập trong ${result.remaining_minutes} phút do nhập sai 3 lần!`);
    return true;
  } else {
    loginBtn.disabled = false;
    loginBtn.style.background = '#16a34a';
    loginBtn.innerText = 'VÀO TRANG QUẢN TRỊ';
    return false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    document.getElementById('login-modal').style.display = 'none';
    initMap();
    loadAllData();
    resetInactivityTimer();
  }
});

/* --- CHỨC NĂNG CHỂ ĐỘ SÁNG - TỐI --- */
function initTheme() {
  const savedTheme = localStorage.getItem('adminTheme');
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-mode');
    updateThemeBtn(true);
  } else {
    document.body.classList.remove('dark-mode');
    updateThemeBtn(false);
  }
}

function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark-mode');
  localStorage.setItem('adminTheme', isDark ? 'dark' : 'light');
  updateThemeBtn(isDark);
}

function updateThemeBtn(isDark) {
  const btn = document.getElementById('themeToggleBtn');
  if (!btn) return;
  if (isDark) {
    btn.innerHTML = '☀️ Sáng';
    btn.style.background = '#e2e8f0';
    btn.style.color = '#0f172a';
  } else {
    btn.innerHTML = '🌙 Tối';
    btn.style.background = '#334155';
    btn.style.color = '#f8fafc';
  }
}

async function checkPass() {
  const email = document.getElementById('emailInput').value.trim();
  const password = document.getElementById('passInput').value;
  const loginBtn = document.getElementById('loginBtn');

  if (!email || !password) {
    alert("⚠️ Vui lòng nhập đầy đủ Email và Mật khẩu!");
    return;
  }

  const isLocked = await checkDeviceLockState(email);
  if (isLocked) return;

  loginBtn.innerText = "Đang kiểm tra...";

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: email,
    password: password
  });

  if (error) {
    const { data: failData } = await supabaseClient.rpc('record_admin_login_failure', { p_email: email });
    
    if (failData && failData.length > 0) {
      const res = failData[0];
      if (res.is_locked) {
        await checkDeviceLockState(email);
      } else {
        alert(`❌ Đăng nhập thất bại!\nSai Email hoặc Mật khẩu.\n\n⚠️ Cảnh báo: Còn ${res.remaining_fails} lần thử trước khi khóa tài khoản trong 1 giờ.`);
        loginBtn.innerText = "VÀO TRANG QUẢN TRỊ";
      }
    }
  } else {
    await supabaseClient.rpc('reset_admin_login_attempts', { p_email: email });
    
    document.getElementById('login-modal').style.display = 'none';
    initMap();
    loadAllData();
    loginBtn.innerText = "VÀO TRANG QUẢN TRỊ";
    resetInactivityTimer();
  }
}

async function logout() {
  await supabaseClient.auth.signOut();
  document.getElementById('login-modal').style.display = 'flex';
  document.getElementById('passInput').value = '';
  clearTimeout(inactivityTimer);
}

const INACTIVITY_LIMIT = 15 * 60 * 1000;
let inactivityTimer;

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  if (document.getElementById('login-modal').style.display === 'none') {
    inactivityTimer = setTimeout(() => {
      alert("⏱️ Bạn đã không thao tác trong 15 phút. Hệ thống tự động đăng xuất để bảo mật!");
      logout();
    }, INACTIVITY_LIMIT);
  }
}

['mousemove', 'keydown', 'touchstart', 'scroll', 'click'].forEach(eventType => {
  document.addEventListener(eventType, resetInactivityTimer, true);
});

let map = null;
let adminMarkers = {};
let rawAdminDriversData = [];
const activeAdminFilters = new Set(['bike', 'car', 'driver', 'truck']);

const icons = {
  'bike': L.divIcon({ html: '<div class="vehicle-icon">🛵</div>', className: 'custom-icon', iconSize: [26, 26] }),
  'car': L.divIcon({ html: '<div class="vehicle-icon">🚕</div>', className: 'custom-icon', iconSize: [26, 26] }),
  'driver': L.divIcon({ html: '<div class="vehicle-icon">👤</div>', className: 'custom-icon', iconSize: [26, 26] }),
  'truck': L.divIcon({ html: '<div class="vehicle-icon">🚚</div>', className: 'custom-icon', iconSize: [26, 26] })
};
const typeLabels = { 'bike': '🛵 Xe máy', 'car': '🚕 Ô tô', 'driver': '👤 Lái xe hộ', 'truck': '🚚 Chở hàng' };

function initMap() {
  if (map) return;
  map = L.map('map', { preferCanvas: true, attributionControl: false }).setView([18.7034, 105.6832], 12);
 
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    subdomains: 'abcd'
  }).addTo(map);

  setTimeout(() => { if (map) map.invalidateSize(); }, 300);
}

function toggleAdminFilter(type, element) {
  currentPage = 1;
  const allBtn = document.getElementById('chip-all');
 
  if (type === 'all') {
    activeAdminFilters.clear();
    ['bike', 'car', 'driver', 'truck'].forEach(t => activeAdminFilters.add(t));
    document.querySelectorAll('.filter-chip').forEach(chip => chip.classList.add('active'));
  } else {
    if (activeAdminFilters.has(type)) {
      if (activeAdminFilters.size === 1) return alert("Phải chọn ít nhất 1 loại xe!");
      activeAdminFilters.delete(type);
      element.classList.remove('active');
    } else {
      activeAdminFilters.add(type);
      element.classList.add('active');
    }

    if (activeAdminFilters.size === 4) {
      allBtn.classList.add('active');
    } else {
      allBtn.classList.remove('active');
    }
  }
  renderAdminData();
}

function resetSearchFilters() {
  const searchInput = document.getElementById('searchInput');
  const statusFilter = document.getElementById('statusFilter');

  if (searchInput) searchInput.value = '';
  if (statusFilter) statusFilter.value = 'all';

  activeAdminFilters.clear();
  ['bike', 'car', 'driver', 'truck'].forEach(t => activeAdminFilters.add(t));
  document.querySelectorAll('.filter-chip').forEach(chip => chip.classList.add('active'));

  currentPage = 1;
  renderAdminData();
}

async function loadAllData() {
  const { data: drivers, error } = await supabaseClient
    .from('drivers')
    .select('*')
    .order('created_at', { ascending: false });
 
  if (error) {
    console.error("Lỗi tải dữ liệu:", error);
    return;
  }

  rawAdminDriversData = drivers || [];
  renderAdminData();
}

function renderAdminData() {
  const tbody = document.getElementById('driverTableBody');
  tbody.innerHTML = '';
 
  Object.keys(adminMarkers).forEach(id => map.removeLayer(adminMarkers[id]));
  adminMarkers = {};

  const searchQuery = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('statusFilter')?.value || 'all';

  let onlineCount = 0;
  let ghostCount = 0;
  let offlineCount = 0;

  rawAdminDriversData.forEach(d => {
    if (!activeAdminFilters.has(d.vehicle_type)) return;
    
    const now = Date.now();
    const isLocked = d.locked_until && parseInt(d.locked_until) > now;
    if (d.is_active === false || isLocked) return;

    let isGhost = false;
    if (d.is_online) {
      if (d.updated_at) {
        const lastUpdateStr = (d.updated_at.includes('Z') || d.updated_at.includes('+')) ? d.updated_at : d.updated_at.replace(' ', 'T') + 'Z';
        isGhost = ((now - new Date(lastUpdateStr).getTime()) / 1000 > 90);
      } else {
        isGhost = true;
      }
    }

    if (d.is_online && !isGhost) onlineCount++;
    else if (d.is_online && isGhost) ghostCount++;
    else offlineCount++;
  });

  document.getElementById('onlineCount').innerText = onlineCount;
  document.getElementById('ghostCount').innerText = ghostCount;
  document.getElementById('offlineCount').innerText = offlineCount;

  const filteredDrivers = rawAdminDriversData.filter(d => {
    if (!activeAdminFilters.has(d.vehicle_type)) return false;

    const now = Date.now();
    const isLocked = d.locked_until && parseInt(d.locked_until) > now;

    let isGhost = false;
    if (d.is_online) {
      if (d.updated_at) {
        const lastUpdateStr = (d.updated_at.includes('Z') || d.updated_at.includes('+')) ? d.updated_at : d.updated_at.replace(' ', 'T') + 'Z';
        isGhost = ((now - new Date(lastUpdateStr).getTime()) / 1000 > 90);
      } else {
        isGhost = true;
      }
    }
    
    const actualOnline = d.is_online && !isGhost;

    if (statusFilter === 'online' && (d.is_active === false || isLocked || !actualOnline)) return false;
    if (statusFilter === 'ghost' && (d.is_active === false || isLocked || !isGhost || !d.is_online)) return false;
    if (statusFilter === 'offline' && (d.is_active === false || isLocked || d.is_online)) return false;
    if (statusFilter === 'retired' && d.is_active !== false && !isLocked) return false;

    if (searchQuery) {
      const nameMatch = (d.name || '').toLowerCase().includes(searchQuery);
      const phoneMatch = (d.phone || '').toLowerCase().includes(searchQuery);
      const cccdMatch = (d.cccd || '').toLowerCase().includes(searchQuery);
      const vehicleMatch = (d.vehicle || '').toLowerCase().includes(searchQuery);
      const addressMatch = (d.address || '').toLowerCase().includes(searchQuery);
      if (!nameMatch && !phoneMatch && !cccdMatch && !vehicleMatch && !addressMatch) {
        return false;
      }
    }

    return true;
  });

  filteredDrivers.forEach(d => {
    const now = Date.now();
    const isLocked = d.locked_until && parseInt(d.locked_until) > now;

    let isGhost = false;
    let diffSeconds = 0;
    if (d.is_online) {
      if (d.updated_at) {
        const lastUpdateStr = (d.updated_at.includes('Z') || d.updated_at.includes('+')) ? d.updated_at : d.updated_at.replace(' ', 'T') + 'Z';
        diffSeconds = (now - new Date(lastUpdateStr).getTime()) / 1000;
        isGhost = (diffSeconds > 90);
      } else {
        isGhost = true;
        diffSeconds = 9999;
      }
    }

    if (!isLocked && d.is_active !== false && d.is_online && d.lat && d.lng) {
      const marker = L.marker([d.lat, d.lng], { 
        icon: icons[d.vehicle_type] || icons['bike'],
        opacity: isGhost ? 0.45 : 1.0
      }).addTo(map);

      let ghostNotice = '';
      if (isGhost) {
        let mins = Math.floor(diffSeconds / 60);
        let timeText = mins > 60 ? Math.floor(mins/60) + 'h' : mins + 'p';
        ghostNotice = `<br><b style="color:#d97706;">⚠️ Mất tín hiệu ${timeText} trước</b>`;
      }

      marker.bindPopup(`<b>${d.name}</b><br>${d.phone}${ghostNotice}`);
      adminMarkers[d.id] = marker;
    }
  });

  if (!filteredDrivers || filteredDrivers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 15px; color: #64748b;">Không có tài xế nào khớp với tìm kiếm / bộ lọc hiện tại.</td></tr>';
    renderPaginationUI(0, 0);
    return;
  }

  const totalDrivers = filteredDrivers.length;
  const totalPages = Math.ceil(totalDrivers / ITEMS_PER_PAGE) || 1;
  
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedDrivers = filteredDrivers.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  paginatedDrivers.forEach((d, index) => {
    const stt = startIndex + index + 1;

    const now = Date.now();
    const isLocked = d.locked_until && parseInt(d.locked_until) > now;

    let isGhost = false;
    let diffSeconds = 0;
    if (d.is_online) {
      if (d.updated_at) {
        const lastUpdateStr = (d.updated_at.includes('Z') || d.updated_at.includes('+')) ? d.updated_at : d.updated_at.replace(' ', 'T') + 'Z';
        diffSeconds = (now - new Date(lastUpdateStr).getTime()) / 1000;
        isGhost = (diffSeconds > 90);
      } else {
        isGhost = true;
        diffSeconds = 9999;
      }
    }
    
    const actualOnline = d.is_online && !isGhost;

    let joinDate = '--';
    if (d.created_at) {
      const dateObj = new Date(d.created_at);
      joinDate = dateObj.toLocaleDateString('vi-VN');
    }

    const avatarUrl = getOptimizedAvatar(d.avatar_url);
   
    const rSum = d.rating_sum || 25;
    const rCount = d.rating_count || 5;
    const rScore = (rSum / rCount).toFixed(1);

    let statusBadge = '';
    if (d.is_active === false) {
      statusBadge = '<span class="badge-retired">🔴 Đã nghỉ</span>';
    } else if (isLocked) {
      statusBadge = '<span class="badge-locked">🔒 BỊ KHÓA TẠM THỜI</span>';
    } else if (actualOnline) {
      statusBadge = '<span class="badge-online">🟢 TỐT (BẬT GPS)</span>';
    } else if (isGhost) {
      let mins = Math.floor(diffSeconds / 60);
      let timeText = mins > 60 ? Math.floor(mins/60) + 'h' : mins + 'p';
      statusBadge = `<span style="background: #fef08a; color: #b45309; border: 1px solid #fde047; padding: 3px 8px; border-radius: 12px; font-weight: bold; font-size: 11px;">🟡 MẤT GPS (${timeText})</span>`;
    } else {
      statusBadge = '<span class="badge-offline">⚪ Đã tắt GPS</span>';
    }

    let displayMinsToday = d.online_minutes_today || 0;
    let displayMinsMonth = d.online_minutes_month || 0;
    if (d.last_online_date !== getLocalDateStr()) displayMinsToday = 0;
    if (d.last_online_month !== getLocalMonthStr()) displayMinsMonth = 0;

    const timeString = `
      <div style="margin-top: 6px; border-top: 1px dashed #cbd5e1; padding-top: 4px;">
        <span class="small-text">⏱️ HN: <b style="color:#d97706;">${formatTime(displayMinsToday)}</b></span>
        <span class="small-text">⏳ TH: <b style="color:#d97706;">${formatTime(displayMinsMonth)}</b></span>
      </div>`;

    const unlockButtonHtml = isLocked 
      ? `<button class="btn-unlock" onclick="unlockDriver('${d.id}', '${d.name}', '${d.pin || '1234'}')">🔓 Mở khóa & PIN</button>` 
      : '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="text-align: center; font-weight: bold;">${stt}</td>
      <td>
        <b>${typeLabels[d.vehicle_type] || d.vehicle_type}</b><br>
        <span class="small-text">${d.vehicle || '--'}</span>
      </td>
      <td>
        <div style="display:flex; align-items:center; gap:8px;">
          <img src="${avatarUrl}" class="admin-avatar" onerror="this.src='https://cdn-icons-png.flaticon.com/512/149/149071.png'">
          <div>
            <b>${d.name}</b>
            <span class="small-text">CCCD: ${d.cccd || '---'}</span>
            <span class="small-text">📍 ${d.address || 'Chưa có địa chỉ'}</span>
            <span class="small-text">📅 Tham gia: ${joinDate}</span>
          </div>
        </div>
      </td>
      <td>
        ⭐ <b style="color:#eab308; font-size:14px;">${rScore}</b> <span class="small-text">(${rCount} lượt)</span><br>
        👁️ <b style="color:#16a34a; font-size:13px;">${d.click_count || 0}</b> xem | 💬 <b style="color:#16a34a; font-size:13px;">${d.zalo_count || 0}</b> Zalo<br>
        📞 <b style="color:#0284c7; font-size:13px;">${d.call_count || 0}</b> cuộc gọi
      </td>
      <td>
        SĐT: <b>${d.phone}</b><br>
        PIN: <b style="color:#eab308;">${d.pin || '1234'}</b>
      </td>
      <td>
        ${statusBadge}
        ${timeString}
      </td>
      <td>
        <button class="btn-edit" onclick="editDriver('${d.id}', '${d.name}', '${d.phone}', '${d.pin || ''}', '${d.avatar_url || ''}', '${d.cccd || ''}', '${d.address || ''}', '${d.vehicle_type}', '${d.vehicle || ''}')">Sửa</button>
        ${unlockButtonHtml}
        ${d.is_active === false
          ? `<button class="btn-toggle-on" onclick="toggleDriverStatus('${d.id}', '${d.name}', false)">Kích hoạt lại</button>`
          : `<button class="btn-toggle-off" onclick="toggleDriverStatus('${d.id}', '${d.name}', true)">Cho nghỉ</button>`
        }
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderPaginationUI(totalPages, totalDrivers);
}

function renderPaginationUI(totalPages, totalDrivers) {
  const container = document.getElementById('paginationControls');
  if (!container) return;

  if (totalDrivers === 0) {
    container.innerHTML = '';
    return;
  }

  let html = `<span class="small-text" style="font-size: 13px; margin-right: 10px;">Tổng: <b>${totalDrivers}</b> tài xế (Trang <b>${currentPage}</b>/<b>${totalPages}</b>)</span>`;
  
  html += `<button class="pagination-btn" onclick="changePage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>◀ Trước</button>`;

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
      html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" onclick="changePage(${i})">${i}</button>`;
    } else if (i === currentPage - 2 || i === currentPage + 2) {
      html += `<span style="color: #94a3b8; padding: 0 2px;">...</span>`;
    }
  }

  html += `<button class="pagination-btn" onclick="changePage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>Sau ▶</button>`;

  container.innerHTML = html;
}

function changePage(newPage) {
  currentPage = newPage;
  renderAdminData();
}

async function saveDriver() {
  const id = document.getElementById('driverId').value;
  const name = document.getElementById('driverName').value.trim();
  const phone = document.getElementById('driverPhone').value.trim();
  const pin = document.getElementById('driverPin').value.trim();
  const avatar_url = document.getElementById('driverAvatarUrl').value.trim();
  const cccd = document.getElementById('driverCccd').value.trim();
  const address = document.getElementById('driverAddress').value.trim();
  const vehicle_type = document.getElementById('vehicleType').value;
  const vehicle = document.getElementById('vehicleDetail').value.trim();

  // 1. Tên tài xế
  const nameRegex = /^[a-zA-Z\sàáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệđìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵÀÁẢÃẠÂẦẤẨẪẬĂẰẮẲẴẶÈÉẺẼẸÊỀẾỂỄỆĐÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴ]+$/;
  if (!name || name.length < 4 || !nameRegex.test(name)) {
    return alert("⚠️ Tên tài xế không hợp lệ!\nVui lòng nhập từ 4 ký tự trở lên và CHỈ ĐƯỢC NHẬP CHỮ.");
  }

  // 2. Số điện thoại
  const phoneRegex = /^0\d{9}$/;
  if (!phoneRegex.test(phone)) {
    return alert("⚠️ Số điện thoại không đúng định dạng!\nVui lòng nhập đúng 10 chữ số (bắt đầu bằng số 0, VD: 0912345678).");
  }

  // 3. Mã PIN
  const pinRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]{6,15}$/;
  if (!pinRegex.test(pin)) {
    return alert("⚠️ Mã PIN không đúng định dạng!\nMã PIN phải từ 6 đến 15 ký tự, KHÔNG DẤU, KHÔNG KHOẢNG CÁCH, gồm chữ, số và ký tự đặc biệt.");
  }

  // 4. Link ảnh
  if (!avatar_url || !avatar_url.match(/^https?:\/\/.+/i)) {
    return alert("⚠️ Vui lòng nhập Link ảnh đại diện hợp lệ!\nĐường dẫn phải bắt đầu bằng http:// hoặc https://");
  }

  // 5. CCCD
  if (!cccd || !/^\d{12}$/.test(cccd)) {
    return alert("⚠️ Số CCCD không hợp lệ!\nVui lòng nhập đúng 12 chữ số.");
  }

  // 6. Biển số xe bọc () và IN HOA
  const vehicleRegex = /\(\d{2}[A-Z][A-Z0-9]?-(?:\d{4}|\d{3}\.\d{2})\)$/;
  if (!vehicle || !vehicleRegex.test(vehicle)) {
    return alert("⚠️ Loại xe & Biển số không đúng định dạng!\nBiển số bọc ngoặc () và IN HOA (VD: Wave (37B1-1234) hoặc Toyota (37K-123.12))");
  }

  const payload = {
    name: name,
    phone: phone,
    pin: pin,
    avatar_url: avatar_url,
    cccd: cccd,
    address: address,
    vehicle_type: vehicle_type,
    vehicle: vehicle,
    is_active: true
  };
  
  let response;
  if (id) {
    response = await supabaseClient.from('drivers').update(payload).eq('id', id);
  } else {
    payload.is_online = false;
    payload.click_count = 0;
    payload.rating_sum = 25;
    payload.rating_count = 5;
    response = await supabaseClient.from('drivers').insert([payload]);
  }

  if (response.error) {
    alert("❌ Lỗi: " + response.error.message);
  } else {
    alert(id ? "✅ Cập nhật thành công!" : "✅ Thêm tài xế mới thành công!");
    resetForm();
    loadAllData();
  }
}

function editDriver(id, name, phone, pin, avatar_url, cccd, address, type, vehicle) {
  document.getElementById('driverId').value = id;
  document.getElementById('driverName').value = name;
  document.getElementById('driverPhone').value = phone;
  document.getElementById('driverPin').value = pin;
  document.getElementById('driverAvatarUrl').value = avatar_url;
  document.getElementById('driverCccd').value = cccd;
  document.getElementById('driverAddress').value = address;
  document.getElementById('vehicleType').value = type;
  document.getElementById('vehicleDetail').value = vehicle;

  const formTitleEl = document.getElementById('formTitle');
  formTitleEl.innerText = "✏️ Cập Nhật Thông Tin Tài Xế";
  document.getElementById('saveBtn').innerText = "LƯU THAY ĐỔI";
  document.getElementById('cancelBtn').style.display = "inline-block";

  formTitleEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetForm() {
  document.getElementById('driverId').value = '';
  document.getElementById('driverName').value = '';
  document.getElementById('driverPhone').value = '';
  document.getElementById('driverPin').value = '';
  document.getElementById('driverAvatarUrl').value = '';
  document.getElementById('driverCccd').value = '';
  document.getElementById('driverAddress').value = '';
  document.getElementById('vehicleDetail').value = '';

  document.getElementById('formTitle').innerText = "➕ Thêm Tài Xế Mới";
  document.getElementById('saveBtn').innerText = "LƯU TÀI XẾ";
  document.getElementById('cancelBtn').style.display = "none";
}

async function unlockDriver(id, name, pin) {
  const confirmUnlock = confirm(`📞 Đã xác minh Video thành công với tài xế: "${name}"?\n\nMật khẩu PIN của tài xế là: [ ${pin} ]\n\nBấm OK để MỞ KHÓA tài khoản ngay lập tức.`);
  
  if (confirmUnlock) {
    const { error } = await supabaseClient
      .from('drivers')
      .update({ locked_until: null, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      alert("❌ Lỗi: " + error.message);
    } else {
      alert(`✅ ĐÃ MỞ KHÓA THÀNH CÔNG!\n\nHãy đọc lại Mã PIN cho tài xế "${name}": ${pin}`);
      loadAllData();
    }
  }
}

async function toggleDriverStatus(id, name, isCurrentlyActive) {
  const actionText = isCurrentlyActive ? "chuyển trạng thái ĐÃ NGHỈ cho" : "KÍCH HOẠT LẠI";
  
  if (confirm(`Bạn có chắc muốn ${actionText} tài xế "${name}"?`)) {
    const payload = isCurrentlyActive 
      ? { is_active: false, is_online: false } 
      : { is_active: true };

    const { error } = await supabaseClient.from('drivers').update(payload).eq('id', id);
    
    if (error) {
      alert("❌ Lỗi: " + error.message);
    } else {
      alert(isCurrentlyActive ? `✅ Đã chuyển tài xế "${name}" sang trạng thái Đã nghỉ.` : `✅ Đã kích hoạt lại tài xế "${name}".`);
      loadAllData();
    }
  }
}

supabaseClient.channel('admin-realtime')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' }, () => loadAllData())
  .subscribe();

setInterval(() => {
  if (typeof renderAdminData === 'function') renderAdminData();
}, 30000);

document.addEventListener('gesturestart', function (e) {
  e.preventDefault();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => {
    console.log("Admin App đã sẵn sàng hoạt động!");
  });
}

function toggleMap() {
  const mapEl = document.getElementById('map');
  const btn = document.getElementById('toggleMapBtn');
  
  if (mapEl.style.display === 'none') {
    mapEl.style.display = 'block';
    btn.innerHTML = 'Ẩn bản đồ 🔼';
    btn.style.background = '#f1f5f9';
    btn.style.color = '#475569';
    
    if (map) {
      setTimeout(() => { map.invalidateSize(); }, 300);
    }
  } else {
    mapEl.style.display = 'none';
    btn.innerHTML = 'Hiện bản đồ 🔽';
    btn.style.background = '#16a34a';
    btn.style.color = 'white';
  }
}