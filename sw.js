// Service worker de Mis Notas: abre rápido y funciona sin conexión.
// Archivos propios: primero red (para tener siempre la última versión) y, si no hay internet, la copia guardada.
// Librerías externas (Supabase JS, fuentes, pdf.js): copia guardada primero.
// Nunca guarda datos de Supabase ni de /api.
const VERSION = 'misnotas-v4';
const SHELL = ['/', '/index.html', '/app.js', '/config.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const EXTERNOS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) return;
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copia = res.clone(); caches.open(VERSION).then(c => c.put(req, copia)); }
        return res;
      }).catch(async () => (await caches.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? caches.match('/') : Response.error()))
    );
    return;
  }

  if (EXTERNOS.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') { const copia = res.clone(); caches.open(VERSION).then(c => c.put(req, copia)); }
        return res;
      }))
    );
  }
});
