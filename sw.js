// Cache hors ligne. Incrémente VERSION à chaque modification des fichiers.
const VERSION = "calliboss-v7";
const FILES = ["./", "index.html", "style.css", "program.js", "firebase-config.js", "cloud.js", "app.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

// GitHub Pages laisse le navigateur garder chaque fichier 10 min : sans `cache`, une mise à jour
// arrive par morceaux (nouvel index.html avec l'ancien app.js). On passe donc outre ce cache-là.
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" })))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Réseau d'abord (pour recevoir les mises à jour), cache si hors ligne.
// Seulement l'app et le SDK Firebase : les appels au serveur des groupes ne sont jamais mis en cache.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const own = url.origin === location.origin;
  if (!own && url.hostname !== "www.gstatic.com") return;
  e.respondWith(
    (own ? fetch(e.request.url, { cache: "no-cache" }) : fetch(e.request))
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
