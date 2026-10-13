import {chromium,firefox,webkit} from 'playwright';
import {createServer} from 'node:http';
import {readFile,stat,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=process.cwd(),pkg=JSON.parse(await readFile('package.json','utf8')),name=pkg.name;
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json','.webmanifest':'application/manifest+json'};
let releaseRevision=0;
const server=createServer(async(req,res)=>{try{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(!pathname.startsWith(`/${name}/`)){res.writeHead(404);res.end();return;}
 const relative=pathname.slice(name.length+2),docs=relative.startsWith('docs/');
 const base=path.resolve(docs?'docs/.vitepress/dist':'dist');let file=path.resolve(base,docs?relative.slice(5):relative);
 if(file!==base&&!file.startsWith(base+path.sep)){res.writeHead(403);res.end();return;}
 if((await stat(file)).isDirectory())file=path.join(file,'index.html');
 res.setHeader('Content-Type',types[path.extname(file)]??'application/octet-stream');const bytes=await readFile(file);res.end(file.endsWith('sw.js')?Buffer.concat([bytes,Buffer.from('\n// readiness release '+releaseRevision)]):bytes);
 }catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/${name}/`;
const results=[],screenshots=path.resolve('test-results/readiness');await mkdir(screenshots,{recursive:true});
const engines={chromium,firefox,webkit};
const requested=(process.env.PIVO_BROWSERS??'chromium,firefox,webkit').split(',');
async function saved(page){const promise=page.waitForEvent('download',{timeout:20000});await page.locator('.suite-header-actions').getByRole('button',{name:'Save project',exact:true}).click();const download=await promise;return {name:download.suggestedFilename(),bytes:await readFile(await download.path())};}
async function snapshot(page){if(name==='pivo-ortho')return JSON.parse((await saved(page)).bytes.toString());return page.evaluate(app=>app==='pivo-craft'?window.pivoCraft.snapshot():window.__pivoPlateTest.getProject(),name);}
const add=async(browser,label,run)=>{try{await run();results.push({browser,label,passed:true});}catch(error){results.push({browser,label,passed:false,error:String(error)});throw error;}};
try{for(const engineName of requested){let browser;
 try{
  browser=await engines[engineName].launch({headless:true,...(engineName==='chromium'?{args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}:{})});
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:900}});const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await add(engineName,'production boot and native project round trip',async()=>{
   await page.goto(url,{waitUntil:'networkidle'});const file=await saved(page);assert.ok(file.bytes.length>100);
   const before=await snapshot(page);const input=page.locator('input[type=file]').filter({visible:false});

   const projectInput=name==='pivo-craft'?page.locator('#open-file'):name==='pivo-plate'?page.locator('#file-input'):page.locator('input[type=file]').first();
   await projectInput.setInputFiles({name:file.name,mimeType:'application/octet-stream',buffer:file.bytes});
   await page.waitForTimeout(700);const after=await snapshot(page);
   assert.equal(after.meshes?.length??after.tiles?.length??after.frames.length,before.meshes?.length??before.tiles?.length??before.frames.length);
  });
  await add(engineName,'corrupt project leaves artwork intact',async()=>{
   const before=await snapshot(page);const input=name==='pivo-craft'?page.locator('#open-file'):name==='pivo-plate'?page.locator('#file-input'):page.locator('input[type=file]').first();
   await input.setInputFiles({name:'invalid'+(name==='pivo-craft'?'.pvc':name==='pivo-ortho'?'.pvo':'.pvp'),mimeType:'application/octet-stream',buffer:Buffer.from('invalid project')});
   if(name==='pivo-plate')await page.getByRole('button',{name:'OK',exact:true}).click();else await page.waitForTimeout(500);
   assert.deepEqual(await snapshot(page),before);
  });
  if(name!=='pivo-ortho')await add(engineName,'edits during save retain dirty state and newer recovery',async()=>{
   await page.evaluate(app=>{
    const edit=(label)=>app==='pivo-craft'?window.pivoCraft.run(label,p=>{p.name=label;}):window.__pivoPlateTest.store.transact(label,p=>{p.name=label;});
    edit('Saved during worker job');
    const original=Worker.prototype.postMessage;window.__originalPost=original;
    Worker.prototype.postMessage=function(...args){setTimeout(()=>original.apply(this,args),450);};
   },name);
   const download=page.waitForEvent('download');
   await page.locator('.suite-header-actions').getByRole('button',{name:'Save project',exact:true}).click();
   await page.waitForFunction(()=>Number(document.documentElement.dataset.archiveBusy)>0);
   await page.evaluate(app=>app==='pivo-craft'?window.pivoCraft.run('Newer edit',p=>{p.name='Newer edit';}):window.__pivoPlateTest.store.transact('Newer edit',p=>{p.name='Newer edit';}),name);
   await download;
   await page.evaluate(()=>{Worker.prototype.postMessage=window.__originalPost;});
   await page.waitForTimeout(2700);
   assert.ok((await page.locator('.suite-save-state').innerText()).includes('Unsaved edits'));
   const records=await page.evaluate(app=>new Promise((resolve,reject)=>{const request=indexedDB.open(app+'-recovery-v2',1);request.onsuccess=()=>{const db=request.result,read=db.transaction('copies').objectStore('copies').getAll();read.onsuccess=()=>{resolve(read.result);db.close();};read.onerror=()=>reject(read.error);};request.onerror=()=>reject(request.error);}),name);
   assert.ok(records.some(entry=>entry.name==='Newer edit'));
   await page.keyboard.press('Control+z');
   assert.ok(!(await page.locator('.suite-save-state').innerText()).includes('Unsaved edits'));
  });
  if(name!=='pivo-craft')await add(engineName,'WebGL loss retains backups and restoration resumes context',async()=>{
   const before=await snapshot(page);
   await page.evaluate(()=>{
    const context=[...document.querySelectorAll('canvas')].map(canvas=>canvas.getContext('webgl2')??canvas.getContext('webgl')).find(gl=>gl&&gl.getExtension('WEBGL_lose_context'));
    if(!context)throw Error('No WebGL loss extension available');
    window.__lostGL=context;window.__lossExtension=context.getExtension('WEBGL_lose_context');
    window.__lostEvent=false;window.__restoredEvent=false;
    context.canvas.addEventListener('webglcontextlost',()=>{window.__lostEvent=true;},{once:true});
    context.canvas.addEventListener('webglcontextrestored',()=>{window.__restoredEvent=true;},{once:true});
    window.__lossExtension.loseContext();
   });
   await page.waitForFunction(()=>window.__lostEvent&&window.__lostGL.isContextLost());
   await saved(page);
   await page.evaluate(()=>window.__lossExtension.restoreContext());
   await page.waitForFunction(()=>window.__restoredEvent&&!window.__lostGL.isContextLost());
   await page.waitForTimeout(250);assert.deepEqual(await snapshot(page),before);
  });
  await add(engineName,'supported export outputs',async()=>{
   const formats=name==='pivo-craft'?['png','gif','ase','sheet']:name==='pivo-ortho'?['texture','render','obj','gltf','gif','spritesheet']:['glb','obj'];
   for(const format of formats){
    await page.locator('.suite-header-actions').getByRole('button',{name:/Export/}).click();
    const dialog=page.getByRole('dialog');await dialog.waitFor();
    const selector=name==='pivo-craft'?dialog.locator('[name=format]'):name==='pivo-ortho'?dialog.getByLabel('Export format',{exact:true}):dialog.getByLabel('Export format',{exact:true});
    await selector.selectOption(format);
    if(name==='pivo-ortho'&&format==='gif'){const fields=dialog.locator('input[type=number]');if(await fields.count())await fields.first().fill('64');}
    const promise=page.waitForEvent('download',{timeout:30000});await dialog.getByRole('button',{name:'Export',exact:true}).click();
    const download=await promise,bytes=await readFile(await download.path());if(engineName==='chromium')await download.saveAs(path.join(screenshots,format+'-'+download.suggestedFilename()));assert.ok(bytes.length>20,format+' output');
    if(['png','texture','render','spritesheet','sheet'].includes(format))assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    if(format==='gif')assert.ok(bytes.subarray(0,6).toString().startsWith('GIF8'));
    if(format==='glb')assert.equal(bytes.subarray(0,4).toString(),'glTF');
    if(['obj','gltf'].includes(format))assert.equal(bytes.subarray(0,2).toString(),'PK');
    if(await dialog.count()){const cancel=dialog.getByRole('button',{name:/^(Cancel|Close exports)$/});if(await cancel.count())await cancel.first().click();}
   }
  });
  await add(engineName,'panels and keyboard dismissal' ,async()=>{const toggle=page.getByRole('button',{name:'Panels',exact:true});await toggle.click();await toggle.click();await page.setViewportSize({width:800,height:700});await toggle.click();await page.keyboard.press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');});
  await add(engineName,'theme and compact layout',async()=>{await page.locator('.suite-header-actions button').last().click();assert.ok(['light','dark'].includes(await page.locator('html').getAttribute('data-theme')));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(screenshots,`${engineName}-compact.png`)});});
  await add(engineName,'offline reload retains native backup access',async()=>{
   await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>navigator.serviceWorker.controller!==null,undefined,{timeout:20000});await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});await page.waitForTimeout(500);
   const dialog=page.getByRole('dialog');if(await dialog.count()){const cancel=dialog.getByRole('button',{name:'Cancel',exact:true});if(await cancel.count())await cancel.click();}
   await saved(page);await context.setOffline(false);
  });
  await add(engineName,'deferred service-worker update',async()=>{
   releaseRevision++;
   await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration.update();});
   await page.getByRole('button',{name:'Save recovery and update',exact:true}).waitFor({timeout:20000});
   const before=await snapshot(page);await page.getByRole('button',{name:'Later',exact:true}).click();
   assert.deepEqual(await snapshot(page),before);
  });
  await add(engineName,'accepting update preserves a deferred second tab',async()=>{
   // Plate correctly blocks reload while a previous session awaits resolution.
   if(name==='pivo-plate')for(let n=0;n<10&&await page.locator('#recover-banner.show').count();n++){
    await page.locator('#recover-banner').getByRole('button',{name:'Discard',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Discard recovery',exact:true}).click();
    await page.waitForTimeout(200);
   }
   const peer=await context.newPage();peer.on('dialog',dialog=>dialog.accept());
   await peer.goto(url,{waitUntil:'networkidle'});
   const cancel=peer.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true});if(await cancel.count())await cancel.click();
   if(name==='pivo-ortho')await peer.getByRole('button',{name:'Cube',exact:true}).click();
   else await peer.evaluate(app=>app==='pivo-craft'?window.pivoCraft.run('Other tab unsaved',p=>{p.name='Other tab unsaved';}):window.__pivoPlateTest.store.transact('Other tab unsaved',p=>{p.name='Other tab unsaved';}),name);
   await peer.evaluate(()=>{window.__tabStillLoaded=true;});
   releaseRevision++;
   await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration.update();});
   await page.getByRole('button',{name:'Save recovery and update',exact:true}).waitFor({timeout:20000});
   const navigation=page.waitForEvent('framenavigated',{predicate:frame=>frame===page.mainFrame(),timeout:25000});
   await page.getByRole('button',{name:'Save recovery and update',exact:true}).click();await navigation;
   await page.waitForLoadState('networkidle');await peer.waitForTimeout(1000);
   assert.equal(await peer.evaluate(()=>window.__tabStillLoaded),true);
   assert.ok((await peer.locator('.suite-save-state').innerText()).includes('Unsaved edits'));
   await saved(peer);await peer.close();
  });
  await add(engineName,'no uncaught application errors' ,async()=>assert.deepEqual(errors,[]));
  await context.close();
  // Synthetic corrupt legacy data is isolated from user browser profiles.
  const legacy=await browser.newContext(),recoverPage=await legacy.newPage();
  await recoverPage.addInitScript(app=>{
   if(app==='pivo-ortho')localStorage.setItem('pivo-ortho:recovery:v1','{broken backup');
   else {const request=indexedDB.open(app,1);request.onupgradeneeded=()=>{if(app==='pivo-craft')request.result.createObjectStore('recovery',{keyPath:'id'});else request.result.createObjectStore('autosave');};request.onsuccess=()=>{const db=request.result,tx=db.transaction(app==='pivo-craft'?'recovery':'autosave','readwrite');if(app==='pivo-craft')tx.objectStore('recovery').put({id:'latest',at:1,name:'Broken backup',bytes:new Uint8Array([1,2,3])});else tx.objectStore('autosave').put('{broken backup','current');tx.oncomplete=()=>db.close();};}
  },name);
  await add(engineName,'corrupt recovery offers backup and survives startup',async()=>{
   await recoverPage.goto(url,{waitUntil:'networkidle'});await recoverPage.getByRole('button',{name:/Download (recovery )?backup/}).waitFor();await recoverPage.waitForTimeout(1600);
   if(name==='pivo-ortho')assert.equal(await recoverPage.evaluate(()=>localStorage.getItem('pivo-ortho:recovery:v1')),'{broken backup');
   const promise=recoverPage.waitForEvent('download');await recoverPage.getByRole('button',{name:/Download (recovery )?backup/}).click();assert.ok((await readFile(await (await promise).path())).length>0);
  });
  await legacy.close();
  const isolated=await browser.newContext(),first=await isolated.newPage(),second=await isolated.newPage();
  await add(engineName,'separate browser sessions retain separate recovery records',async()=>{
   for(const [page,label] of [[first,'First session'],[second,'Second session']]){
    page.on('dialog',dialog=>dialog.accept());await page.goto(url,{waitUntil:'networkidle'});
    const cancel=page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true});if(await cancel.count())await cancel.click();
    if(name==='pivo-ortho')await page.getByRole('button',{name:'Cube',exact:true}).click();
    else await page.evaluate(({app,label})=>app==='pivo-craft'?window.pivoCraft.run('Rename project',p=>{p.name=label;}):window.__pivoPlateTest.store.transact('Rename project',p=>{p.name=label;}),{app:name,label});
    await page.waitForTimeout(2400);
   }
   const entries=await first.evaluate(app=>new Promise((resolve,reject)=>{const request=indexedDB.open(app+'-recovery-v2',1);request.onsuccess=()=>{const db=request.result,get=db.transaction('copies').objectStore('copies').getAll();get.onsuccess=()=>{resolve(get.result.map(entry=>({id:entry.id,name:entry.name})));db.close();};get.onerror=()=>reject(get.error);};request.onerror=()=>reject(request.error);}),name);
   assert.equal(new Set(entries.map(entry=>entry.id.split(':')[0])).size,2);
  });
  await isolated.close();
  const denied=await browser.newContext(),deniedPage=await denied.newPage();
  await deniedPage.addInitScript(()=>{Object.defineProperty(window,'indexedDB',{configurable:true,get(){throw new DOMException('Storage denied','SecurityError');}});});
  await add(engineName,'denied storage retains native backup access',async()=>{await deniedPage.goto(url,{waitUntil:'networkidle'});await saved(deniedPage);});
  await denied.close();
  for(const failure of ['QuotaExceededError','AbortError']){
   const fault=await browser.newContext(),faultPage=await fault.newPage();faultPage.on('dialog',dialog=>dialog.accept());
   await add(engineName,failure+' preserves the previous recovery and native backups',async()=>{
    await faultPage.goto(url,{waitUntil:'networkidle'});
    const edit=async label=>{if(name==='pivo-ortho')await faultPage.getByRole('button',{name:'Cube',exact:true}).click();else await faultPage.evaluate(({app,label})=>app==='pivo-craft'?window.pivoCraft.run('Rename project',p=>{p.name=label;}):window.__pivoPlateTest.store.transact('Rename project',p=>{p.name=label;}),{app:name,label});};
    const records=()=>faultPage.evaluate(app=>new Promise((resolve,reject)=>{const request=indexedDB.open(app+'-recovery-v2',1);request.onsuccess=()=>{const db=request.result,read=db.transaction('copies').objectStore('copies').getAll();read.onsuccess=()=>{resolve(JSON.stringify(read.result));db.close();};read.onerror=()=>reject(read.error);};request.onerror=()=>reject(request.error);}),name);
    await edit('Stable backup');await faultPage.waitForTimeout(2600);const before=await records();assert.notEqual(before,'[]');
    await faultPage.evaluate(kind=>{window.__originalRecoveryPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='copies'){if(kind==='AbortError')this.transaction.abort();throw new DOMException('Synthetic recovery failure',kind);}return window.__originalRecoveryPut.apply(this,args);};},failure);
    await edit('New edits survive failure');await faultPage.waitForTimeout(2600);assert.equal(await records(),before);await saved(faultPage);
    await faultPage.evaluate(()=>{IDBObjectStore.prototype.put=window.__originalRecoveryPut;});
   });await fault.close();
  }
 }catch(error){if(!results.some(result=>result.browser===engineName&&!result.passed))results.push({browser:engineName,label:'browser execution',passed:false,error:String(error)});}
 finally{await browser?.close();}
}}finally{await new Promise(resolve=>server.close(resolve));}
await writeFile(path.join(screenshots,'report.json'),JSON.stringify({app:name,date:new Date().toISOString(),results},null,2));
console.log(JSON.stringify({app:name,results},null,2));if(results.some(result=>!result.passed))process.exitCode=1;
