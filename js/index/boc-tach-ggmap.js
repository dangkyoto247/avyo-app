// boc-tach-ggmap.js - Bóc tách và xử lý link chỉ đường Google Maps (Bản chuẩn hóa tối ưu cho iPhone, Android, PC & Zalo)

window.ggmapAbortController = window.ggmapAbortController || null;
window.ggmapInputTimer = window.ggmapInputTimer || null;
window.wasGgmapOpened = window.wasGgmapOpened || false;

/**
 * Lọc trích xuất URL Google Maps chuẩn và TỰ ĐỘNG LỌC THAM SỐ g_st=ic CỦA IPHONE
 */
function extractGoogleMapsUrl(text) {
  if (!text) return '';
  const reg = /(https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl|www\.google\.com\/maps)[^\s]+)/i;
  const match = text.match(reg);
  if (!match) return text.trim();
  
  let url = match[1];
  // Tách bỏ tham số rác g_st=ic do iPhone tạo ra
  url = url.replace(/[\?&]g_st=[^&]+/i, '');
  return url;
}

/**
 * Kiểm tra điểm tọa độ có nằm trong phạm vi lãnh thổ Việt Nam hay không
 */
function isVietnamCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
         lat >= 8.0 && lat <= 24.0 &&
         lng >= 102.0 && lng <= 110.0;
}

/**
 * BỘ QUÉT TỌA ĐỘ ĐA TẦNG: Quét độc lập từng cặp tọa độ Việt Nam trong URL và HTML
 */
function extractVietnamCoordinatesFromText(text) {
  if (!text) return [];
  const coords = [];

  const addPt = (lat, lng) => {
    lat = parseFloat(lat);
    lng = parseFloat(lng);
    if (isVietnamCoordinate(lat, lng)) {
      const isDuplicate = coords.some(pt => {
        if (typeof safeDistance === 'function') {
          return safeDistance(pt.lat, pt.lng, lat, lng) < 0.03; // Dưới 30m xem như trùng
        }
        return Math.abs(pt.lat - lat) < 0.0003 && Math.abs(pt.lng - lng) < 0.0003;
      });
      if (!isDuplicate) coords.push({ lat, lng });
    }
  };

  // 1. Quét độc lập đường dẫn /dir/LAT,LNG/ (Chuyên trị link Ghim trên iOS)
  [...text.matchAll(/\/dir\/(-?\d+\.\d+),(?:%2C|\s*)(-?\d+\.\d+)/gi)].forEach(m => addPt(m[1], m[2]));

  // 2. Quét định dạng @lat,lng
  [...text.matchAll(/@(-?\d+\.\d+),(?:%2C|\s*)(-?\d+\.\d+)/gi)].forEach(m => addPt(m[1], m[2]));

  // 3. Quét Protobuf !1d(lng)!2d(lat) & !2d(lng)!1d(lat)
  [...text.matchAll(/!1d(-?\d+\.\d+)!2d(-?\d+\.\d+)/g)].forEach(m => addPt(m[2], m[1]));
  [...text.matchAll(/!2d(-?\d+\.\d+)!1d(-?\d+\.\d+)/g)].forEach(m => addPt(m[2], m[1]));

  // 4. Quét Protobuf !3d(lat)!4d(lng) & !4d(lng)!3d(lat)
  [...text.matchAll(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g)].forEach(m => addPt(m[1], m[2]));
  [...text.matchAll(/!4d(-?\d+\.\d+)!3d(-?\d+\.\d+)/g)].forEach(m => addPt(m[2], m[1]));

  // 5. Quét tham số Query (origin, destination, saddr, daddr, markers, path, center, ll, q, geocode)
  [...text.matchAll(/(?:origin|destination|saddr|daddr|markers|path|center|ll|q|geocode)=(-?\d+\.\d+)(?:%2C|,)\s*(-?\d+\.\d+)/gi)].forEach(m => {
    addPt(m[1], m[2]);
  });

  // 6. Quét tất cả các cặp Lat,Lng tự do trong HTML
  [...text.matchAll(/(-?\d{1,2}\.\d{4,15})\s*(?:%2C|,)\s*(-?\d{2,3}\.\d{4,15})/g)].forEach(m => {
    addPt(m[1], m[2]);
  });

  return coords;
}

/**
 * Trích xuất tên địa danh và LỌC BỎ TỪ RÁC "Ghim đã thả", "Dropped pin"
 */
