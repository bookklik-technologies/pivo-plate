import {chromium,firefox,webkit} from 'playwright';
import {createServer} from 'node:http';
import {readFile,writeFile,stat,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const name=JSON.parse(await readFile('package.json','utf8')).name;
const capture=JSON.parse(await readFile('test-results/predecessor/capture.json','utf8'));
for(const [file,hash] of Object.entries(capture.files))assert.equal(createHash('sha256').update(await readFile(path.join('test-results/predecessor',file))).digest('hex'),hash);
const currentWorkerSha256=createHash('sha256').update(await readFile('dist/sw.js')).digest('hex');
const workerChanged=currentWorkerSha256!==capture.files['sw.js'];
await mkdir('test-results/readiness',{recursive:true});
let upgraded=false;
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{try{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/upgrade-observer.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Upgrade observer</title>');return;}
 if(!pathname.startsWith(`/${name}/`)){res.writeHead(404);res.end();return;}
 const relative=decodeURIComponent(pathname.slice(name.length+2));
 if(relative==='docs/upgrade-bootstrap.html'){res.setHeader('Content-Type','text/html');res.setHeader('Cache-Control','no-store');res.end('<!doctype html><title>Installed predecessor</title><script>navigator.serviceWorker.register("../sw.js").then(()=>navigator.serviceWorker.ready).then(()=>window.installed=true).catch(error=>window.installError=String(error));</script>');return;}
 const base=path.resolve(upgraded?'dist':'test-results/predecessor');let file=path.resolve(base,relative||'index.html');
 if(!file.startsWith(base+path.sep)){res.writeHead(403);res.end();return;}
 if((await stat(file)).isDirectory())file=path.join(file,'index.html');
 res.setHeader('Content-Type',types[path.extname(file)]??'application/octet-stream');res.setHeader('Cache-Control','no-cache');res.end(await readFile(file));
 }catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/${name}/`,results=[];
try{for(const engine of (process.env.PIVO_BROWSERS??'chromium,firefox,webkit').split(',')){
 const type={chromium,firefox,webkit}[engine];
 let browser,stage='launch';const diagnostics=[];try{
  upgraded=false;
  browser=await type.launch({headless:true,...(engine==='chromium'?{args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}:{})});
  const context=await browser.newContext({acceptDownloads:true});
  context.on('weberror',error=>diagnostics.push(String(error.error())));
  context.on('requestfailed',request=>diagnostics.push(`${request.url()}: ${request.failure()?.errorText}`));
  context.on('response',response=>{if(response.status()>=400)diagnostics.push(`${response.status()} ${response.url()}`);});
  const old=await context.newPage();
  stage='install predecessor';
  await old.goto(url+'docs/upgrade-bootstrap.html');
  await old.waitForFunction(()=>window.installed||window.installError);
  assert.equal(await old.evaluate(()=>window.installError),undefined);
  stage='acquire predecessor controller';
  await old.waitForFunction(async()=>{const registration=await navigator.serviceWorker.getRegistration();return registration?.active?.state==='activated';});
  await old.goto(url+'pwa-192x192.png');
  await old.waitForFunction(()=>navigator.serviceWorker.controller);
  stage='seed predecessor recovery';
  await old.evaluate(async app=>{
   if(app==='pivo-ortho'){localStorage.setItem('pivo-ortho:recovery:v1','{exact predecessor backup');return;}
   await new Promise((resolve,reject)=>{
    const request=indexedDB.open(app,1);request.onupgradeneeded=()=>request.result.createObjectStore(app==='pivo-craft'?'recovery':'autosave',app==='pivo-craft'?{keyPath:'id'}:undefined);
    request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(app==='pivo-craft'?'recovery':'autosave','readwrite'),store=tx.objectStore(app==='pivo-craft'?'recovery':'autosave');
     if(app==='pivo-craft')store.put({id:'latest',at:1,name:'Predecessor backup',bytes:new Uint8Array([1,2,3])});else store.put('{exact predecessor backup','current');
     tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};
   });
  },name);
  upgraded=true;
  stage='check worker update';
  await old.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration.update();});
  if(workerChanged){
   stage='wait for replacement worker';
   await old.waitForFunction(async()=>Boolean((await navigator.serviceWorker.getRegistration()).waiting));
   await old.waitForTimeout(500);assert.equal(await old.evaluate(async()=>Boolean((await navigator.serviceWorker.getRegistration()).waiting)),true);
  }else{
   assert.equal(await old.evaluate(async()=>Boolean((await navigator.serviceWorker.getRegistration()).waiting)),false);
  }
  const current=await context.newPage();current.on('dialog',dialog=>dialog.accept());
  await current.goto(new URL('/upgrade-observer.html',url).href);
  await old.close();
  stage='wait for worker activation';
  await current.waitForFunction(async scope=>{const registration=await navigator.serviceWorker.getRegistration(scope);return registration?.active?.state==='activated'&&!registration.waiting&&!registration.installing;},url);
  stage='open current application';
  await current.goto(url,{waitUntil:'networkidle'});
  stage='download preserved recovery';
  const backup=current.getByRole('button',{name:/Download (recovery )?backup/});await backup.waitFor({timeout:20000});
  const download=current.waitForEvent('download');await backup.click();const bytes=await readFile(await (await download).path());
  assert.equal(bytes.toString('hex'),name==='pivo-craft'?'010203':Buffer.from('{exact predecessor backup').toString('hex'));
  if(name==='pivo-ortho')assert.equal(await current.evaluate(()=>localStorage.getItem('pivo-ortho:recovery:v1')),'{exact predecessor backup');
  const cancel=current.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true});if(await cancel.count())await cancel.click();
  stage='save native project';
  const native=current.waitForEvent('download');await current.locator('.suite-header-actions').getByRole('button',{name:'Save project',exact:true}).click();assert.ok((await readFile(await (await native).path())).length>100);
  results.push({engine,passed:true,workerChanged,serviceWorkerSha256:capture.files['sw.js'],currentWorkerSha256});await context.close();
 }catch(error){results.push({engine,passed:false,stage,workerChanged,error:String(error),diagnostics});}finally{await browser?.close();}
}}finally{await new Promise(resolve=>server.close(resolve));}
await writeFile('test-results/readiness/upgrade-report.json',JSON.stringify({capture,results},null,2));console.log(JSON.stringify(results,null,2));if(results.some(result=>!result.passed))process.exitCode=1;
