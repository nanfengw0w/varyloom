import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../dist/client/', import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.gif':'image/gif','.ttf':'font/ttf','.woff2':'font/woff2','.rsc':'text/x-component'};
createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/varyloom'){res.writeHead(302,{Location:'/varyloom/'+url.search});res.end();return;}
    if(!url.pathname.startsWith('/varyloom/')){res.writeHead(404);res.end('Not found');return;}
    let file=path.resolve(root,decodeURIComponent(url.pathname.slice('/varyloom/'.length))||'index.html');
    if(!file.startsWith(root)){res.writeHead(403);res.end();return;}
    if((await stat(file)).isDirectory()){
      if(!url.pathname.endsWith('/')){res.writeHead(302,{Location:url.pathname+'/'+url.search});res.end();return;}
      file=path.join(file,'index.html');
    }
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(await readFile(file));
  } catch {res.writeHead(404);res.end('Not found');}
}).listen(Number(process.env.PORT)||4178,'127.0.0.1',()=>console.log(`Static Pages preview: http://127.0.0.1:${process.env.PORT||4178}/varyloom/`));
