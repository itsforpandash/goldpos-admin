self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Cache static assets
  if (event.request.url.startsWith('/assets/') || 
      event.request.url.endsWith('.css') ||
      event.request.url.endsWith('.js')) {
    event.respondWith(
      caches.open('goldpos-v1').then((cache) => {
        return cache.match(event.request).then((response) => {
          return response || fetch(event.request).then((fetchResponse) => {
            cache.put(event.request, fetchResponse.clone());
            return fetchResponse;
          });
        });
      }).catch(() => fetch(event.request))
    );
  } else {
    event.respondWith(fetch(event.request));
  }
});
