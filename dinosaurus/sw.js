/* 오프라인용 서비스워커. 파일을 바꾸면 VERSION을 올릴 것 (그래야 태블릿이 새 파일을 받음) */
const VERSION = 'dino3d-v0.5';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  // 같은 주소의 몬스터(monster3d-)·전차(tank-) 캐시는 건드리지 않음
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('dino3d-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// 네트워크 우선, 실패하면 캐시 (새 버전은 바로 받고, 오프라인이면 캐시로 열림)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
