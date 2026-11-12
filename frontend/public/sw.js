// CACHE_NAME and APP_SHELL_ASSETS are filled from the production output by
// scripts/generate-sw.js. The empty defaults keep the Vite dev server valid.
const CACHE_NAME = "foodie-shell-dev";
const APP_SHELL_ASSETS = [];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(APP_SHELL_ASSETS.map((asset) => cache.add(asset).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames.filter((name) => name.startsWith("foodie-shell-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/@vite/") || url.pathname.startsWith("/@fs/") || url.search.includes("t=")) return;

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200) return networkResponse;
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
        return networkResponse;
      }).catch(() => {
        if (request.mode === "navigate") {
          return caches.match("/index.html").then((response) => response || caches.match("/"));
        }
        return new Response("Recurso no disponible sin conexión", {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "Content-Type": "text/plain" },
        });
      });
    }),
  );
});

self.addEventListener("push", (event) => {
  let data = {
    title: "Nueva actividad",
    body: "Hay una actividad nueva en tu comunidad.",
    url: "/feed",
  };
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }

  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: "/icons/icon-192x192.png",
    data: { url: data.url || "/feed" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/feed", self.location.origin);
  const targetUrl = target.origin === self.location.origin
    ? `${target.pathname}${target.search}${target.hash}`
    : "/feed";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      const sameOriginClient = windowClients.find((client) => {
        try {
          return new URL(client.url).origin === self.location.origin;
        } catch {
          return false;
        }
      });

      if (sameOriginClient) {
        sameOriginClient.postMessage({ type: "NAVIGATE", url: targetUrl });
        return sameOriginClient.focus();
      }
      return self.clients.openWindow(`${self.location.origin}${targetUrl}`);
    }),
  );
});
