/* IRON.LOG Service Worker – Offline-Cache (© 2026 Markus Felser) */
const CACHE = 'ironlog-v8';
const CORE = ['./', './index.html', './manifest.json', './garmin.js', './garmin-codec.js', './garmin-ble.js', './garmin-connect.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Strategie: Netz zuerst für die App-Seite selbst (damit Updates ankommen),
// Cache-Fallback offline; alles andere (Fonts, CDN) cache-first mit Nachladen.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const isNav = e.request.mode === 'navigate' || e.request.destination === 'document';
  if (isNav) {
    e.respondWith(
      fetch(e.request).then(resp => {
        caches.open(CACHE).then(c => c.put('./index.html', resp.clone()));
        return resp;
      }).catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(hit => {
      const net = fetch(e.request).then(resp => {
        if (resp && resp.ok) caches.open(CACHE).then(c => c.put(e.request, resp.clone()));
        return resp;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
