// Serve built documentation only. VitePress's development server is never started.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('docs/.vitepress/dist');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=createServer(async(req,res)=>{
 try{
  const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/, '');
  let file=path.resolve(root,relative);
  if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  if((await stat(file)).isDirectory())file=path.join(file,'index.html');
  res.setHeader('Content-Type',types[path.extname(file)]??'application/octet-stream');res.setHeader('X-Content-Type-Options','nosniff');
  res.end(await readFile(file));
 }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(4178,'127.0.0.1',()=>console.log('Built documentation: http://127.0.0.1:4178/'));
