// CẤU HÌNH API KEYS VÀ ENDPOINTS
const MAPBOX_TOKEN = 'pk.eyJ1IjoidHVhbmFuaDM0MTYyMyIsImEiOiJjbXUycmMxa2UwMjd4MnlxeWZ2ZDV5NGF5In0.o10B_hdnfqOIn1jNfbpY2w';
const SUPABASE_URL = 'https://yvucyqkglbgxvozrznir.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2dWN5cWtnbGJneHZvenJ6bmlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMzA3ODAsImV4cCI6MjEwNDcwNjc4MH0.Zagl4i2LPmxW3w9ih0h4LRsrm-OOGtPcWgvEs2vHBqo';
const CF_WORKER_URL = 'https://raspy-recipe-7874.steep-feather-d277.workers.dev'; 
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// LOCALSTORAGE KEYS
const RECENT_PICKUPS_KEY = 'avyo_recent_pickups';
const RECENT_DESTS_KEY = 'avyo_recent_dests';
const VEHICLE_PREF_KEY = 'avyo_selected_vehicle';

// CẤU HÌNH VỊ TRÍ MẶC ĐỊNH LẦN ĐẦU (ĐỌC TỪ LOCALSTORAGE)
const savedLat = localStorage.getItem('avyo_last_lat');
const savedLng = localStorage.getItem('avyo_last_lng');
const initialCenter = (savedLat && savedLng) 
  ? [parseFloat(savedLat), parseFloat(savedLng)] 
  : [18.7034, 105.6832];

// CÁC BIẾN TOÀN CỤC (GLOBAL STATE) DÙNG CHUNG CHO TẤT CẢ CÁC FILE
let swapDegree = 0;
let activeSuggestionIndex = -1;
let mapMoveDebounceTimer = null;
let isFirstLocationLoad = true;
let ggmapInputTimer = null;
let isFittingBounds = false;
let activeZoomPinLatLng = null;
let routeAnimationTimer = null;
let searchTimer = null;
let mapboxTimeout = null;

let userLatLng = null;
let markerStart = null;
let markerEnd = null;
let routeLine = null;
let currentDistance = 0; 
let currentPrice = 0;
let selectedDriver = null;
let ratingDriverTarget = null;
let rawDriversData = [];
let pickupDetailNote = '';
let currentSelectionMode = 'pickup';
let activeFilter = localStorage.getItem(VEHICLE_PREF_KEY) || 'bike';

// THÔNG TIN VÀ ICON TÊN CÁC LOẠI PHƯƠNG TIỆN
const typeIcons = {
  'bike': '🛵',
  'car': '🚕',
  'driver': '<svg width="20" height="20" viewBox="0 0 24 24" fill="#00b14f"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>',
  'truck': '🚚'
};

const typeNames = { 
  'bike': '🛵 Xe máy (4.500đ/km)', 
  'car': '🚕 Ô tô (9.000đ/km)', 
  'driver': '👤 Lái xe hộ (10.000đ/km)', 
  'truck': '🚚 Chở hàng (Thỏa thuận)'
};