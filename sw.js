/* City-Drop × Presta : reçoit les alertes quand l'appli est fermée. Il ne garde aucune copie des pages
   (pas de « fetch » ici) : l'appli se charge toujours en ligne, comme avant.
   L'alerte arrive vide ; on demande son texte au script Google avec le jeton secret de cet appareil. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    let titre = "City-Drop × Presta", texte = "Du nouveau dans l'appli.", url = "./";
    try {
      const cfg = await (await caches.open("presta-alertes")).match("./__alertes").then((r) => (r ? r.json() : null));
      if (cfg && cfg.url && cfg.jeton) {
        const stop = new AbortController();
        const t = setTimeout(() => stop.abort(), 8000);
        try {
          const d = await (await fetch(cfg.url + "?action=notif&jeton=" + encodeURIComponent(cfg.jeton), { signal: stop.signal, cache: "no-store" })).json();
          if (d && d.titre) { titre = d.titre; texte = d.texte || ""; url = d.url || url; }
        } finally { clearTimeout(t); }
      }
    } catch (err) {}
    /* Une alerte est toujours affichée, même sans texte (exigé par Apple). */
    await self.registration.showNotification(titre, { body: texte, tag: "presta", renotify: true, icon: "assets/icon-192.png", badge: "assets/icon-192.png", data: { url } });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope);
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.registration.scope));
    if (open) { open.postMessage({ type: "ouvrir", hash: url.hash.slice(1) }); return open.focus(); }
    return self.clients.openWindow(url.href);
  }));
});
