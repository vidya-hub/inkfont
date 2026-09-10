import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
export default defineConfig({
  publicDir: false,
  plugins: [
    tailwindcss(),
    react(),
    {
      name: "inkfont-offline",
      apply: "build",
      closeBundle() {
        const assets = [
          "/",
          "/index.html",
          ...readdirSync("dist/assets").map((f) => "/assets/" + f),
        ];
        const version = createHash("sha256")
          .update(readFileSync("dist/index.html"))
          .digest("hex")
          .slice(0, 12);
        writeFileSync(
          "dist/sw.js",
          `const CACHE='inkfont-${version}';
const ASSETS=${JSON.stringify(assets)};
self.addEventListener('install',e=>e.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await Promise.all(ASSETS.map(async url=>{
    try{
      const res=await fetch(url,{cache:'reload'});
      if(res.ok) await cache.put(url,res.clone());
    }catch{}
  }));
  if(!self.registration.active) await self.skipWaiting();
})()));
self.addEventListener('message',e=>{if(e.data==='ACTIVATE')self.skipWaiting()});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('inkfont-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;
  e.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const path=new URL(e.request.url).pathname;
    if(e.request.mode==='navigate'||path==='/'||path==='/index.html'){
      const page=await cache.match('/index.html')||await cache.match('/');
      if(page)return page;
    }
    const cached=await cache.match(e.request)||await cache.match(path);
    if(cached)return cached;
    try{return await fetch(e.request)}
    catch{
      const page=await cache.match('/index.html')||await cache.match('/');
      if(page&&e.request.mode==='navigate')return page;
      return new Response('Offline',{status:503,headers:{'Content-Type':'text/plain'}});
    }
  })());
});
`,
        );
      },
    },
  ],
});
