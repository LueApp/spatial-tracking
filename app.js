/* Breadcrumb — record GPS trail, navigate back to start or waypoints.
   Pure client-side. Persists to localStorage. Works offline (arrow);
   map needs internet for tiles. */

'use strict';

// ---------- geo math (Movable Type formulas) ----------
const R = 6371e3; // earth radius, meters
const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;

function distance(a, b) { // meters between {lat,lon}
  const p1 = toRad(a.lat), p2 = toRad(b.lat);
  const dp = toRad(b.lat - a.lat), dl = toRad(b.lon - a.lon);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bearing(a, b) { // initial bearing 0..360 from true north
  const p1 = toRad(a.lat), p2 = toRad(b.lat), dl = toRad(b.lon - a.lon);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// ---------- state ----------
const RECORD_MIN_DIST = 5;     // meters: only store a breadcrumb if moved this far
const RECORD_MIN_TIME = 8000;  // ms: ...or this long since last stored point
const ARRIVE_RADIUS = 8;       // meters: "you are here"

const state = {
  trail: [],          // [{lat,lon,alt,acc,t}]
  waypoints: [],      // [{id,name,lat,lon,alt,t}]
  current: null,      // latest fix
  heading: null,      // compass degrees from true north
  targetId: 'home',   // 'home' | waypoint id
  watchId: null,
  wakeLock: null,
  tracking: false,
  lastStored: 0,
};

// ---------- persistence ----------
const LS_KEY = 'breadcrumb.v1';
function save() {
  localStorage.setItem(LS_KEY, JSON.stringify({ trail: state.trail, waypoints: state.waypoints }));
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    state.trail = d.trail || [];
    state.waypoints = d.waypoints || [];
  } catch { /* corrupt -> ignore */ }
}

// ---------- dom ----------
const $ = id => document.getElementById(id);
const els = {
  status: $('status'), arrow: $('arrow'), noHeading: $('noHeading'),
  dist: $('distOut'), bear: $('bearOut'), altDiff: $('altDiffOut'),
  acc: $('accOut'), alt: $('altOut'), head: $('headOut'), ptCount: $('ptCountOut'),
  targetLabel: $('targetLabel'), targetSelect: $('targetSelect'),
  start: $('startBtn'), mark: $('markBtn'), stop: $('stopBtn'), clear: $('clearBtn'),
  map: $('map'), mapToggle: $('mapToggle'), mapHint: $('mapHint'),
  wpList: $('wpList'),
  errBanner: $('errBanner'), errTitle: $('errTitle'), errMsg: $('errMsg'),
  errSteps: $('errSteps'), errDismiss: $('errDismiss'), errRetry: $('errRetry'),
  preflight: $('preflight'), preflightOk: $('preflightOk'), preflightCancel: $('preflightCancel'),
};

function showErr(title, msg, showSteps) {
  els.errTitle.textContent = title;
  els.errMsg.textContent = msg;
  els.errSteps.classList.toggle('hidden', !showSteps);
  els.errBanner.classList.remove('hidden');
}
function hideErr() { els.errBanner.classList.add('hidden'); }
function showPreflight() { els.preflight.classList.remove('hidden'); }
function hidePreflight() { els.preflight.classList.add('hidden'); }

function setStatus(text, cls) {
  els.status.textContent = text;
  els.status.className = 'status ' + cls;
}

// ---------- home / target ----------
function home() { return state.trail[0] || null; }

function targetPoint() {
  if (state.targetId === 'home') return home();
  return state.waypoints.find(w => w.id === state.targetId) || home();
}

function targetName() {
  if (state.targetId === 'home') return 'Start point';
  const w = state.waypoints.find(w => w.id === state.targetId);
  return w ? w.name : 'Start point';
}

// ---------- tracking ----------
async function start() {
  if (!('geolocation' in navigator)) { setStatus('no GPS', 'error'); return; }
  if (!window.isSecureContext) {
    showErr('HTTPS required', 'This page must be served over HTTPS for GPS to work. See README.', false);
    return;
  }
  hideErr();

  // Check existing permission state.
  // If already granted: watchPosition fires silently — no dialog, overlay apps can't block it.
  // If denied: tell user to fix in settings before we even try.
  // If prompt (first time): show pre-flight instructions so user can clear overlays first.
  let permState = 'prompt';
  try {
    const perm = await navigator.permissions.query({ name: 'geolocation' });
    permState = perm.state; // 'granted' | 'denied' | 'prompt'
  } catch { /* API unsupported — assume prompt, fall through */ }

  if (permState === 'denied') {
    showErr(
      'Location permanently blocked',
      'Permission was previously denied. To fix: open browser Settings → Site settings → Location → find this site → set to Allow, then reload.',
      false
    );
    return;
  }

  if (permState === 'prompt') {
    // Show pre-flight modal — user clears overlays, then taps Continue which calls doStart()
    showPreflight();
    return;
  }

  // 'granted' — go directly, no dialog will appear, overlay apps don't matter
  await doStart();
}

async function doStart() {
  hidePreflight();
  await requestCompass();   // iOS needs this from a tap
  await requestWakeLock();  // keep screen awake so tracking continues

  state.tracking = true;
  els.start.disabled = true;
  els.stop.disabled = false;
  els.mark.disabled = false;
  setStatus('locating…', 'tracking');

  state.watchId = navigator.geolocation.watchPosition(onFix, onGeoError, {
    enableHighAccuracy: true, maximumAge: 0, timeout: 15000,
  });
}

function stop() {
  if (state.watchId != null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null;
  state.tracking = false;
  releaseWakeLock();
  els.start.disabled = false;
  els.stop.disabled = true;
  els.mark.disabled = true;
  setStatus('stopped', 'idle');
}

function onFix(pos) {
  const c = pos.coords;
  const fix = {
    lat: c.latitude, lon: c.longitude,
    alt: c.altitude, acc: c.accuracy,
    altAcc: c.altitudeAccuracy, t: pos.timestamp,
  };
  state.current = fix;
  setStatus('tracking', 'tracking');

  // first ever point becomes home
  const isFirst = state.trail.length === 0;
  const last = state.trail[state.trail.length - 1];
  const moved = last ? distance(last, fix) : Infinity;
  const elapsed = pos.timestamp - state.lastStored;

  if (isFirst || moved >= RECORD_MIN_DIST || elapsed >= RECORD_MIN_TIME) {
    state.trail.push(fix);
    state.lastStored = pos.timestamp;
    save();
    refreshTargetOptions();
    renderWaypointList();
    drawTrail();
  }
  render();
}

function onGeoError(err) {
  console.warn('geo error', err);
  stop(); // reset UI — don't leave buttons stuck in tracking state
  if (err.code === 1) {
    showErr(
      'Location permission blocked',
      'The browser could not show the permission dialog. This usually means a floating app or overlay is covering the screen.',
      true
    );
  } else if (err.code === 2) {
    showErr('Location unavailable', 'GPS signal lost or hardware unavailable. Try moving outdoors.', false);
  } else if (err.code === 3) {
    showErr('Location timeout', 'GPS took too long to get a fix. Try again outdoors.', false);
  }
}

// ---------- compass ----------
async function requestCompass() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      const res = await DeviceOrientationEvent.requestPermission(); // iOS 13+
      if (res !== 'granted') return;
    }
  } catch { /* not iOS or denied */ }
  window.addEventListener('deviceorientationabsolute', onOrient, true);
  window.addEventListener('deviceorientation', onOrient, true);
}

