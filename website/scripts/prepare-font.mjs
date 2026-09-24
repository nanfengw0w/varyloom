import fs from 'node:fs/promises';
const source = (await Promise.all(['components/playground.tsx','components/transition-stage.tsx','components/landing.tsx','lib/catalog.ts'].map(f=>fs.readFile(f,'utf8')))).join('');
const chars = [...new Set(source.match(/[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/gu))].sort().join('');
const url = 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600&display=swap&text='+encodeURIComponent(chars);
const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});
const css=await r.text();

const urls=[...new Set([...css.matchAll(/url\(([^)]+)\)/g)].map(x=>x[1]))];
await fs.mkdir('public/fonts',{recursive:true});
let local=css;
for(let i=0;i<urls.length;i++) { const bytes=await fetch(urls[i]).then(r=>r.arrayBuffer()); const name='noto-sans-sc-'+i+'.ttf'; await fs.writeFile('public/fonts/'+name,new Uint8Array(bytes));local=local.split(urls[i]).join('./'+name);console.log(name,bytes.byteLength); }
await fs.writeFile('public/fonts/noto-sans-sc.css',local);
