// Service worker: la app abre sin conexión y las listas ya vistas también.
// - Archivos propios: "red primero" (siempre la versión más nueva; la copia es solo el respaldo).
// - Listas de /api (portada, rankings, búsquedas): "red primero" también; si no hay conexión o el servidor falla,
//   se muestra la última copia y la respuesta lleva x-pulso-stale con la hora en que se guardó, para decir "datos de hace X".
// - Nunca se guarda nada personal: /api/auth, /api/profile, /api/config y /api/health quedan afuera.
const CACHE = 'pulso-v6', API_CACHE = 'pulso-api-v1', API_MAX = 80;
const SHELL = ['/', '/css/style.css', '/favicon.svg', '/manifest.webmanifest', '/privacidad.html',
  '/js/app.js', '/js/util.js', '/js/state.js', '/js/auth.js', '/js/dialog.js', '/js/player.js', '/js/cards.js', '/js/views.js', '/js/onboarding.js', '/js/recommender.js', '/js/shared.js', '/js/platforms.js'];
const cacheableApi = p => p.startsWith('/api/') && !/^\/api\/(auth|profile|config|health)(\/|$)/.test(p);

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== API_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function staleFromCache(request) {
  const hit = await caches.match(request, { cacheName: API_CACHE });
  if (!hit) return null;
  const h = new Headers(hit.headers); h.set('x-pulso-stale', h.get('x-pulso-saved') || '1');
  return new Response(await hit.blob(), { status: 200, headers: h });
}
async function apiFirst(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const body = await res.clone().blob(), h = new Headers(res.headers); h.set('x-pulso-saved', String(Date.now()));
      h.delete('content-encoding'); h.delete('content-length'); // el cuerpo guardado ya viene descomprimido
      const c = await caches.open(API_CACHE); await c.put(request, new Response(body, { status: 200, headers: h }));
      const keys = await c.keys(); if (keys.length > API_MAX) await Promise.all(keys.slice(0, keys.length - API_MAX).map(k => c.delete(k))); // sin crecer sin límite
      return res;
    }
    return (res.status >= 500 && await staleFromCache(request)) || res; // el servidor falló: mejor la última copia que un error
  } catch {
    return (await staleFromCache(request)) || Response.error();
  }
}
self.addEventListener('fetch', e => {
  const { request } = e, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) { if (cacheableApi(url.pathname)) e.respondWith(apiFirst(request)); return; }
  e.respondWith(fetch(request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(request, copy)); }
    return res;
  }).catch(() => caches.match(request).then(r => r || caches.match('/'))));
});