function onOrient(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number') {
    h = e.webkitCompassHeading;            // iOS: true north, clockwise
  } else if (e.absolute && typeof e.alpha === 'number') {
    h = (360 - e.alpha) % 360;             // android absolute
  } else if (typeof e.alpha === 'number') {
    h = (360 - e.alpha) % 360;             // fallback (may drift)
  }
  if (h != null && !Number.isNaN(h)) state.heading = h;
  render();
}

// ---------- wake lock ----------
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
    }
  } catch { /* ignore */ }
}
function releaseWakeLock() {
  if (state.wakeLock) { state.wakeLock.release().catch(() => {}); state.wakeLock = null; }
}
// re-acquire if screen comes back
document.addEventListener('visibilitychange', () => {
  if (state.tracking && document.visibilityState === 'visible' && !state.wakeLock) requestWakeLock();
});

// ---------- waypoints ----------
function markWaypoint() {
  if (!state.current) { alert('No GPS fix yet. Wait for tracking to lock on.'); return; }
  const name = prompt('Name this waypoint:', 'WP ' + (state.waypoints.length + 1));
  if (name === null) return;
  state.waypoints.push({
    id: 'wp' + Date.now(),
    name: name.trim() || ('WP ' + (state.waypoints.length + 1)),
    lat: state.current.lat, lon: state.current.lon,
    alt: state.current.alt, t: state.current.t,
  });
  save();
  refreshTargetOptions();
  renderWaypointList();
  drawTrail();
}

