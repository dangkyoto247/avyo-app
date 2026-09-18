// boc-tach-ggmap.js - Bóc tách và xử lý link chỉ đường Google Maps (Xử lý triệt để link iPhone kèm ?g_st=ic)

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
  // Tách bỏ tham số rác g_st=ic do iPhone tạo ra khiến Google chặn giải mã link full
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
 * BỘ QUÉT TỌA ĐỘ ĐA TẦNG: Quét toàn bộ văn bản HTML/URL để tìm các cặp tọa độ Việt Nam
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
          return safeDistance(pt.lat, pt.lng, lat, lng) < 0.05; // Dưới 50m xem như trùng
        }
        return Math.abs(pt.lat - lat) < 0.0005 && Math.abs(pt.lng - lng) < 0.0005;
      });
      if (!isDuplicate) coords.push({ lat, lng });
    }
  };

  // 1. Quét định dạng @lat,lng (RẤT PHỔ BIẾN SAU KHIN MỞ RỘNG LINK IPHONE)
  [...text.matchAll(/@(-?\d+\.\d+),(?:%2C|\s*)(-?\d+\.\d+)/gi)].forEach(m => addPt(m[1], m[2]));

  // 2. Quét Protobuf !1d(lng)!2d(lat) & !2d(lng)!1d(lat)
  [...text.matchAll(/!1d(-?\d+\.\d+)!2d(-?\d+\.\d+)/g)].forEach(m => addPt(m[2], m[1]));
  [...text.matchAll(/!2d(-?\d+\.\d+)!1d(-?\d+\.\d+)/g)].forEach(m => addPt(m[2], m[1]));

  // 3. Quét Protobuf !3d(lat)!4d(lng) & !4d(lng)!3d(lat)
  [...text.matchAll(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g)].forEach(m => addPt(m[1], m[2]));
  [...text.matchAll(/!4d(-?\d+\.\d+)!3d(-?\d+\.\d+)/g)].forEach(m => addPt(m[2], m[1]));

  // 4. Quét đường dẫn dạng /dir/lat1,lng1/lat2,lng2
  [...text.matchAll(/\/dir\/(-?\d+\.\d+),(?:%2C|\s*)(-?\d+\.\d+)\/(-?\d+\.\d+),(?:%2C|\s*)(-?\d+\.\d+)/gi)].forEach(m => {
    addPt(m[1], m[2]);
    addPt(m[3], m[4]);
  });

  // 5. Quét tham số Query (origin, destination, saddr, daddr, markers, path, center, ll)
  [...text.matchAll(/(?:origin|destination|saddr|daddr|markers|path|center|ll|q)=(-?\d+\.\d+)(?:%2C|,)\s*(-?\d+\.\d+)/gi)].forEach(m => {
    addPt(m[1], m[2]);
  });

  // 6. Quét tất cả các cặp Lat,Lng tự do trong HTML
  [...text.matchAll(/(-?\d{1,2}\.\d{4,15})\s*(?:%2C|,)\s*(-?\d{2,3}\.\d{4,15})/g)].forEach(m => {
    addPt(m[1], m[2]);
  });

  return coords;
}

/**
 * Trích xuất tên địa danh nơi đi và nơi đến từ URL / HTML
 */
