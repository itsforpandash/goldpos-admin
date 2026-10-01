const CACHE_NAME = 'goldpos-static-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        // Drop every previous cache, including the old 'goldpos-v1' that the
        // cache-first strategy used to pin stale assets forever.
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  // Same-origin JS/CSS/bundled assets only; API calls, navigations and
  // cross-origin requests are left to the default network path.
  if (url.origin !== self.location.origin) return;
  const isStatic =
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/_astro/') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js');
  if (!isStatic) return;

  // Network-first so a redeploy is picked up immediately; cache is only the
  // offline fallback. The previous cache-first strategy served stale JS/CSS
  // forever (cache name never rotated), which kept broken UI alive after fixes.
  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || new Response('', { status: 504, statusText: 'Offline' })),
      ),
  );
});
