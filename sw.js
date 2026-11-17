// sw.js: lets JARVIS open instantly and work offline (the app screens, not the AI).
// Bump CACHE when you change any app file so phones pick up the new version.
const CACHE = 'jarvis-v2.0.0';
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/agents.js',
  './js/llm.js',
  './js/memory.js',
  './js/security.js',
  './js/store.js',
  './js/voice.js',
  './js/web.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// App files: network first (so updates arrive), cache as fallback when offline.
// Requests to other sites (the AI brain) are never cached.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
