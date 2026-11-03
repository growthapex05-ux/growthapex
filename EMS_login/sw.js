// GrowthApex EMS service worker.
// Network-first for everything (no stale Firebase data cached); shows a small
// offline page only when a navigation fails with no connection. Its only job is
// to make the EMS installable as an app on Android and iPhone.
const OFFLINE_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline</title><style>html,body{height:100%;margin:0;font-family:system-ui,sans-serif;
background:#0e1627;color:#e5edf7;display:flex;align-items:center;justify-content:center;text-align:center}
.c{padding:28px;max-width:360px}h1{font-size:20px;margin:0 0 8px}p{color:#9fb2cc;line-height:1.6}
button{margin-top:16px;padding:11px 22px;border:0;border-radius:10px;color:#fff;font-weight:600;
background:linear-gradient(135deg,#1e40af,#0e7fb8,#10b981)}</style></head>
<body><div class="c"><h1>You're offline</h1><p>Check your internet connection to use GrowthApex.</p>
<button onclick="location.reload()">Retry</button></div></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html' } }))
    );
  }
  // All other requests use the network normally (no caching).
});
