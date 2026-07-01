// 資生國際 Shisei Dental service worker — minimal offline-aware shell cache.
// Strategy:
//   - Static shell (HTML/CSS/JS/icons): network-first with cache fallback
//   - API calls: network-only (never cache, prices and tier matter)
//   - Uploaded media: cache-first (immutable URLs)

const CACHE = 'shisei-v1';
const SHELL = [
  '/',
  '/shop.html',
  '/login.html',
  '/account.html',
  '/css/style.css',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache API responses — they depend on auth/tier/voucher state.
  if (url.pathname.startsWith('/api/')) return;

  // Uploaded media: cache-first, since URLs are content-hashed.
  if (url.pathname.startsWith('/uploads/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // Shell: network-first; fall back to cache when offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
  );
});
