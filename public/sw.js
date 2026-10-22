/* Service Worker de Link Redes Servicios.
 * - Precachea el shell (lista inyectada en el build) para abrir sin conexión.
 * - Solo atiende recursos del mismo origen: NUNCA cachea respuestas de Supabase ni datos autenticados.
 * - Las actualizaciones se aplican de forma controlada (mensaje SKIP_WAITING desde la app). */
const VERSION = '__BUILD_VERSION__';
const CACHE = `lr-shell-${VERSION}`;
const PRECACHE = self.__PRECACHE__ || [];
const scope = self.registration.scope;
const abs = (p) => new URL(p, scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', ...PRECACHE].map(abs))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lr-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase y otros orígenes: sin intervención

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(abs('./')).then((r) => r || offlinePage())),
    );
    return;
  }
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })),
  );
});

function offlinePage() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sin conexión</title><body style="font-family:system-ui;padding:2rem"><h1>Sin conexión</h1><p>Abre la aplicación al menos una vez con Internet para poder usarla sin conexión.</p></body>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 },
  );
}
