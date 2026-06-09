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

function accuracy(fix) {
  return Number.isFinite(fix && fix.acc) ? fix.acc : null;
}

function isWeakFix(fix) {
  const acc = accuracy(fix);
  return acc != null && acc > GPS_MAX_ACCURACY;
}

function isWithinGpsNoise(prev, fix) {
  if (!prev || !fix) return false;
  const acc = Math.max(accuracy(prev) || 0, accuracy(fix) || 0);
  return acc >= GPS_JITTER_MIN_ACC &&
    distance(prev, fix) <= Math.max(RECORD_MIN_DIST, acc * GPS_JITTER_FACTOR);
}

function isLikelyGpsJump(prev, fix) {
  if (!prev || !fix) return false;
  const dt = (fix.t - prev.t) / 1000;
  if (dt <= 0 || dt > GAP_WARN_MS / 1000) return false;
  const acc = Math.max(accuracy(prev) || 0, accuracy(fix) || 0);
  return acc >= GPS_JITTER_MIN_ACC && distance(prev, fix) / dt > GPS_JUMP_SPEED;
}

function smoothFix(prev, fix) {
  if (!prev || fix.t - prev.t > GAP_WARN_MS || !isWithinGpsNoise(prev, fix)) return fix;
  return {
    ...fix,
    lat: prev.lat + (fix.lat - prev.lat) * GPS_SMOOTH_ALPHA,
    lon: prev.lon + (fix.lon - prev.lon) * GPS_SMOOTH_ALPHA,
  };
}

// ---------- state ----------
const RECORD_MIN_DIST = 5;     // meters: only store a breadcrumb if moved this far
const RECORD_MIN_TIME = 8000;  // ms: ...or this long since last stored point
const ARRIVE_RADIUS = 8;       // meters: "you are here"
const GAP_WARN_MS = 60000;     // ms: gap this long means screen was probably locked
const GPS_MAX_ACCURACY = 75;   // meters: worse fixes are usually indoor noise
const GPS_JITTER_MIN_ACC = 20; // meters: apply noise filtering only to weak fixes
const GPS_JITTER_FACTOR = 1.2; // ignore stored movement inside this accuracy radius
const GPS_JUMP_SPEED = 8;      // m/s: likely not walking if accuracy is weak
const GPS_SMOOTH_ALPHA = 0.25; // blend small noisy movements instead of jumping
const LS_KEY_V1 = 'breadcrumb.v1';
const LS_KEY_V2 = 'breadcrumb.v2';

const state = {
  records: [],        // [{id,name,trail,waypoints,createdAt,updatedAt}]
  activeRecordId: null,
  trail: [],          // [{lat,lon,alt,acc,t}]
  waypoints: [],      // [{id,name,lat,lon,alt,t}]
  current: null,      // latest fix
  heading: null,      // compass degrees from true north
  targetId: 'home',   // 'home' | waypoint id
  pendingMode: null,  // 'recording' | 'finding'
  lastMode: 'recording',
  watchId: null,
  wakeLock: null,
  tracking: false,
  recording: false,
  lastStored: 0,
  needsSegmentBreak: false,
  gapTimer: null,
};

