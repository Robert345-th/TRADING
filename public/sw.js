// Minimal service worker - just enough to make the app installable.
// It doesn't cache anything aggressively since the dashboard needs
// fresh live data every time, not stale offline data.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Pass every request straight through to the network (no offline caching),
// since a trading dashboard showing stale/cached numbers would be dangerous.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
