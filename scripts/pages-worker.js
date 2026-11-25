/* global pagesRevision, pagesFiles */
const scope = self.registration.scope;
const cachePrefix = `goclick-pages:${encodeURIComponent(scope)}:`;
const cacheName = cachePrefix + pagesRevision;
const indexURL = new URL("index.html", scope).href;
const assetURLs = new Set(pagesFiles.map((file) => new URL(file, scope).href));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(cacheName)
      .then((cache) =>
        cache.addAll([...assetURLs].map((url) => new Request(url, { cache: "reload" }))),
      ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(cachePrefix) && key !== cacheName)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  let url = request.url;
  if (request.mode === "navigate") {
    const page = new URL(url);
    page.search = "";
    if (page.href !== scope && page.href !== indexURL) return;
    url = indexURL;
  }
  if (!assetURLs.has(url)) return;
  event.respondWith(caches.match(url, { cacheName }).then((cached) => cached ?? fetch(request)));
});
