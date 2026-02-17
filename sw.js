const CACHE = "habits-tracker-v1";
const ASSETS = ["index.html", "styles.css", "app.js", "manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.url.startsWith("http") && new URL(e.request.url).origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request).then((res) => {
        const clone = res.clone();
        if (res.status === 200 && ASSETS.some((a) => e.request.url.endsWith(a))) {
          caches.open(CACHE).then((cache) => cache.put(e.request, clone));
        }
        return res;
      }))
    );
  }
});
