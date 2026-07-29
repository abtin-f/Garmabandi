/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Service Worker â€” Ú¯Ø±Ù…Ø§Ø¨Ù†Ø¯ÛŒ Ø³Ø§Ø®ØªÙ…Ø§Ù† (PWA)
   â€¢ versioned cache â†’ old caches purged on each release
   â€¢ app shell precached for offline use
   â€¢ navigations: network-first (fresh pages online, cached when offline)
   â€¢ static assets: stale-while-revalidate (fast + auto-updates)
   â€¢ /api/* is NEVER cached (always live)
   bump VERSION on every deploy so clients pick up new assets.
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const VERSION = '2.2.0';
const CACHE = 'tb-' + VERSION;

/* app shell â€” kept resilient: a 404 on any single item won't fail install */
const SHELL = [
  '/', '/index.html', '/shop.html', '/qr.html', '/about.html', '/contact.html',
  '/dashboard.html', '/detail.html', '/checkout.html', '/terms.html', '/404.html',
  '/assets/styles.css', '/assets/app.js', '/assets/icons.js', '/assets/fonts.css',
  '/assets/fonts/Vazirmatn-Regular.woff2', '/assets/fonts/Vazirmatn-SemiBold.woff2',
  '/assets/fonts/Vazirmatn-Bold.woff2', '/assets/fonts/Vazirmatn-ExtraBold.woff2',
  '/assets/fonts/Vazirmatn-Black.woff2',
  '/assets/favicon.svg', '/assets/favicon-32.png', '/assets/apple-touch-icon.png',
  '/assets/icon-192.png', '/assets/icon-512.png', '/assets/icon-maskable-512.png',
  '/assets/book-cover-hero.png', '/manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* allow the page to tell a waiting SW to take over immediately */
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   /* leave cross-origin alone */
  if (url.pathname.startsWith('/api/')) return;        /* never cache the API */

  /* user-uploaded media: network, fall back to cache when offline */
  if (url.pathname.startsWith('/uploads/')) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  /* page navigations â†’ network-first, fall back to cache, then offline shell */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return r; })
        .catch(() => caches.match(req).then((m) => m || caches.match('/index.html')))
    );
    return;
  }

  /* static assets â†’ stale-while-revalidate */
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((r) => {
        if (r && r.status === 200 && r.type === 'basic') {
          const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp));
        }
        return r;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
