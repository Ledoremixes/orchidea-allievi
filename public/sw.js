const CACHE_VERSION = "orchidea-allievi-push-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text?.() || "Hai una nuova notifica Orchidea." };
  }

  const title = payload.title || "Orchidea Allievi";
  const options = {
    body: payload.body || "Hai una nuova notifica.",
    icon: payload.icon || "/icons/icon-192.png",
    badge: payload.badge || "/icons/icon-96.png",
    image: payload.image || undefined,
    tag: payload.tag || `orchidea-${Date.now()}`,
    renotify: Boolean(payload.renotify),
    vibrate: [120, 60, 120],
    data: {
      url: payload.url || payload.link || "/",
      notificationId: payload.notificationId || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(targetUrl);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
