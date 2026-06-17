/* Offline cache for the app shell.
   Strategy: NETWORK-FIRST for same-origin requests, so a new deploy shows up on
   the next online load instead of being pinned to the cache forever. The cache
   is only a fallback for when the network fails (offline). Map tiles and CDN
   scripts are cross-origin and pass straight through (never cached). */
const CACHE = 'breadcrumb-v8';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // CDN / OSM tiles pass through

  // Try the network first; refresh the cached copy on success. On failure
  // (offline) serve the cached response, falling back to the app shell.
  e.respondWith(
    fetch(e.request).then(res => {
      // Cache a fresh same-origin copy for offline use, but skip the big APK
      // downloads — they don't need to live in the app-shell cache.
      if (res.ok && url.pathname.indexOf('/downloads/') === -1) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
  );
});