function extractPlaceNamesFromText(text) {
  let pickupName = '', destName = '';
  if (!text) return { pickupName, destName };

  const cleanName = (str) => {
    try {
      let decoded = decodeURIComponent(str.replace(/\+/g, ' '));
      if (typeof cleanAddressText === 'function') decoded = cleanAddressText(decoded);
      return /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(decoded) ? '' : decoded;
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
 * Giải mã song song siêu tốc qua các Proxy
 */
async function expandShortLinkParallel(shortUrl, signal) {
  const cleanShortUrl = extractGoogleMapsUrl(shortUrl);
  const encoded = encodeURIComponent(cleanShortUrl);
  const endpoints = [
    `https://yvucyqkglbgxvozrznir.supabase.co/functions/v1/dynamic-action?url=${encoded}`,
    typeof CF_WORKER_URL !== 'undefined' ? `${CF_WORKER_URL}/?url=${encoded}` : null,
    `https://api.codetabs.com/v1/proxy?quest=${encoded}`,
    `https://corsproxy.io/?${encoded}`
  ].filter(Boolean);

  const fetchWithTimeout = (url, timeoutMs = 4000) => {
    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout')), timeoutMs);
      try {
        const res = await fetch(url, { signal });
        clearTimeout(timer);
        if (!res.ok) return reject(new Error('HTTP Error ' + res.status));
        
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await res.json();
          resolve({
            expandedUrl: data.expandedUrl || res.url || cleanShortUrl,
            content: data.content || ''
          });
        } else {
          const text = await res.text();
          resolve({
            expandedUrl: res.url || cleanShortUrl,
            content: text
          });
        }
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  };

  try {
    const results = await Promise.allSettled(endpoints.map(ep => fetchWithTimeout(ep, 4000)));
    let combinedContent = '';
    let bestExpandedUrl = cleanShortUrl;

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        if (r.value.content) combinedContent += ' ' + r.value.content;
        if (r.value.expandedUrl && r.value.expandedUrl !== cleanShortUrl) {
          bestExpandedUrl = r.value.expandedUrl;
        }
      }
    }
    return { expandedUrl: bestExpandedUrl, content: combinedContent };
  } catch (e) {
    return { expandedUrl: cleanShortUrl, content: '' };
  }
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

    // 1. Giải mã link rút gọn nếu có
    if (rawUrl.includes('maps.app.goo.gl') || rawUrl.includes('goo.gl')) {
      const expandedResult = await expandShortLinkParallel(rawUrl, currentSignal);
      if (currentSignal.aborted) return;
      targetUrl = expandedResult.expandedUrl;
      fullHtmlContent = expandedResult.content;
    }

    if (currentSignal.aborted) return;

    // 2. Tổng hợp tất cả nguồn văn bản
    const masterText = rawUrl + " " + targetUrl + " " + fullHtmlContent;

    // 3. Quét tọa độ Việt Nam từ văn bản
    let detectedCoords = extractVietnamCoordinatesFromText(masterText);
    let { pickupName, destName } = extractPlaceNamesFromText(masterText);

    let pickupLat = null, pickupLng = null, destLat = null, destLng = null;

    if (detectedCoords.length >= 2) {
      pickupLat = detectedCoords[0].lat;
      pickupLng = detectedCoords[0].lng;
      destLat = detectedCoords[detectedCoords.length - 1].lat;
      destLng = detectedCoords[detectedCoords.length - 1].lng;
    } else if (detectedCoords.length === 1) {
      // XỬ LÝ ĐẶC BIỆT CHO LINK IPHONE CHỈ CHỨA 1 ĐIỂM ĐẾN:
      destLat = detectedCoords[0].lat;
      destLng = detectedCoords[0].lng;
      
      // Điểm đón lấy vị trí hiện tại của khách
      if (typeof userLatLng !== 'undefined' && userLatLng) {
        pickupLat = userLatLng.lat;
        pickupLng = userLatLng.lng;
      }
    }

    // 4. Quy đổi tên địa danh sang tọa độ nếu link không có chuỗi số tọa độ
    if ((!pickupLat || !destLat) && (pickupName || destName)) {
      const proximity = (typeof userLatLng !== 'undefined' && userLatLng) ? { lat: userLatLng.lat, lng: userLatLng.lng } : null;

      if (!pickupLat && pickupName) {
        if (/^(vị trí của tôi|my location|vị trí hiện tại|current location)$/i.test(pickupName.trim())) {
          if (typeof userLatLng !== 'undefined' && userLatLng) {
            pickupLat = userLatLng.lat;
            pickupLng = userLatLng.lng;
          }
        } else {
          const geoRes = await geocodeAddressName(pickupName, proximity);
          if (geoRes) {
            pickupLat = geoRes.lat;
            pickupLng = geoRes.lng;
            if (geoRes.placeName) pickupName = geoRes.placeName;
          }
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

    // 5. THỰC THI VẼ ĐƯỜNG VÀ TÍNH GIÁ CƯỚC
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