function extractPlaceNamesFromText(text) {
  let pickupName = '', destName = '';
  if (!text) return { pickupName, destName };

  const cleanName = (str) => {
    try {
      let decoded = decodeURIComponent(str.replace(/\+/g, ' '));
      if (typeof cleanAddressText === 'function') decoded = cleanAddressText(decoded);
      
      // Bỏ qua nếu là Tọa độ số hoặc Từ rác
      if (/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(decoded)) return '';
      if (/^(ghim đã thả|dropped pin|chỗ ghim|vị trí đã ghim|pinned location|unnamed road)$/i.test(decoded.trim())) return '';
      
      return decoded;
    } catch (e) {
      return '';
    }
  };

  const dirMatch = text.match(/\/dir\/([^\/@?#]+)\/([^\/@?#]+)/i);
  if (dirMatch) {
    pickupName = cleanName(dirMatch[1]);
    destName = cleanName(dirMatch[2]);
  }

  if (!pickupName || !destName) {
    const origMatch = text.match(/origin=([^&]+)/i);
    const destMatch = text.match(/destination=([^&]+)/i);
    if (origMatch && !pickupName) pickupName = cleanName(origMatch[1]);
    if (destMatch && !destName) destName = cleanName(destMatch[1]);
  }

  return { pickupName, destName };
}

/**
 * Hàm tra cứu tọa độ từ tên địa danh qua Mapbox API
 */
async function geocodeAddressName(name, proximity) {
  if (!name || typeof MAPBOX_TOKEN === 'undefined' || !MAPBOX_TOKEN) return null;
  
  // Bỏ qua từ rác "Ghim đã thả"
  if (/^(ghim đã thả|dropped pin|chỗ ghim|vị trí đã ghim|pinned location)$/i.test(name.trim())) {
    return null;
  }

  try {
    let url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(name)}.json?access_token=${MAPBOX_TOKEN}&country=vn&language=vi&limit=1`;
    if (proximity && Number.isFinite(proximity.lat) && Number.isFinite(proximity.lng)) {
      url += `&proximity=${proximity.lng.toFixed(4)},${proximity.lat.toFixed(4)}`;
    }
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].geometry.coordinates;
        const placeName = typeof cleanAddressText === 'function' 
          ? cleanAddressText(data.features[0].text || data.features[0].place_name) 
          : (data.features[0].text || data.features[0].place_name);
        return { lat, lng, placeName };
      }
    }
  } catch (e) {
    console.warn("Lỗi Geocoding:", e);
  }
  return null;
}

/**
 * Mở Google Maps chuẩn cho iOS, Android và PC
 */
window.openGoogleMapsToCopy = function() {
  window.wasGgmapOpened = true;
  let url = 'https://www.google.com/maps/dir/?api=1';

  if (typeof markerStart !== 'undefined' && markerStart) {
    const s = markerStart.getLatLng();
    url += `&origin=${s.lat},${s.lng}`;
  }

  if (typeof markerEnd !== 'undefined' && markerEnd) {
    const e = markerEnd.getLatLng();
    url += `&destination=${e.lat},${e.lng}`;
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (isIOS) {
    window.location.href = url;
  } else {
    window.open(url, '_blank');
  }
};

window.clearGgmapInput = function() {
  const inputEl = document.getElementById('ggmapLinkInput');
  const clearBtn = document.getElementById('clearGgmapBtn');
  if (inputEl) { inputEl.value = ''; }
  if (clearBtn) { clearBtn.style.display = 'none'; }
};

/**
 * Hàm dán liên kết hỗ trợ tối đa cho Safari iOS
 */
window.pasteFromClipboard = async function() {
  const inputEl = document.getElementById('ggmapLinkInput');
  if (!inputEl) return;

  let text = '';

  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      text = await navigator.clipboard.readText();
    }
  } catch (err) {
    console.warn("Safari chặn truy cập Clipboard tự động:", err);
  }

  let cleanUrl = extractGoogleMapsUrl(text);

  if (cleanUrl && (cleanUrl.includes('google.com') || cleanUrl.includes('goo.gl'))) {
    inputEl.value = cleanUrl;
    const clearBtn = document.getElementById('clearGgmapBtn');
    if (clearBtn) clearBtn.style.display = 'flex';
    handleGgmapLinkInput();
    return;
  }

  const userPasted = prompt("📌 Nhấn giữ vào ô bên dưới ➔ Chọn 'Dán' (Paste):");
  if (userPasted) {
    cleanUrl = extractGoogleMapsUrl(userPasted);
    if (cleanUrl && (cleanUrl.includes('google.com') || cleanUrl.includes('goo.gl'))) {
      inputEl.value = cleanUrl;
      const clearBtn = document.getElementById('clearGgmapBtn');
      if (clearBtn) clearBtn.style.display = 'flex';
      handleGgmapLinkInput();
    } else if (userPasted.trim().length > 0) {
      if (typeof alert === 'function') alert("⚠️ Nội dung bạn dán không phải là liên kết Google Maps!");
    }
  }
};

// TỰ ĐỘNG BẬT HỘP THOẠI DÁN KHI TỪ GOOGLE MAPS QUAY VỀ ỨNG DỤNG
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && window.wasGgmapOpened) {
    window.wasGgmapOpened = false;
    setTimeout(() => {
      window.pasteFromClipboard();
    }, 350);
  }
});

/**
 * Giải mã link rút gọn an toàn (Không bắn lỗi 403 / CORS ra Console)
 */
async function expandShortLinkClean(shortUrl, signal) {
  const cleanShortUrl = extractGoogleMapsUrl(shortUrl);
  const encoded = encodeURIComponent(cleanShortUrl);

  const proxyServices = [
    // 1. Supabase Edge Function
    async () => {
      const res = await fetch(`https://yvucyqkglbgxvozrznir.supabase.co/functions/v1/dynamic-action?url=${encoded}`, { signal });
      if (!res.ok) throw new Error('Supabase Edge Error');
      const data = await res.json();
      return { expandedUrl: data.expandedUrl || cleanShortUrl, content: data.content || '' };
    },
    // 2. Cloudflare Worker
    async () => {
      if (typeof CF_WORKER_URL === 'undefined' || !CF_WORKER_URL) throw new Error('No CF Worker');
      const res = await fetch(`${CF_WORKER_URL}/?url=${encoded}`, { signal });
      if (!res.ok) throw new Error('CF Worker Error');
      const data = await res.json();
      return { expandedUrl: data.expandedUrl || cleanShortUrl, content: data.content || '' };
    },
    // 3. AllOrigins Proxy (Thay thế cho các Proxy 403 bị lỗi)
    async () => {
      const res = await fetch(`https://api.allorigins.win/get?url=${encoded}`, { signal });
      if (!res.ok) throw new Error('AllOrigins Error');
      const data = await res.json();
      return { expandedUrl: data.status?.url || cleanShortUrl, content: data.contents || '' };
    }
  ];

  for (const service of proxyServices) {
    try {
      const result = await service();
      if (result && (result.content || result.expandedUrl !== cleanShortUrl)) {
        return result;
      }
    } catch (e) {
      if (e.name === 'AbortError') return { expandedUrl: cleanShortUrl, content: '' };
    }
  }

  return { expandedUrl: cleanShortUrl, content: '' };
}

window.handleGgmapLinkInput = function() {
  clearTimeout(window.ggmapInputTimer);

  const inputEl = document.getElementById('ggmapLinkInput');
  const clearBtn = document.getElementById('clearGgmapBtn');
  let rawUrl = inputEl ? inputEl.value.trim() : '';

  rawUrl = extractGoogleMapsUrl(rawUrl);

  if (clearBtn) clearBtn.style.display = rawUrl.length > 0 ? 'flex' : 'none';
  if (!rawUrl) return;

  if (!rawUrl.includes('google.com') && !rawUrl.includes('goo.gl')) {
    if (rawUrl.startsWith('http') || rawUrl.length > 25) {
      if (typeof alert === 'function') alert("⚠️ Link dán vào không thuộc định dạng Google Maps!");
    }
    return;
  }

  window.ggmapInputTimer = setTimeout(async () => {
    if (window.ggmapAbortController) {
      window.ggmapAbortController.abort();
    }
    
    window.ggmapAbortController = new AbortController();
    const currentSignal = window.ggmapAbortController.signal;

    let targetUrl = rawUrl;
    let fullHtmlContent = "";

    // 1. Giải mã link rút gọn hoặc link geocode từ Zalo
    if (rawUrl.includes('maps.app.goo.gl') || rawUrl.includes('goo.gl') || rawUrl.includes('geocode=')) {
      const expandedResult = await expandShortLinkClean(rawUrl, currentSignal);
      if (currentSignal.aborted) return;
      targetUrl = expandedResult.expandedUrl;
      fullHtmlContent = expandedResult.content;
    }

    if (currentSignal.aborted) return;

    // 2. Tổng hợp nguồn văn bản
    const masterText = rawUrl + " " + targetUrl + " " + fullHtmlContent;

    // 3. Quét tọa độ Việt Nam từ văn bản
    let detectedCoords = extractVietnamCoordinatesFromText(masterText);
    let { pickupName, destName } = extractPlaceNamesFromText(masterText);

    let pickupLat = null, pickupLng = null, destLat = null, destLng = null;

    const isMyLocationText = /^(vị trí của bạn|vị trí của tôi|my location|vị trí hiện tại|current location|your location)$/i;

    if (detectedCoords.length >= 2) {
      pickupLat = detectedCoords[0].lat;
      pickupLng = detectedCoords[0].lng;
      destLat = detectedCoords[detectedCoords.length - 1].lat;
      destLng = detectedCoords[detectedCoords.length - 1].lng;
    } else if (detectedCoords.length === 1) {
      destLat = detectedCoords[0].lat;
      destLng = detectedCoords[0].lng;
      
      if (typeof userLatLng !== 'undefined' && userLatLng) {
        pickupLat = userLatLng.lat;
        pickupLng = userLatLng.lng;
        pickupName = "Vị trí hiện tại của bạn";
      }
    }

    // 4. XỬ LÝ "VỊ TRÍ CỦA BẠN": Nếu điểm đón là "Vị trí của bạn", tự gán GPS hiện tại
    if (pickupName && isMyLocationText.test(pickupName.trim())) {
      if (typeof userLatLng !== 'undefined' && userLatLng) {
        pickupLat = userLatLng.lat;
        pickupLng = userLatLng.lng;
        pickupName = "Vị trí hiện tại của bạn";
      }
    }

    // 5. Quy đổi tên địa danh sang tọa độ nếu link thiếu chuỗi số tọa độ
    if ((!pickupLat || !destLat) && (pickupName || destName)) {
      const proximity = (typeof userLatLng !== 'undefined' && userLatLng) ? { lat: userLatLng.lat, lng: userLatLng.lng } : null;

      if (!pickupLat && pickupName && !isMyLocationText.test(pickupName.trim())) {
        const geoRes = await geocodeAddressName(pickupName, proximity);
        if (geoRes) {
          pickupLat = geoRes.lat;
          pickupLng = geoRes.lng;
          if (geoRes.placeName) pickupName = geoRes.placeName;
        }
      }

      if (!destLat && destName) {
        const geoRes = await geocodeAddressName(destName, proximity);
        if (geoRes) {
          destLat = geoRes.lat;
          destLng = geoRes.lng;
          if (geoRes.placeName) destName = geoRes.placeName;
        }
      }
    }

    // 6. THỰC THI VẼ ĐƯỜNG VÀ TÍNH GIÁ CƯỚC
    if (pickupLat && pickupLng && destLat && destLng) {
      const pickupLatLng = L.latLng(pickupLat, pickupLng);
      const destLatLng = L.latLng(destLat, destLng);

      if (typeof exitSelectionMode === 'function') exitSelectionMode();
      if (typeof setPickupLocation === 'function') setPickupLocation(pickupLatLng);
      
      if (pickupName) {
        const pInput = document.getElementById('pickupInput');
        if (pInput) pInput.value = pickupName; 
        if (typeof toggleClearButton === 'function') toggleClearButton('pickup');
        if (typeof saveRecentPickup === 'function') saveRecentPickup(pickupName, pickupLat, pickupLng);
      } else if (typeof fetchAddressForInput === 'function') { 
        fetchAddressForInput('pickup', pickupLatLng); 
      }

      if (typeof setDestLocation === 'function') setDestLocation(destLatLng);
      
      if (destName) {
        const dInput = document.getElementById('destInput');
        if (dInput) dInput.value = destName; 
        if (typeof toggleClearButton === 'function') toggleClearButton('dest');
        if (typeof saveRecentDest === 'function') saveRecentDest(destName, destLat, destLng);
      } else if (typeof fetchAddressForInput === 'function') { 
        fetchAddressForInput('dest', destLatLng); 
      }

      if (typeof calculateMapboxRoute === 'function') calculateMapboxRoute();
    } else {
      if (typeof alert === 'function') alert("❌ Không tìm thấy tọa độ lộ trình trong liên kết này. Vui lòng dán đúng link chỉ đường Google Maps!");
    }
  }, 300);
};

document.addEventListener('DOMContentLoaded', () => {
  const inputEl = document.getElementById('ggmapLinkInput');
  if (inputEl) {
    inputEl.addEventListener('input', () => handleGgmapLinkInput());
  }
});