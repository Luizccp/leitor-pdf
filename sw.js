// Cache simples para o app abrir rápido e funcionar offline (os PDFs já ficam no aparelho).
const CACHE = "leitor-v6";
const SHELL = ["./", "index.html", "app.js", "style.css", "manifest.webmanifest",
  "texturas/fosca-horizontal.jpg", "texturas/fosca-vertical.jpg", "texturas/nogueira-armario.jpg",
  "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.endsWith("/synthesize") || url.pathname.includes("/audio/")) return; // voz do servidor: sempre na rede
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req))
  );
});
