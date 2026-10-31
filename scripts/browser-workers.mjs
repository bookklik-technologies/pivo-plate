import {createServer} from 'vite';
import {chromium,firefox,webkit} from 'playwright';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const name=JSON.parse(await readFile('package.json','utf8')).name.split('/').pop();
const server=await createServer({configFile:path.resolve('vite.config.ts'),server:{host:'127.0.0.1',port:0,open:false}});
await server.listen();const address=server.httpServer.address(),url=`http://127.0.0.1:${address.port}/`,results=[];
try{for(const engine of (process.env.PIVO_BROWSERS??'chromium,firefox,webkit').split(',')){
 let browser;try{
  browser=await {chromium,firefox,webkit}[engine].launch({headless:true,...(engine==='chromium'?{args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}:{})});
  const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());page.setDefaultTimeout(12000);
  await page.goto(url,{waitUntil:'networkidle'});
  await page.waitForFunction(app=>app==='pivo-craft'?Boolean(window.pivoCraft):Boolean(window.__pivoPlateTest),name);
  const snapshot=()=>page.evaluate(app=>app==='pivo-craft'?window.pivoCraft.snapshot():window.__pivoPlateTest.getProject(),name);
  await page.evaluate(app=>app==='pivo-craft'?window.pivoCraft.run('Development worker check',p=>{p.name='Development worker check';}):window.__pivoPlateTest.store.transact('Development worker check',p=>{p.name='Development worker check';}),name);
  await page.waitForFunction(()=>document.querySelector('.suite-save-state')?.textContent.includes('Browser recovery stored'),undefined,{timeout:15000});
  const saved=page.waitForEvent('download');await page.locator('.suite-header-actions').getByRole('button',{name:'Save project',exact:true}).click();
  const download=await saved,bytes=await readFile(await download.path());assert.ok(bytes.length>100);
  const before=await snapshot();
  // Craft names reopened documents after the filename, which WebKit may sanitize.
  const expected=name==='pivo-craft'?{...before,name:path.basename(download.suggestedFilename(),'.pvc')}:before;
  await page.locator(name==='pivo-craft'?'#open-file':'#file-input').setInputFiles({name:download.suggestedFilename(),mimeType:'application/octet-stream',buffer:bytes});
  await page.waitForFunction(app=>app==='pivo-craft'?window.pivoCraft.tabs().length===2:document.querySelector('.suite-save-state')?.textContent.includes('Project opened'),name);
  assert.deepEqual(await snapshot(),expected);assert.deepEqual(errors,[]);
  // Failed retries report once while preserving visible recovery-unavailable state.
  if(name==='pivo-craft'){
   await page.evaluate(()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='copies')throw new DOMException('Synthetic quota failure','QuotaExceededError');return original.apply(this,args);};});
   const failures=()=>page.evaluate(()=>document.querySelector('#notice')?.textContent??'');
   await page.evaluate(async()=>{await window.pivoCraft.flushRecovery().catch(()=>{});});
   const first=await failures();assert.ok(first.includes('Recovery failed'));
   // Observe message text changes: a duplicate notify resets the message timer.
   const count=await page.evaluate(async()=>{
    let count=0;const observer=new MutationObserver(()=>{count++;});observer.observe(document.querySelector('#notice'),{childList:true,characterData:true,subtree:true});
    await window.pivoCraft.flushRecovery().catch(()=>{});await new Promise(resolve=>setTimeout(resolve,50));observer.disconnect();return count;
   });assert.equal(count,0);
  }
  results.push({engine,passed:true});await context.close();
 }catch(error){results.push({engine,passed:false,error:String(error)});}finally{await browser?.close();}
}}finally{await server.close();}
await mkdir('test-results/readiness',{recursive:true});await writeFile('test-results/readiness/development-worker-report.json',JSON.stringify({app:name,results},null,2));console.log(JSON.stringify(results,null,2));if(results.some(result=>!result.passed))process.exitCode=1;
