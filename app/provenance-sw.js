// Provenance PWA service worker — keeps the installed app opening with no connection.
//
// v2 strategy (changed when the app gained a real backend and a shared dev link):
//   - The app page itself is NETWORK-FIRST: everyone gets the latest deploy as soon as they're
//     online, and the cached copy is only used offline. (v1 was cache-first with a fixed cache
//     name, so testers could be stuck on an old build indefinitely.)
//   - Other same-origin files (manifest, this worker) are cache-first.
//   - Cross-origin requests (Supabase API, auth, realtime) are NEVER touched or cached — live data
//     must always come from the server. (v1 cached every GET, including API responses.)
const CACHE_NAME = 'provenance-shell-v2';
const SHELL_FILES = ['./', './index.html', './provenance-manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // API traffic goes straight to the network

  const isPage = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  if (isPage) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE_NAME).then((c) => c.put('./index.html', copy)); }
          return res;
        })
        .catch(() => caches.match('./index.html').then((c) => c || caches.match('./')))
    );
    return;
  }
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});
