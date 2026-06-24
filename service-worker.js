const CACHE='hyperbeast-v3';
const ASSETS=['./','./index.html','./manifest.webmanifest',
  './icons/icon-180.png','./icons/icon-192.png','./icons/icon-512.png','./icons/icon-maskable-512.png'];

self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});

const PASSTHROUGH = ['supabase.co', 'cdn.jsdelivr.net', '/api/'];

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  const url = e.request.url;
  if(PASSTHROUGH.some(p=>url.includes(p))) return; // network-only for auth/API
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{
    const cp=resp.clone(); caches.open(CACHE).then(c=>{try{c.put(e.request,cp);}catch(_){}});return resp;
  }).catch(()=>caches.match('./index.html'))));
});
