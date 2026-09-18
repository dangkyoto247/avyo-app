// boc-tach-ggmap.js - Bóc tách và xử lý link chỉ đường Google Maps

// Biến toàn cục lưu giữ Controller để hủy request giải mã cũ
let ggmapAbortController = null;
let lastAutoPastedUrl = '';

window.openGoogleMapsToCopy = function() {
  let url = 'https://www.google.com/maps/dir/?api=1';

  // 1. CHỈ truyền origin khi khách ĐÃ CHỌN điểm đi cụ thể trên bản đồ Avyo
  // Nếu chưa chọn: Không truyền origin để Google Maps tự động nhận diện "Vị trí của bạn"
  if (typeof markerStart !== 'undefined' && markerStart) {
    const s = markerStart.getLatLng();
    url += `&origin=${s.lat},${s.lng}`;
  }

  // 2. Điểm đến: Truyền tọa độ nếu đã chọn trên Avyo
  if (typeof markerEnd !== 'undefined' && markerEnd) {
    const e = markerEnd.getLatLng();
    url += `&destination=${e.lat},${e.lng}`;
  }

  window.open(url, '_blank');
};

window.clearGgmapInput = function() {
  const inputEl = document.getElementById('ggmapLinkInput');
  const clearBtn = document.getElementById('clearGgmapBtn');
  if (inputEl) { inputEl.value = ''; inputEl.focus(); }
  if (clearBtn) { clearBtn.style.display = 'none'; }
};

// Hàm xử lý sự kiện Dán (Paste) từ bàn phím/chuột
window.handleGgmapPaste = function(event) {
  setTimeout(() => {
    handleGgmapLinkInput();
  }, 100);
};

// Hàm xử lý khi bấm nút "📋 Dán" trên giao diện
window.pasteFromClipboard = async function() {
  const inputEl = document.getElementById('ggmapLinkInput');
  
  try {
    // 1. Đọc trực tiếp bộ nhớ tạm từ Clipboard API
    const text = await navigator.clipboard.readText();
    if (text) {
      if (inputEl) {
        inputEl.value = text.trim();
        // Không gọi inputEl.focus() ở đây để tránh iOS bật thêm menu Dán phụ
        handleGgmapLinkInput();
      }
    }
  } catch (err) {
    // 2. Nếu Safari chặn Clipboard API, tự động mở ô nhập để khách dán 1 chạm bằng menu native
    if (inputEl) {
      inputEl.focus();
      // Hiển thị gợi ý nhỏ nếu cần
    }
  }
};

