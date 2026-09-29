// 서비스워커 — 오프라인에서도 앱이 열리도록 정적 파일을 캐시한다.
// 파일을 고쳤으면 아래 VERSION 값을 올려야 태블릿에 새 버전이 내려간다.
const VERSION = 'tank-v4.5';
const FILES = [
  './',
  './index.html',
  './three.module.js',
  './three.core.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('tank-') && k !== VERSION).map(k => caches.delete(k))))   // 같은 주소의 몬스터 앱 캐시는 건드리지 않음
      .then(() => self.clients.claim())
  );
});

// 네트워크 우선 + 매번 서버에 새 버전 확인(no-cache). 바뀐 게 없으면 서버가 304로 짧게 답함. 오프라인이면 캐시로 열림
// (예전: 캐시 우선이라 새 버전이 두 번째 열 때 보였음)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
