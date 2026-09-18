// utils.js - Các hàm phụ trợ dùng chung cho toàn bộ dự án Avyo

function getHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getOptimizedAvatar(url) {
  const defaultAvatar = 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
  if (!url || typeof url !== 'string') return defaultAvatar;
  
  const cleanUrl = url.trim();
  // Bắt buộc URL phải bắt đầu bằng http://, https://, data:image hoặc blob: để tránh lỗi 404
  if (
    cleanUrl.startsWith('http://') || 
    cleanUrl.startsWith('https://') || 
    cleanUrl.startsWith('data:image') || 
    cleanUrl.startsWith('blob:')
  ) {
    return cleanUrl;
  }
  
  return defaultAvatar;
}

function formatTime(minutes) {
  if (!minutes) return '0p';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}p` : `${m}p`;
}

function getLocalDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getLocalMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Hàm mã hóa ký tự đặc biệt phòng chống lỗ hổng XSS
function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}