function deleteWaypoint(id) {
  state.waypoints = state.waypoints.filter(w => w.id !== id);
  if (state.targetId === id) state.targetId = 'home';
  save();
  refreshTargetOptions();
  renderWaypointList();
  drawTrail();
  render();
}

function clearAll() {
  if (!confirm('Erase the whole trail and all waypoints? This cannot be undone.')) return;
  state.trail = [];
  state.waypoints = [];
  state.targetId = 'home';
  state.lastStored = 0;
  save();
  refreshTargetOptions();
  renderWaypointList();
  drawTrail();
  render();
}

// ---------- rendering ----------
function fmtDist(m) {
  if (m == null) return '—';
  return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(2) + ' km';
}
function fmtAlt(a) { return (a == null) ? 'n/a' : Math.round(a) + ' m'; }

function render() {
  els.ptCount.textContent = state.trail.length;
  els.targetLabel.innerHTML = 'Target: <b>' + targetName() + '</b>';

  const cur = state.current, tgt = targetPoint();
  els.acc.textContent = cur ? Math.round(cur.acc) + ' m' : '—';
  els.alt.textContent = cur ? fmtAlt(cur.alt) : '—';
  els.head.textContent = state.heading != null ? Math.round(state.heading) + '°' : '—';

  if (!cur || !tgt) {
    els.dist.textContent = '—'; els.bear.textContent = '—'; els.altDiff.textContent = '—';
    els.arrow.style.transform = 'rotate(0deg)';
    return;
  }

  const d = distance(cur, tgt);
  const brg = bearing(cur, tgt);
  els.dist.textContent = fmtDist(d);
  els.bear.textContent = Math.round(brg) + '°';

  const altD = (cur.alt != null && tgt.alt != null) ? (tgt.alt - cur.alt) : null;
  els.altDiff.textContent = altD == null ? 'n/a'
    : (altD >= 0 ? '+' : '') + Math.round(altD) + ' m';

  // rotate arrow: bearing relative to where phone points
  const arrived = d <= ARRIVE_RADIUS;
  els.arrow.classList.toggle('on-target', arrived);
  if (arrived) {
    els.arrow.textContent = '✓';
    els.arrow.style.transform = 'rotate(0deg)';
    els.noHeading.classList.add('hidden');
  } else {
    els.arrow.textContent = '↑';
    if (state.heading != null) {
      els.arrow.style.transform = 'rotate(' + (brg - state.heading) + 'deg)';
      els.noHeading.classList.add('hidden');
    } else {
      // no compass: arrow can't be relative; show north-up bearing + hint
      els.arrow.style.transform = 'rotate(' + brg + 'deg)';
      els.noHeading.classList.remove('hidden');
    }
  }
}

function refreshTargetOptions() {
  const sel = els.targetSelect;
  const prev = state.targetId;
  sel.innerHTML = '';
  const opts = [{ id: 'home', name: '🏁 Start point' }]
    .concat(state.waypoints.map(w => ({ id: w.id, name: '📍 ' + w.name })));
  for (const o of opts) {
    const el = document.createElement('option');
    el.value = o.id; el.textContent = o.name;
    sel.appendChild(el);
  }
  sel.value = opts.some(o => o.id === prev) ? prev : 'home';
  state.targetId = sel.value;
}

