// boc-tach-ggmap.js - Bóc tách và xử lý link chỉ đường Google Maps

// Gắn trực tiếp vào window để triệt tiêu 100% lỗi SyntaxError trùng biến
window.ggmapAbortController = window.ggmapAbortController || null;
window.ggmapInputTimer = window.ggmapInputTimer || null;

/**
 * Lọc trích xuất URL Google Maps chuẩn từ chuỗi văn bản bất kỳ
 */
function extractGoogleMapsUrl(text) {
  if (!text) return '';
  const reg = /(https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl|www\.google\.com\/maps)[^\s]+)/i;
  const match = text.match(reg);
  return match ? match[1] : text.trim();
}

/**
 * Mở Google Maps chuẩn cho iOS, Android và PC
 */
window.openGoogleMapsToCopy = function() {
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

window.pasteFromClipboard = async function() {
  const inputEl = document.getElementById('ggmapLinkInput');
  if (!inputEl) return;

  try {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      throw new Error("Trình duyệt không hỗ trợ API Clipboard trực tiếp");
    }

    const text = await navigator.clipboard.readText();
    const cleanUrl = extractGoogleMapsUrl(text);

    if (cleanUrl && (cleanUrl.includes('google.com') || cleanUrl.includes('goo.gl'))) {
      inputEl.value = cleanUrl;
      const clearBtn = document.getElementById('clearGgmapBtn');
      if (clearBtn) clearBtn.style.display = 'flex';
      handleGgmapLinkInput();
    } else if (text && text.trim().length > 0) {
      if (typeof alert === 'function') alert("⚠️ Nội dung bạn vừa sao chép không chứa liên kết Google Maps!");
    } else {
      if (typeof alert === 'function') alert("⚠️ Khay nhớ tạm đang trống, vui lòng qua Google Maps sao chép đường link trước.");
    }
  } catch (err) {
    console.warn("Safari/Trình duyệt chặn đọc Clipboard trực tiếp:", err);
    // Dự phòng fallback thông báo rõ ràng cho user nếu bị chặn hoặc đang dùng thiết bị cũ
    if (typeof Swal !== 'undefined') {
      Swal.fire({
        toast: true,
        position: 'top',
        icon: 'info',
        title: 'Trình duyệt chặn dán tự động. Vui lòng cho phép quyền hoặc dán thủ công.',
        showConfirmButton: false,
        timer: 3500
      });
    } else if (typeof alert === 'function') {
      alert("⚠️ Thiết bị đã chặn quyền truy cập khay nhớ tạm. Vui lòng nhấn 'Cho phép dán' nếu có thông báo hiển thị.");
    }
  }
};

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

    if (rawUrl.includes('maps.app.goo.gl') || rawUrl.includes('goo.gl')) {
      let resolved = false;

      // TẦNG 1: Supabase Edge
      try {
        const sbRes = await fetch(`https://yvucyqkglbgxvozrznir.supabase.co/functions/v1/dynamic-action?url=${encodeURIComponent(rawUrl)}`, { signal: currentSignal });
        if (sbRes.ok) {
          const sbData = await sbRes.json();
          if (sbData.expandedUrl) {
            targetUrl = sbData.expandedUrl; fullHtmlContent = sbData.content || ""; resolved = true;
          }
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
      }

      // TẦNG 2: Cloudflare Worker
      if (!resolved) {
        try {
          const cfRes = await fetch(`${CF_WORKER_URL}/?url=${encodeURIComponent(rawUrl)}`, { signal: currentSignal });
          if (cfRes.ok) {
            const cfData = await cfRes.json();
            if (cfData.expandedUrl) {
              targetUrl = cfData.expandedUrl; fullHtmlContent = cfData.content || ""; resolved = true;
            }
          }
        } catch (e) { 
          if (e.name === 'AbortError') return;
        }
      }

      // TẦNG 3: Public Proxies
      if (!resolved) {
        const proxyList = [
          async (u) => { const res = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`, { signal: currentSignal }); if (!res.ok) throw new Error(); return { url: u, content: await res.text() }; },
          async (u) => { const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(u)}`, { signal: currentSignal }); if (!res.ok) throw new Error(); return { url: res.url || u, content: await res.text() }; }
        ];

        for (const fetchProxy of proxyList) {
          try {
            const result = await fetchProxy(rawUrl); targetUrl = result.url; fullHtmlContent = result.content;
            if (fullHtmlContent || targetUrl !== rawUrl) { resolved = true; break; }
          } catch (err) {
            if (err.name === 'AbortError') return;
          }
        }
      }

      if (!resolved) { 
        if (currentSignal.aborted) return;
        if (typeof alert === 'function') alert("❌ Dịch vụ giải mã link bận. Vui lòng kiểm tra lại kết nối!"); 
        return; 
      }
    }

    if (currentSignal.aborted) return;

    const parseText = targetUrl + " " + fullHtmlContent;
    let pickupLat = null, pickupLng = null, destLat = null, destLng = null, pickupName = "", destName = "";

    const textMatch = targetUrl.match(/\/dir\/([^\/@]+)\/([^\/@]+)\//);
    if (textMatch) {
      try {
        let rawPickup = cleanAddressText(decodeURIComponent(textMatch[1].replace(/\+/g, ' ')));
        let rawDest = cleanAddressText(decodeURIComponent(textMatch[2].replace(/\+/g, ' ')));
        const isCoordRegex = /^-?\d+\.\d+,\s*-?\d+\.\d+$/;
        if (!isCoordRegex.test(rawPickup)) pickupName = rawPickup;
        if (!isCoordRegex.test(rawDest)) destName = rawDest;
      } catch (e) {}
    }

    const dataMatches = [...parseText.matchAll(/!2m2!1d(-?\d+\.\d+)!2d(-?\d+\.\d+)/g)];
    if (dataMatches.length >= 2) {
      pickupLng = parseFloat(dataMatches[0][1]); pickupLat = parseFloat(dataMatches[0][2]);
      destLng = parseFloat(dataMatches[1][1]); destLat = parseFloat(dataMatches[1][2]);
    }
    if (!pickupLat || !destLat) {
      const dirCoordMatch = parseText.match(/\/dir\/(-?\d+\.\d+),\s*(-?\d+\.\d+)\/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
      if (dirCoordMatch) {
        pickupLat = parseFloat(dirCoordMatch[1]); pickupLng = parseFloat(dirCoordMatch[2]);
        destLat = parseFloat(dirCoordMatch[3]); destLng = parseFloat(dirCoordMatch[4]);
      }
    }
    if (!pickupLat || !destLat) {
      const queryMatch = parseText.match(/(?:origin|saddr)=(-?\d+\.\d+),\s*(-?\d+\.\d+).*(?:destination|daddr)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
      if (queryMatch) {
        pickupLat = parseFloat(queryMatch[1]); pickupLng = parseFloat(queryMatch[2]);
        destLat = parseFloat(queryMatch[3]); destLng = parseFloat(queryMatch[4]);
      }
    }

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