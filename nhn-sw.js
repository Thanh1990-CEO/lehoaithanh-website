// Service worker – Nhận Hàng Nhanh (đối tác KHG): thông báo đẩy + mở app nhanh
const V='nhn-v1';
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(['/nhan-hang-nhanh.html','/icons/nhn-192.png']).catch(()=>{})));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('nhn-')&&k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET'||r.mode!=='navigate')return;
  e.respondWith(fetch(r).then(res=>{const cp=res.clone();caches.open(V).then(c=>c.put('/nhan-hang-nhanh.html',cp)).catch(()=>{});return res}).catch(()=>caches.match('/nhan-hang-nhanh.html')))});
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{}}catch(_){d={title:'Nhận Hàng Nhanh',body:e.data&&e.data.text()}}
  const title=d.title||'Nhận Hàng Nhanh';
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
    const vis=cs.find(c=>c.visibilityState==='visible'&&c.url.includes('/nhan-hang-nhanh'));
    cs.forEach(c=>c.postMessage({type:'push',title,body:d.body,url:d.url}));
    if(vis&&d.tag&&String(d.tag).startsWith('of-'))return; // app đang mở: app tự kêu chuông
    return self.registration.showNotification(title,{body:d.body||'',tag:d.tag||'nhn',renotify:true,icon:'/icons/nhn-192.png',badge:'/icons/nhn-192.png',
      data:{url:d.url||'/nhan-hang-nhanh.html'},vibrate:d.urgent?[300,120,300,120,300]:[200],requireInteraction:!!d.urgent});
  }))});
self.addEventListener('notificationclick',e=>{e.notification.close();const url=(e.notification.data&&e.notification.data.url)||'/nhan-hang-nhanh.html';
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{const c=cs.find(x=>x.url.includes('/nhan-hang-nhanh'));
    if(c&&url.startsWith('/nhan-hang-nhanh')){c.postMessage({type:'nav',url});return c.focus()}return self.clients.openWindow(url)}))});
