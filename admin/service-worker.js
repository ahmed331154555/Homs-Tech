/* HOMS TECH Admin PWA service worker.
   No admin pages, API responses, or customer data are cached. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
