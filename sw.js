/* 离线外壳：先缓存应用文件，断网也能打开；数据本来就在本机（IndexedDB），不经过这里。
   策略：同源文件「先网络、失败再用缓存」，所以发新版后联网打开就是新的；Supabase 等跨域请求不碰。 */
const CACHE = "seed-ledger-2026-10-29.4";
const SHELL = ["./", "index.html", "app.css", "manifest.webmanifest", "icon.svg"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
});