window.handleGgmapLinkInput = function() {
  clearTimeout(ggmapInputTimer);

  const inputEl = document.getElementById('ggmapLinkInput');
  const clearBtn = document.getElementById('clearGgmapBtn');
  let rawUrl = inputEl ? inputEl.value.trim() : '';

  // BÓC TÁCH LINK VÀ CẮT BỎ ĐUÔI RÁC ?g_st=ic NẾU CÓ
  const urlRegex = /(https?:\/\/[^\s]+)/;
  const match = rawUrl.match(urlRegex);
  if (match) rawUrl = match[1].split('?')[0]; 

  if (clearBtn) clearBtn.style.display = rawUrl.length > 0 ? 'flex' : 'none';
  if (!rawUrl) return;

  if (!rawUrl.includes('google.com') && !rawUrl.includes('goo.gl')) {
    if (rawUrl.startsWith('http') || rawUrl.length > 25) alert("⚠️ Link dán vào không thuộc định dạng Google Maps!");
    return;
  }

  ggmapInputTimer = setTimeout(async () => {
    // 1. Hủy request giải mã cũ nếu đang chạy ngầm
    if (ggmapAbortController) {
      ggmapAbortController.abort();
    }
    
    // 2. Tạo AbortController mới cho lượt dán hiện tại
    ggmapAbortController = new AbortController();
    const currentSignal = ggmapAbortController.signal;

    alert("⏳ Đang giải mã và lấy vị trí từ Google Maps...");

    let targetUrl = rawUrl;
    let fullHtmlContent = "";

    // Luồng tự động giải mã qua 3 tầng (Supabase Edge -> Cloudflare -> Proxy)
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
        if (e.name === 'AbortError') return; // Bỏ qua nếu do người dùng dán link mới
        console.warn("Tầng 1 bận, chuyển sang Tầng 2..."); 
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
          console.warn("Tầng 2 bận, chuyển sang Tầng 3..."); 
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
        alert("❌ Dịch vụ giải mã link bận. Vui lòng kiểm tra lại kết nối!"); 
        return; 
      }
    }

    if (currentSignal.aborted) return;

    const parseText = targetUrl + " " + fullHtmlContent;
    let pickupLat = null, pickupLng = null, destLat = null, destLng = null, pickupName = "", destName = "";

    // Bóc tách tên địa danh
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

    // Trích xuất Tọa độ bằng các Regex mẫu
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

    // Thiết lập vị trí bản đồ
    if (pickupLat && pickupLng && destLat && destLng) {
      const pickupLatLng = L.latLng(pickupLat, pickupLng);
      const destLatLng = L.latLng(destLat, destLng);

      exitSelectionMode();
      setPickupLocation(pickupLatLng);
      if (pickupName) {
        const pInput = document.getElementById('pickupInput');
        if (pInput) pInput.value = pickupName; toggleClearButton('pickup');
        saveRecentPickup(pickupName, pickupLat, pickupLng);
      } else { fetchAddressForInput('pickup', pickupLatLng); }

      setDestLocation(destLatLng);
      if (destName) {
        const dInput = document.getElementById('destInput');
        if (dInput) dInput.value = destName; toggleClearButton('dest');
        saveRecentDest(destName, destLat, destLng);
      } else { fetchAddressForInput('dest', destLatLng); }

      calculateMapboxRoute();
      alert("✅ ĐÃ TRÍCH XUẤT THÀNH CÔNG LỘ TRÌNH!\n\nVị trí điểm đi, điểm đến và tuyến đường đã được thiết lập trên bản đồ.");
    } else {
      alert("❌ Không tìm thấy tọa độ lộ trình trong liên kết này. Vui lòng dán đúng link chỉ đường Google Maps!");
    }
  }, 400);
};

// ============================================================================
// TỰ ĐỘNG BẮT LINK GOOGLE MAPS KHI KHÁCH QUAY LẠI TAB (TỐI ƯU CỰC MẠNH CHO IPHONE)
// ============================================================================
async function checkAndAutoPasteClipboard() {
  const inputEl = document.getElementById('ggmapLinkInput');
  if (!inputEl) return;

  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText();
      const cleanText = text ? text.trim() : '';

      // Kiểm tra xem bộ nhớ tạm có chứa link Google Maps không
      if (cleanText && (cleanText.includes('maps.app.goo.gl') || cleanText.includes('google.com/maps') || cleanText.includes('goo.gl'))) {
        
        // Tránh tự dán lại nhiều lần cùng 1 link
        if (cleanText !== lastAutoPastedUrl && inputEl.value !== cleanText) {
          lastAutoPastedUrl = cleanText;
          inputEl.value = cleanText;

          // Hiển thị nút xóa x
          const clearBtn = document.getElementById('clearGgmapBtn');
          if (clearBtn) clearBtn.style.display = 'flex';

          // Tự động kích hoạt luồng bóc tách tọa độ
          if (typeof handleGgmapLinkInput === 'function') {
            handleGgmapLinkInput();
          }
        }
      }
    }
  } catch (err) {
    // Trình duyệt từ chối quyền đọc Clipboard ngầm, bỏ qua êm đẹp
  }
}

// Bắt sự kiện khi người dùng vừa chuyển từ Google Maps quay lại Tab Avyo
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    checkAndAutoPasteClipboard();
  }
});

// Bắt sự kiện khi chạm hoặc focus vào ô nhập link
document.addEventListener('DOMContentLoaded', () => {
  const inputEl = document.getElementById('ggmapLinkInput');
  if (inputEl) {
    inputEl.addEventListener('focus', checkAndAutoPasteClipboard);
    inputEl.addEventListener('click', checkAndAutoPasteClipboard);
  }
});