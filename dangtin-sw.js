// Service worker riêng cho app "Đăng tin CTV" (dang-tin.html): chỉ để trang đủ điều kiện
// "Cài vào màn hình chính" (Android/Chrome yêu cầu có service worker với fetch handler) và
// mở nhanh lần sau — KHÔNG lưu dữ liệu nghiệp vụ, KHÔNG đụng tới các service worker khác của site.
const V = 'dangtin-v1';
const SHELL = ['/dang-tin.html', '/icons/dangtin-192.png', '/icons/dangtin-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL).catch(() => {}))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k.indexOf('dangtin-') === 0).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return;
  // Chỉ cache phần vỏ app (dang-tin.html + icon) — KHÔNG cache index.html (nơi chứa form/dữ liệu
  // tin đăng thật) để luôn lấy bản mới nhất mỗi lần CTV mở form, tránh đăng theo field cũ.
  if (u.pathname === '/dang-tin.html' || u.pathname === '/'){
    e.respondWith(
      fetch(r).then(res => { const cp = res.clone(); caches.open(V).then(c => c.put('/dang-tin.html', cp)).catch(() => {}); return res; })
        .catch(() => caches.match('/dang-tin.html'))
    );
    return;
  }
  if (u.pathname.indexOf('/icons/dangtin-') === 0){
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); return res; })));
  }
});
