/* HOMS TECH Admin PWA service worker.
   Deliberately does not cache admin pages, API responses, or customer data. */
self.addEventListener("install", () => {
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
