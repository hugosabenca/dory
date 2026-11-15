// Dory — "service worker": guarda os arquivos do app no celular
// para ele abrir mesmo sem internet.
// Sempre que mudar algum arquivo do app, aumente o número da versão abaixo.
const VERSAO = "dory-v3";
const ARQUIVOS = ["./", "index.html", "estilo.css", "app.js", "manifest.json", "icone-192.png", "icone-512.png", "icone-mascara-512.png"];

self.addEventListener("install", ev => {
  ev.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", ev => {
  ev.waitUntil(
    caches.keys().then(nomes => Promise.all(nomes.filter(n => n !== VERSAO).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", ev => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Biblioteca do Firebase e fontes: usa a cópia guardada (não mudam)
  if (url.hostname === "www.gstatic.com" || url.hostname.endsWith("fonts.googleapis.com") || url.hostname === "fonts.gstatic.com") {
    ev.respondWith(
      caches.match(req).then(salvo => salvo || fetch(req).then(resp => {
        const copia = resp.clone();
        caches.open(VERSAO).then(c => c.put(req, copia));
        return resp;
      }))
    );
    return;
  }

  // Arquivos do próprio Dory: tenta a internet primeiro (pega atualizações); sem internet, usa a cópia
  if (url.origin === self.location.origin) {
    ev.respondWith(
      fetch(req).then(resp => {
        const copia = resp.clone();
        caches.open(VERSAO).then(c => c.put(req, copia));
        return resp;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match("index.html")))
    );
  }
  // O resto (banco de dados, login) passa direto
});
