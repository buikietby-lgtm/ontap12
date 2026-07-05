var CACHE = 'ot12-v1';
var URLS = [
  '/', '/icon.svg', '/manifest.json', '/ads.txt', '/google84773d7dc170f47d.html'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(URLS);
    }).then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  var req = e.request;
  var url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then(function(cached) { return cached || fetch(req); })
    );
    return;
  }
  if (url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(
      caches.open(CACHE).then(function(cache) {
        return cache.match(req).then(function(cached) {
          return (cached || fetch(req).then(function(resp) {
            if (resp.ok) cache.put(req, resp.clone());
            return resp;
          }));
        });
      })
    );
    return;
  }
});
