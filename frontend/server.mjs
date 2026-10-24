import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(fileURLToPath(new URL('./dist/', import.meta.url)));
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.webm':'video/webm'};
http.createServer(async(req,res)=>{
  try {
    const url = new URL(req.url,'http://localhost');
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(root, '.'+pathname);
    if (!file.startsWith(root+path.sep) && file !== path.join(root,'index.html')) {res.writeHead(403).end();return;}
    const body=await readFile(file);
    res.writeHead(200,{'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-cache'}).end(body);
  } catch {res.writeHead(404).end('Not found');}
}).listen(Number(process.env.PORT || 4178),'0.0.0.0',()=>console.log(`Pawletter preview: http://localhost:${process.env.PORT || 4178}`));
