const CACHE_NAME = "habits-tracker-v1";
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./styles.css",
  "./favicon.svg",
  "./manifest.json",
  "./apple-touch-icon.png",
  "./icon-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

function getCacheKey(request) {
  const url = new URL(request.url);
  if (url.pathname.endsWith(".js") || url.pathname.endsWith(".html")) url.search = "";
  return url.href;
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith(".json") && url.search) return;
  const cacheKey = getCacheKey(e.request);
  e.respondWith(
    caches.match(cacheKey).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        const clone = res.clone();
        if (res.status === 200 && e.request.method === "GET") {
          caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, clone));
        }
        return res;
      }).catch(() => {
        if (e.request.mode === "navigate") return caches.match("./index.html").then((r) => r || new Response("", { status: 404 }));
        return caches.match(cacheKey).then((r) => r || new Response("", { status: 503 }));
      });
    })
  );
});
