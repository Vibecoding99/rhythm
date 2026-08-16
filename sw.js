const CACHE_NAME = "rhythm-v12";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./icons/icon.svg",
  "./icons/icon-32.png",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./js/app.js",
  "./js/components/backup-banner.js",
  "./js/components/dialogs.js",
  "./js/components/entry-form.js",
  "./js/components/goal-form.js",
  "./js/components/settings.js",
  "./js/components/sheet.js",
  "./js/lib/backup.js",
  "./js/lib/color.js",
  "./js/lib/date.js",
  "./js/lib/emoji.js",
  "./js/lib/goals.js",
  "./js/lib/id.js",
  "./js/lib/photos.js",
  "./js/lib/store.js",
  "./js/lib/sync.js",
  "./js/views/day.js",
  "./js/views/goals.js",
  "./js/views/month.js",
  "./js/views/summary.js",
  "./js/views/week.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ---------- Push notifications ----------
self.addEventListener("push", (event) => {
  let data = { title: "Rhythm", body: "" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {
    // Non-JSON payload — fall back to the default title/body.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ("focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("./index.html");
    })
  );
});

// Cache-first for same-origin GET requests, falling back to network and
// topping up the cache; navigations fall back to the shell when offline.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => {
          if (req.mode === "navigate") return caches.match("./index.html");
          return caches.match("./");
        });
    })
  );
});
