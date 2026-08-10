const CACHE_NAME = "receiptbuddy-v6";
const APP_SHELL = [
  "/",
  "/?v=6",
  "/index.html",
  "/styles.css",
  "/styles.css?v=6",
  "/app.mjs",
  "/app.mjs?v=6",
  "/manifest.json",
  "/manifest.json?v=6",
  "/assets/icon.svg",
  "/assets/receipt-scan-hero.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const isAppFile = url.origin === self.location.origin;

  if (isAppFile) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});