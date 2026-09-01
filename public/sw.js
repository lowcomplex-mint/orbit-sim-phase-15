/* Pass-through SW: required for Add-to-Home-Screen, but must NOT cache
 * Vite HTML/modules or a dead USB reverse leaves a white screen forever. */
const CACHE = 'orbit-sim-passthrough-1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.delete(CACHE));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
