// Service worker KHG: mở app nhanh, dùng tạm khi mất mạng (không lưu dữ liệu nghiệp vụ)
const V='khg-v1';
const SHELL=['/tai-xe.html','/dat-xe.html','/crm-khg.html','/cai-app.html','/icons/taixe-192.png','/icons/crm-192.png','/icons/datxe-192.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL).catch(()=>{})));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);if(u.origin!==location.origin)return;
  if(r.mode==='navigate'||/\.(html)$/.test(u.pathname)){
    e.respondWith(fetch(r).then(res=>{const cp=res.clone();caches.open(V).then(c=>c.put(r,cp)).catch(()=>{});return res}).catch(()=>caches.match(r).then(m=>m||caches.match(u.pathname.startsWith('/tai-xe')?'/tai-xe.html':u.pathname.startsWith('/dat-xe')?'/dat-xe.html':'/crm-khg.html'))));
    return}
  if(u.pathname.startsWith('/icons/')||u.pathname.startsWith('/images/'))e.respondWith(caches.match(r).then(m=>m||fetch(r).then(res=>{const cp=res.clone();caches.open(V).then(c=>c.put(r,cp));return res})));
});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window'}).then(cs=>{const c=cs[0];if(c)return c.focus();return clients.openWindow('/tai-xe.html')}))});
