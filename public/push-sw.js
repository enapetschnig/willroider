// Push-Nachrichten im Service Worker. Wird von Workbox per importScripts
// in den generierten Service Worker geladen (vite.config.ts).
//
// Die Nachricht kommt als JSON: { title, body, url, tag }. Beim Antippen
// wird ein offenes App-Fenster nach vorne geholt und auf die Adresse
// geschickt, sonst ein neues geöffnet.

self.addEventListener("push", (event) => {
  let daten = { title: "Willroider App", body: "", url: "/", tag: "" };
  try {
    if (event.data) daten = { ...daten, ...event.data.json() };
  } catch {
    if (event.data) daten.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(daten.title, {
      body: daten.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: daten.tag || undefined,
      renotify: !!daten.tag,
      data: { url: daten.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const ziel = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((fenster) => {
      for (const f of fenster) {
        if ("focus" in f) {
          f.focus();
          if ("navigate" in f) return f.navigate(ziel).catch(() => undefined);
          return;
        }
      }
      return self.clients.openWindow(ziel);
    }),
  );
});
