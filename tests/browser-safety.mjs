import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url).pathname;
await mkdir(root+'test-results',{recursive:true});
const server=spawn(process.execPath,[root+'node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4180','--strictPort'],{cwd:root,stdio:'pipe'});
let browser;const passed=[],errors=[];
async function check(name,fn){await fn();passed.push(name);console.log('PASS '+name);}
try{
 await new Promise((res,rej)=>{const t=setTimeout(()=>rej(Error('Vite timeout')),15000);server.stdout.on('data',s=>{if(String(s).includes('4180')){clearTimeout(t);res();}});});
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
 const page=await context.newPage();page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const api=(fn,arg)=>page.evaluate(fn,arg);
 async function boot(){await page.goto('http://127.0.0.1:4180/',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__pivoPlateTest);}
 async function menu(name,item){await page.getByRole('button',{name,exact:true}).click();await page.locator('.menu-popup').getByRole('button',{name:item,exact:false}).click();}
 async function rawRecord(key='current'){return api(key=>new Promise((res,rej)=>{const r=indexedDB.open('pivo-plate',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('autosave','readonly'),q=tx.objectStore('autosave').get(key);q.onsuccess=()=>res(q.result??null);q.onerror=()=>rej(q.error);tx.oncomplete=()=>db.close();};}),key);}
 async function waitSaved(name){await api(async name=>{const {loadAutosave}=await import('/src/io/project.ts');await new Promise((res,rej)=>{const end=Date.now()+10000;async function poll(){if((await loadAutosave())?.name===name)return res();if(Date.now()>end)return rej(Error('Autosave timeout'));setTimeout(poll,80);}poll();});},name);}
 async function seed(name){await api(async name=>{const {saveAutosave}=await import('/src/io/project.ts');const p=window.__pivoPlateTest.getProject();p.name=name;await saveAutosave(p);},name);}
 async function reload(){await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>window.__pivoPlateTest);}
 await boot();
 await check('confirmation blocks destructive, undo, mode and save shortcuts',async()=>{
  await api(()=>window.__pivoPlateTest.store.transact('dirty',p=>p.name='dirty-modal'));
  await menu('File','New (empty)');await page.getByRole('dialog').waitFor();
  const before=await api(()=>({project:JSON.stringify(window.__pivoPlateTest.getProject()),revision:window.__pivoPlateTest.getRevision(),mode:window.__pivoPlateTest.getSession().mode}));
  for(const key of ['Control+a','Delete','Control+z','Control+y','Control+d','Control+s','d','e','p','x','Tab'])await page.keyboard.press(key);
  const after=await api(()=>({project:JSON.stringify(window.__pivoPlateTest.getProject()),revision:window.__pivoPlateTest.getRevision(),mode:window.__pivoPlateTest.getSession().mode}));
  assert.deepEqual(after,before);assert.equal(await page.getByRole('dialog').count(),1);
 });
 await check('modal traps focus and restores editor interactivity on Escape',async()=>{
  assert.equal(await api(()=>document.getElementById('app').inert),true);
  for(let i=0;i<5;i++){await page.keyboard.press('Tab');assert.equal(await api(()=>!!document.activeElement.closest('[role="dialog"]')),true);}
  await page.keyboard.press('Shift+Tab');assert.equal(await api(()=>!!document.activeElement.closest('[role="dialog"]')),true);
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await api(()=>document.getElementById('app').inert),false);
 });
 await check('Help uses the same keyboard and focus isolation',async()=>{
  await page.getByRole('button',{name:'Shortcuts',exact:true}).click();const before=await api(()=>JSON.stringify(window.__pivoPlateTest.getProject()));await page.keyboard.press('Control+a');await page.keyboard.press('Delete');assert.equal(await api(()=>JSON.stringify(window.__pivoPlateTest.getProject())),before);await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
 });
 await check('invalid tile size and margin roll back atomically with field feedback',async()=>{
  await page.getByRole('button',{name:'Atlas',exact:true}).click();const before=await api(()=>({project:JSON.stringify(window.__pivoPlateTest.getProject()),revision:window.__pivoPlateTest.getRevision(),redo:window.__pivoPlateTest.canRedo()}));
  for(const id of ['atlas-tileWidth','atlas-margin']){await page.locator('#'+id).fill('9999');await page.locator('#'+id).press('Tab');assert.equal(await page.locator('#'+id).getAttribute('aria-invalid'),'true');}
  assert.deepEqual(await api(()=>({project:JSON.stringify(window.__pivoPlateTest.getProject()),revision:window.__pivoPlateTest.getRevision(),redo:window.__pivoPlateTest.canRedo()})),before);
  assert.equal(await api(async()=>{await(await import('/src/io/project.ts')).encodeProject(window.__pivoPlateTest.getProject());return true;}),true);
 });
 await check('Save still downloads after a rejected setting change',async()=>{
  const d=page.waitForEvent('download');await menu('File','Save');const f=await d;assert.ok(f.suggestedFilename().endsWith('.pvp'));await waitSaved('dirty-modal');
 });
 await check('unresolved recovery survives fresh editing and a second reload',async()=>{
  await seed('RECOVERY-A');await reload();assert.equal(await page.locator('#recover-banner').isVisible(),true);
  const original=await rawRecord('pending-recovery');await api(()=>window.__pivoPlateTest.store.transact('fresh',p=>p.name='FRESH-B'));
  // Wait beyond the app debounce inside one bounded test command, not tool polling.
  await api(()=>new Promise(r=>setTimeout(r,1500)));
  assert.equal(await rawRecord('pending-recovery'),original);assert.equal(JSON.parse(await rawRecord()).name,'RECOVERY-A');
  await reload();assert.equal(JSON.parse(await rawRecord('pending-recovery')).name,'RECOVERY-A');
 });
 await check('Restore prompts for fresh edits; Cancel preserves both documents',async()=>{
  await api(()=>window.__pivoPlateTest.store.transact('fresh',p=>p.name='FRESH-D'));
  await page.getByRole('button',{name:'Restore autosave',exact:true}).click();await page.getByRole('dialog',{name:'Unsaved changes',exact:true}).waitFor();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await api(()=>window.__pivoPlateTest.getProject().name),'FRESH-D');assert.equal(JSON.parse(await rawRecord('pending-recovery')).name,'RECOVERY-A');
 });
 await check('accepted restoration resolves only the protected copy and stays dirty',async()=>{
  await page.getByRole('button',{name:'Restore autosave',exact:true}).click();await page.getByRole('dialog',{name:'Unsaved changes',exact:true}).waitFor();await page.getByRole('button',{name:'Discard changes',exact:true}).click();
  await page.waitForFunction(()=>window.__pivoPlateTest.getProject().name==='RECOVERY-A');await page.waitForFunction(()=>!document.getElementById('recover-banner').classList.contains('show'));
  assert.equal(await rawRecord('pending-recovery'),null);assert.equal(await api(()=>window.__pivoPlateTest.isDirty()),true);
 });
 await check('autosave resumes with new valid edits after recovery resolution',async()=>{
  await api(()=>window.__pivoPlateTest.store.transact('resumed',p=>p.name='AFTER-RECOVERY'));await waitSaved('AFTER-RECOVERY');
 });
 await check('pending recovery copy cannot be overwritten by current-slot writes',async()=>{
  await seed('PROTECTED-OLD');await reload();const old=await rawRecord('pending-recovery');
  await seed('OTHER-TAB-NEW');assert.equal(await rawRecord('pending-recovery'),old);assert.equal(JSON.parse(await rawRecord()).name,'OTHER-TAB-NEW');
  const record=await api(async()=>await(await import('/src/io/project.ts')).inspectAutosave());assert.equal(record.project.name,'PROTECTED-OLD');
 });
 await check('Discard requires confirmation and preserves a newer current-slot record',async()=>{
  await page.getByRole('button',{name:'Discard',exact:true}).click();await page.getByRole('dialog',{name:'Discard recovery snapshot?',exact:true}).waitFor();await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.notEqual(await rawRecord('pending-recovery'),null);
  await page.getByRole('button',{name:'Discard',exact:true}).click();await page.getByRole('button',{name:'Discard recovery',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('recover-banner').classList.contains('show'));assert.equal(await rawRecord('pending-recovery'),null);assert.equal(JSON.parse(await rawRecord()).name,'OTHER-TAB-NEW');
 });
 await check('stale recovery decisions reject without deleting the current slot',async()=>{
  const result=await api(async()=>{const io=await import('/src/io/project.ts');const r=await io.inspectAutosave();await io.resolveRecovery(r.raw,false);try{await io.resolveRecovery(r.raw,true);return 'accepted';}catch(e){return e.message;}});assert.match(result,/changed in another tab/);assert.equal(JSON.parse(await rawRecord()).name,'OTHER-TAB-NEW');
 });
 await check('invalid saved recovery is retained with backup rather than auto-cleared',async()=>{
  await api(()=>new Promise((res,rej)=>{const r=indexedDB.open('pivo-plate',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('autosave','readwrite');tx.objectStore('autosave').put('{broken JSON','current');tx.oncomplete=()=>{db.close();res();};tx.onerror=()=>rej(tx.error);};}));
  await reload();assert.equal(await page.getByRole('button',{name:'Restore autosave',exact:true}).isDisabled(),true);assert.equal(await rawRecord('pending-recovery'),'{broken JSON');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download recovery backup',exact:true}).click();const file=await download;assert.ok(file.suggestedFilename().endsWith('.json'));assert.equal(await readFile(await file.path(),'utf8'),'{broken JSON');assert.equal(await rawRecord('pending-recovery'),'{broken JSON');
 });
 await check('over-depth project files reject quickly without replacing the open scene',async()=>{
  const context2=await browser.newContext({viewport:{width:1440,height:900}}),p2=await context2.newPage();
  await p2.goto('http://127.0.0.1:4180/',{waitUntil:'networkidle'});await p2.waitForFunction(()=>window.__pivoPlateTest);
  const data=await p2.evaluate(async()=>{const util=await import('/src/io/util.ts');const p=window.__pivoPlateTest.getProject();const textures=p.atlases.map(a=>({path:'atlases/'+a.id+'.png',bytes:util.dataUrlToBytes(a.dataUrl).bytes}));p.atlases.forEach(a=>a.dataUrl='');p.objects=Array.from({length:3000},(_,i)=>({id:'depth-'+i,name:'Depth '+i,parentId:i?'depth-'+(i-1):null,visible:true,locked:false}));p.tiles.forEach(t=>t.objectId='depth-0');return Array.from(util.buildContainer(JSON.stringify(p),textures));});
  const before=await p2.evaluate(()=>JSON.stringify(window.__pivoPlateTest.getProject()));
  await p2.getByRole('button',{name:'File',exact:true}).click();await p2.locator('.menu-popup').getByRole('button',{name:'Open .pvp',exact:false}).click();
  const started=Date.now();await p2.locator('#file-input').setInputFiles({name:'too-deep.pvp',mimeType:'application/octet-stream',buffer:Buffer.from(data)});
  await p2.getByRole('dialog',{name:'Could not open file',exact:true}).waitFor({timeout:5000});assert.ok(Date.now()-started<5000);assert.match(await p2.getByRole('dialog').innerText(),/depth/);assert.equal(await p2.evaluate(()=>JSON.stringify(window.__pivoPlateTest.getProject())),before);await context2.close();
 });
 await check('no uncaught errors or console errors during the safety workflows',async()=>assert.deepEqual(errors,[]));
 await writeFile(root+'test-results/safety-report.json',JSON.stringify({browser:await browser.version(),passed:passed.length,checks:passed,errors},null,2));
 console.log(JSON.stringify({passed:passed.length,errors},null,2));
}catch(e){console.error(e);if(browser){const p=browser.contexts().flatMap(c=>c.pages())[0];if(p){await p.screenshot({path:root+'test-results/safety-failure.png'});console.error((await p.locator('body').innerText()).slice(-1600));}}await writeFile(root+'test-results/safety-report.json',JSON.stringify({passed,errors,failure:String(e)},null,2));process.exitCode=1;}finally{if(browser)await browser.close();server.kill('SIGTERM');}