function renderWaypointList() {
  const ul = els.wpList;
  ul.innerHTML = '';
  const h = home();
  const rows = [];
  if (h) rows.push({ id: 'home', name: '🏁 Start point', lat: h.lat, lon: h.lon, alt: h.alt, t: h.t, fixed: true });
  for (const w of state.waypoints) rows.push({ ...w, name: '📍 ' + w.name });

  if (rows.length === 0) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="wp-sub">No trail yet. Tap Start to begin.</span>';
    ul.appendChild(li);
    return;
  }
  for (const r of rows) {
    const li = document.createElement('li');
    const sub = r.lat.toFixed(5) + ', ' + r.lon.toFixed(5) + ' · ' + fmtAlt(r.alt);
    li.innerHTML =
      '<div style="flex:1">' +
        '<div class="wp-name">' + r.name + '</div>' +
        '<div class="wp-sub">' + sub + '</div>' +
      '</div>' +
      '<button class="wp-go" data-go="' + r.id + '">Go</button>' +
      (r.fixed ? '' : '<button class="wp-del" data-del="' + r.id + '">✕</button>');
    ul.appendChild(li);
  }
}

// ---------- map (optional, Leaflet) ----------
let map = null, trailLine = null, curMarker = null, wpLayer = null, mapReady = false;

function ensureMap() {
  if (mapReady || typeof L === 'undefined') return;
  map = L.map('map', { zoomControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap',
  }).addTo(map);
  trailLine = L.polyline([], { color: '#2ea0ff', weight: 4 }).addTo(map);
  wpLayer = L.layerGroup().addTo(map);
  map.setView([0, 0], 2);
  mapReady = true;
}

function drawTrail() {
  if (!mapReady) return;
  const pts = state.trail.map(p => [p.lat, p.lon]);
  trailLine.setLatLngs(pts);
  wpLayer.clearLayers();
  const h = home();
  if (h) L.marker([h.lat, h.lon]).addTo(wpLayer).bindPopup('Start');
  for (const w of state.waypoints) L.marker([w.lat, w.lon]).addTo(wpLayer).bindPopup(w.name);
  if (state.current) {
    const ll = [state.current.lat, state.current.lon];
    if (!curMarker) curMarker = L.circleMarker(ll, { radius: 7, color: '#36d399', fillColor: '#36d399', fillOpacity: 1 }).addTo(map);
    else curMarker.setLatLng(ll);
  }
  if (pts.length) map.fitBounds(trailLine.getBounds().pad(0.3));
}

function toggleMap() {
  const hidden = els.map.classList.contains('hidden');
  if (hidden) {
    els.map.classList.remove('hidden');
    els.mapHint.classList.remove('hidden');
    els.mapToggle.textContent = 'Hide map ▴';
    if (typeof L === 'undefined') {
      els.mapHint.textContent = 'Map library not loaded (no internet). Arrow above still works.';
      return;
    }
    ensureMap();
    setTimeout(() => { map.invalidateSize(); drawTrail(); }, 50);
  } else {
    els.map.classList.add('hidden');
    els.mapHint.classList.add('hidden');
    els.mapToggle.textContent = 'Show map ▾';
  }
}

// ---------- events ----------
els.errDismiss.addEventListener('click', hideErr);
els.errRetry.addEventListener('click', () => { hideErr(); start(); });
els.preflightOk.addEventListener('click', doStart);
els.preflightCancel.addEventListener('click', hidePreflight);
els.start.addEventListener('click', () => { hideErr(); start(); });
els.stop.addEventListener('click', stop);
els.mark.addEventListener('click', markWaypoint);
els.clear.addEventListener('click', clearAll);
els.mapToggle.addEventListener('click', toggleMap);
els.targetSelect.addEventListener('change', e => { state.targetId = e.target.value; render(); });
els.wpList.addEventListener('click', e => {
  const go = e.target.getAttribute('data-go');
  const del = e.target.getAttribute('data-del');
  if (go) { state.targetId = go; els.targetSelect.value = go; render(); }
  if (del) deleteWaypoint(del);
});

// ---------- boot ----------
load();
refreshTargetOptions();
renderWaypointList();
render();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