// ---------- persistence ----------
function defaultRecordName(t = Date.now()) {
  return 'Trail ' + new Date(t).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function makeRecord(name, data = {}) {
  const now = Date.now();
  const label = (name || data.name || defaultRecordName(data.createdAt || now)).trim();
  return {
    id: data.id || ('rec' + now + '-' + Math.random().toString(36).slice(2, 8)),
    name: label || defaultRecordName(data.createdAt || now),
    trail: Array.isArray(data.trail) ? data.trail : [],
    waypoints: Array.isArray(data.waypoints) ? data.waypoints : [],
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
  };
}

function normalizeRecord(r) {
  const createdAt = Number.isFinite(r && r.createdAt) ? r.createdAt : Date.now();
  return makeRecord(r && r.name, {
    id: r && r.id,
    trail: r && r.trail,
    waypoints: r && r.waypoints,
    createdAt,
    updatedAt: Number.isFinite(r && r.updatedAt) ? r.updatedAt : createdAt,
  });
}

function activeRecord() {
  return state.records.find(r => r.id === state.activeRecordId) || null;
}

function ensureActiveRecord() {
  let rec = activeRecord();
  if (!rec) {
    rec = makeRecord();
    state.records.push(rec);
    state.activeRecordId = rec.id;
  }
  state.trail = rec.trail;
  state.waypoints = rec.waypoints;
  return rec;
}

function touchActiveRecord() {
  const rec = ensureActiveRecord();
  rec.updatedAt = Date.now();
}

function save() {
  localStorage.setItem(LS_KEY_V2, JSON.stringify({
    records: state.records,
    activeRecordId: state.activeRecordId,
  }));
}

function load() {
  try {
    const v2 = JSON.parse(localStorage.getItem(LS_KEY_V2) || '{}');
    if (Array.isArray(v2.records) && v2.records.length) {
      state.records = v2.records.map(normalizeRecord);
      state.activeRecordId = state.records.some(r => r.id === v2.activeRecordId)
        ? v2.activeRecordId
        : state.records[0].id;
      ensureActiveRecord();
      return;
    }
  } catch { /* corrupt -> try legacy */ }

  try {
    const d = JSON.parse(localStorage.getItem(LS_KEY_V1) || '{}');
    if ((Array.isArray(d.trail) && d.trail.length) ||
        (Array.isArray(d.waypoints) && d.waypoints.length)) {
      const rec = makeRecord('Imported trail', {
        trail: d.trail || [],
        waypoints: d.waypoints || [],
        createdAt: (d.trail && d.trail[0] && d.trail[0].t) || Date.now(),
      });
      state.records = [rec];
      state.activeRecordId = rec.id;
      ensureActiveRecord();
      save();
      return;
    }
  } catch { /* corrupt -> ignore */ }

  ensureActiveRecord();
  save();
}

// ---------- dom ----------
const $ = id => document.getElementById(id);
const els = {
  status: $('status'), arrow: $('arrow'), noHeading: $('noHeading'),
  dist: $('distOut'), bear: $('bearOut'), altDiff: $('altDiffOut'),
  acc: $('accOut'), alt: $('altOut'), head: $('headOut'), ptCount: $('ptCountOut'),
  targetLabel: $('targetLabel'), targetSelect: $('targetSelect'),
  recordSelect: $('recordSelect'),
  newRecord: $('newRecordBtn'), renameRecord: $('renameRecordBtn'), deleteRecord: $('deleteRecordBtn'),
  start: $('startBtn'), find: $('findBtn'), mark: $('markBtn'), stop: $('stopBtn'), clear: $('clearBtn'),
  map: $('map'), mapToggle: $('mapToggle'), mapHint: $('mapHint'),
  wpList: $('wpList'), lockHint: $('lockHint'),
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
function statusText() {
  return state.recording ? 'recording' : 'finding';
}

function syncControls() {
  const active = state.tracking;
  els.start.disabled = active;
  els.find.disabled = active;
  els.stop.disabled = !active;
  els.mark.disabled = !state.recording;
  els.recordSelect.disabled = state.recording;
  els.newRecord.disabled = active;
  els.renameRecord.disabled = active;
  els.deleteRecord.disabled = active;
  els.clear.disabled = active;
  els.lockHint.classList.toggle('hidden', !state.recording);
}

function startWatch() {
  if (state.watchId != null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = navigator.geolocation.watchPosition(onFix, onGeoError, {
    enableHighAccuracy: true, maximumAge: 0, timeout: 15000,
  });
}

async function startRecording() {
  await startLocation('recording');
}

async function startFinding() {
  await startLocation('finding');
}

async function startLocation(mode) {
  if (!('geolocation' in navigator)) { setStatus('no GPS', 'error'); return; }
  if (!window.isSecureContext) {
    showErr('HTTPS required', 'This page must be served over HTTPS for GPS to work. See README.', false);
    return;
  }
  if (state.tracking) return;
  hideErr();
  state.pendingMode = mode;
  state.lastMode = mode;

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
    state.pendingMode = null;
    showErr(
      'Location permanently blocked',
      'Permission was previously denied. To fix: open browser Settings → Site settings → Location → find this site → set to Allow, then reload.',
      false
    );
    return;
  }

  if (permState === 'prompt') {
    // Show pre-flight modal — user clears overlays, then taps Continue which calls doStart().
    showPreflight();
    return;
  }

  // 'granted' — go directly, no dialog will appear, overlay apps don't matter
  await doStart(mode);
}

async function doStart(mode = state.pendingMode || 'recording') {
  hidePreflight();
  await requestCompass();   // iOS needs this from a tap
  await requestWakeLock();  // keep screen awake so tracking continues

  ensureActiveRecord();
  state.tracking = true;
  state.recording = mode === 'recording';
  state.lastMode = mode;
  state.pendingMode = null;
  if (state.recording) {
    const last = state.trail[state.trail.length - 1];
    state.lastStored = last ? last.t : 0;
    state.needsSegmentBreak = state.trail.length > 0;
  } else {
    state.needsSegmentBreak = false;
  }
  syncControls();
  setStatus('locating…', 'tracking');
  startWatch();
}

function stop() {
  if (state.watchId != null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null;
  state.tracking = false;
  state.recording = false;
  state.pendingMode = null;
  state.needsSegmentBreak = false;
  clearTimeout(state.gapTimer);
  releaseWakeLock();
  syncControls();
  setStatus('stopped', 'idle');
}

function onFix(pos) {
  const c = pos.coords;
  let fix = {
    lat: c.latitude, lon: c.longitude,
    alt: c.altitude, acc: c.accuracy,
    altAcc: c.altitudeAccuracy, t: pos.timestamp,
  };
  const prevCurrent = state.current;
  if (isWeakFix(fix) && (prevCurrent || state.recording)) {
    setStatus('weak GPS ~' + Math.round(fix.acc) + 'm', 'tracking');
    render();
    return;
  }
  if (isLikelyGpsJump(prevCurrent, fix)) {
    setStatus('GPS jump ignored', 'tracking');
    render();
    return;
  }
  fix = smoothFix(prevCurrent, fix);
  state.current = fix;

  if (!state.recording) {
    setStatus('finding', 'tracking');
    drawTrail();
    render();
    return;
  }

  // First ever point becomes home. Gaps start a new segment so the map never
  // draws a fake straight line across screen-lock or app-restart movement.
  const isFirst = state.trail.length === 0;
  const last = state.trail[state.trail.length - 1];
  const gapMs = last ? pos.timestamp - last.t : 0;
  const startsNewSegment = !isFirst && (state.needsSegmentBreak || gapMs > GAP_WARN_MS);
  const moved = last ? distance(last, fix) : Infinity;
  const elapsed = last ? pos.timestamp - last.t : Infinity;
  const jitter = !isFirst && !startsNewSegment && isWithinGpsNoise(last, fix);

  if (gapMs > GAP_WARN_MS) {
    const mins = Math.round(gapMs / 60000);
    setStatus('gap ~' + mins + 'min (new segment)', 'tracking');
    clearTimeout(state.gapTimer);
    state.gapTimer = setTimeout(() => {
      if (state.tracking) setStatus(statusText(), 'tracking');
    }, 5000);
  } else {
    setStatus('recording', 'tracking');
  }

  if (isFirst || startsNewSegment || (!jitter && (moved >= RECORD_MIN_DIST || elapsed >= RECORD_MIN_TIME))) {
    if (startsNewSegment) fix.breakBefore = true;
    state.trail.push(fix);
    state.lastStored = pos.timestamp;
    state.needsSegmentBreak = false;
    touchActiveRecord();
    save();
    refreshRecordOptions();
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

// EMA smoothing on unit-vector components (handles 0°/360° wrap correctly:
// averaging 359° and 1° must yield 0°, NOT 180° — so we average sin/cos, not degrees).
// Lower HEADING_EMA = smoother but laggier. 0.15 ≈ ~7 samples to settle.
const HEADING_EMA = 0.15;
const HEADING_DEADBAND = 0.8; // °: skip render if smoothed change is below this
let sumSin = 0, sumCos = 0, headingInit = false;
let arrowAngle = 0; // accumulated arrow rotation in degrees (no wrap)

function onOrient(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number') {
    h = e.webkitCompassHeading;            // iOS: true north, clockwise
  } else if (e.absolute && typeof e.alpha === 'number') {
    h = (360 - e.alpha) % 360;             // android absolute
  } else if (typeof e.alpha === 'number') {
    h = (360 - e.alpha) % 360;             // fallback (may drift)
  }
  if (h == null || Number.isNaN(h)) return;

  const r = toRad(h), s = Math.sin(r), c = Math.cos(r);
  if (!headingInit) { sumSin = s; sumCos = c; headingInit = true; }
  else {
    sumSin = sumSin * (1 - HEADING_EMA) + s * HEADING_EMA;
    sumCos = sumCos * (1 - HEADING_EMA) + c * HEADING_EMA;
  }
  const smoothed = (toDeg(Math.atan2(sumSin, sumCos)) + 360) % 360;

  // Deadband — small short-angle delta means jitter, ignore
  if (state.heading != null) {
    let d = Math.abs(smoothed - state.heading);
    if (d > 180) d = 360 - d; // shortest angular distance
    if (d < HEADING_DEADBAND) return;
  }
  state.heading = smoothed;
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
// Screen unlocked: re-acquire wake lock AND restart watchPosition (OS may have killed it).
document.addEventListener('visibilitychange', () => {
  if (state.recording && document.visibilityState === 'hidden') {
    state.needsSegmentBreak = true;
  }
  if (state.tracking && document.visibilityState === 'visible') {
    if (!state.wakeLock) requestWakeLock();
    startWatch();
  }
});

// ---------- trajectory records ----------
function recordOptionLabel(rec) {
  const pts = rec.trail.length;
  const wp = rec.waypoints.length;
  return rec.name + ' · ' + pts + ' pt' + (pts === 1 ? '' : 's') +
    (wp ? ' · ' + wp + ' wp' : '');
}

function refreshRecordOptions() {
  const sel = els.recordSelect;
  const prev = state.activeRecordId;
  sel.innerHTML = '';
  for (const rec of state.records) {
    const el = document.createElement('option');
    el.value = rec.id;
    el.textContent = recordOptionLabel(rec);
    sel.appendChild(el);
  }
  if (state.records.some(r => r.id === prev)) sel.value = prev;
}

function selectRecord(id) {
  if (state.recording) return;
  const rec = state.records.find(r => r.id === id);
  if (!rec) return;
  state.activeRecordId = rec.id;
  state.trail = rec.trail;
  state.waypoints = rec.waypoints;
  state.targetId = 'home';
  state.lastStored = state.trail.length ? state.trail[state.trail.length - 1].t : 0;
  state.needsSegmentBreak = false;
  save();
  refreshRecordOptions();
  refreshTargetOptions();
  renderWaypointList();
  drawTrail();
  render();
}

function createRecord() {
  if (state.tracking) return;
  const name = prompt('Name this trajectory:', defaultRecordName());
  if (name === null) return;
  const rec = makeRecord(name.trim() || defaultRecordName());
  state.records.push(rec);
  selectRecord(rec.id);
}

function renameRecord() {
  if (state.tracking) return;
  const rec = ensureActiveRecord();
  const name = prompt('Rename trajectory:', rec.name);
  if (name === null) return;
  rec.name = name.trim() || rec.name;
  rec.updatedAt = Date.now();
  save();
  refreshRecordOptions();
}

function deleteRecord() {
  if (state.tracking) return;
  const rec = ensureActiveRecord();
  if (!confirm('Delete "' + rec.name + '"? This removes its trail and waypoints.')) return;
  const idx = state.records.findIndex(r => r.id === rec.id);
  state.records = state.records.filter(r => r.id !== rec.id);
  if (!state.records.length) state.records.push(makeRecord());
  const next = state.records[Math.max(0, Math.min(idx, state.records.length - 1))];
  state.activeRecordId = next.id;
  ensureActiveRecord();
  state.targetId = 'home';
  state.lastStored = state.trail.length ? state.trail[state.trail.length - 1].t : 0;
  state.needsSegmentBreak = false;
  save();
  refreshRecordOptions();
  refreshTargetOptions();
  renderWaypointList();
  drawTrail();
  render();
}

function setTarget(id) {
  state.targetId = id;
  render();
  drawTrail();
}

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
  touchActiveRecord();
  save();
  refreshRecordOptions();
  refreshTargetOptions();
  renderWaypointList();
  drawTrail();
}

function deleteWaypoint(id) {
  const rec = ensureActiveRecord();
  rec.waypoints = state.waypoints.filter(w => w.id !== id);
  state.waypoints = rec.waypoints;
  if (state.targetId === id) state.targetId = 'home';
  touchActiveRecord();
  save();
  refreshRecordOptions();
  refreshTargetOptions();
  renderWaypointList();
  drawTrail();
  render();
}

function clearAll() {
  if (state.tracking) return;
  const rec = ensureActiveRecord();
  if (!confirm('Erase "' + rec.name + '" trail and waypoints? The record stays in the list.')) return;
  state.trail.length = 0;
  state.waypoints.length = 0;
  state.targetId = 'home';
  state.lastStored = 0;
  state.needsSegmentBreak = false;
  touchActiveRecord();
  save();
  refreshRecordOptions();
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
  els.targetLabel.textContent = 'Direct target: ';
  const targetText = document.createElement('b');
  targetText.textContent = targetName();
  els.targetLabel.appendChild(targetText);

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

  // rotate arrow: bearing relative to where phone points.
  // Accumulate continuous angle so CSS transition rotates the short way
  // (raw "brg - heading" can jump 359°→0°, causing a full spin).
  const arrived = d <= ARRIVE_RADIUS;
  els.arrow.classList.toggle('on-target', arrived);
  if (arrived) {
    els.arrow.textContent = '✓';
    els.arrow.style.transform = 'rotate(0deg)';
    els.noHeading.classList.add('hidden');
  } else {
    els.arrow.textContent = '↑';
    let target;
    if (state.heading != null) {
      target = brg - state.heading;
      els.noHeading.classList.add('hidden');
    } else {
      target = brg;
      els.noHeading.classList.remove('hidden');
    }
    // unwrap to nearest equivalent of last shown angle
    const last = arrowAngle;
    let diff = ((target - last + 540) % 360) - 180; // -180..180
    arrowAngle = last + diff;
    els.arrow.style.transform = 'rotate(' + arrowAngle + 'deg)';
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
    const empty = document.createElement('span');
    empty.className = 'wp-sub';
    empty.textContent = 'No trail yet. Tap Rec to begin.';
    li.appendChild(empty);
    ul.appendChild(li);
    return;
  }
  for (const r of rows) {
    const li = document.createElement('li');
    const sub = r.lat.toFixed(5) + ', ' + r.lon.toFixed(5) + ' · ' + fmtAlt(r.alt);
    const main = document.createElement('div');
    main.className = 'wp-main';
    const name = document.createElement('div');
    name.className = 'wp-name';
    name.textContent = r.name;
    const detail = document.createElement('div');
    detail.className = 'wp-sub';
    detail.textContent = sub;
    const go = document.createElement('button');
    go.className = 'wp-go';
    go.setAttribute('data-go', r.id);
    go.textContent = 'Go';
    main.appendChild(name);
    main.appendChild(detail);
    li.appendChild(main);
    li.appendChild(go);
    if (!r.fixed) {
      const del = document.createElement('button');
      del.className = 'wp-del';
      del.setAttribute('data-del', r.id);
      del.textContent = '✕';
      li.appendChild(del);
    }
    ul.appendChild(li);
  }
}

// ---------- map (optional, Leaflet) ----------
let map = null, trailLayer = null, targetLayer = null, curMarker = null, wpLayer = null, mapReady = false;

function trailSegments() {
  const segments = [];
  let segment = [];
  for (const p of state.trail) {
    if (p.breakBefore && segment.length) {
      segments.push(segment);
      segment = [];
    }
    segment.push([p.lat, p.lon]);
  }
  if (segment.length) segments.push(segment);
  return segments;
}

function ensureMap() {
  if (mapReady || typeof L === 'undefined') return;
  map = L.map('map', { zoomControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap',
  }).addTo(map);
  trailLayer = L.layerGroup().addTo(map);
  wpLayer = L.layerGroup().addTo(map);
  targetLayer = L.layerGroup().addTo(map);
  map.setView([0, 0], 2);
  mapReady = true;
}

function drawTrail() {
  if (!mapReady) return;
  const pts = state.trail.map(p => [p.lat, p.lon]);
  const fitPts = pts.slice();
  trailLayer.clearLayers();
  for (const segment of trailSegments()) {
    if (segment.length > 1) {
      L.polyline(segment, { color: '#2ea0ff', weight: 4 }).addTo(trailLayer);
    }
  }
  wpLayer.clearLayers();
  const h = home();
  if (h) L.marker([h.lat, h.lon]).addTo(wpLayer).bindPopup('Start');
  for (const w of state.waypoints) {
    const popup = document.createElement('span');
    popup.textContent = w.name;
    L.marker([w.lat, w.lon]).addTo(wpLayer).bindPopup(popup);
  }
  targetLayer.clearLayers();
  const tgt = targetPoint();
  if (tgt) {
    const targetPopup = document.createElement('span');
    targetPopup.textContent = 'Target: ' + targetName();
    L.circleMarker([tgt.lat, tgt.lon], {
      radius: 10,
      color: '#ffb020',
      weight: 3,
      fillColor: '#ffb020',
      fillOpacity: 0.35,
    }).addTo(targetLayer).bindPopup(targetPopup);
    fitPts.push([tgt.lat, tgt.lon]);
    if (state.current) {
      L.polyline([
        [state.current.lat, state.current.lon],
        [tgt.lat, tgt.lon],
      ], {
        color: '#ffb020',
        weight: 2,
        dashArray: '6 8',
      }).addTo(targetLayer);
    }
  }
  if (state.current) {
    const ll = [state.current.lat, state.current.lon];
    if (!curMarker) curMarker = L.circleMarker(ll, { radius: 7, color: '#36d399', fillColor: '#36d399', fillOpacity: 1 }).addTo(map);
    else curMarker.setLatLng(ll);
    fitPts.push(ll);
  }
  if (fitPts.length) map.fitBounds(L.latLngBounds(fitPts).pad(0.3));
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
els.errRetry.addEventListener('click', () => { hideErr(); startLocation(state.pendingMode || state.lastMode); });
els.preflightOk.addEventListener('click', () => doStart());
els.preflightCancel.addEventListener('click', () => { state.pendingMode = null; hidePreflight(); });
els.recordSelect.addEventListener('change', e => selectRecord(e.target.value));
els.newRecord.addEventListener('click', createRecord);
els.renameRecord.addEventListener('click', renameRecord);
els.deleteRecord.addEventListener('click', deleteRecord);
els.start.addEventListener('click', () => { hideErr(); startRecording(); });
els.find.addEventListener('click', () => { hideErr(); startFinding(); });
els.stop.addEventListener('click', stop);
els.mark.addEventListener('click', markWaypoint);
els.clear.addEventListener('click', clearAll);
els.mapToggle.addEventListener('click', toggleMap);
els.targetSelect.addEventListener('change', e => setTarget(e.target.value));
els.wpList.addEventListener('click', e => {
  const go = e.target.getAttribute('data-go');
  const del = e.target.getAttribute('data-del');
  if (go) { els.targetSelect.value = go; setTarget(go); }
  if (del) deleteWaypoint(del);
});

// ---------- boot ----------
load();
refreshRecordOptions();
refreshTargetOptions();
renderWaypointList();
render();
syncControls();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
