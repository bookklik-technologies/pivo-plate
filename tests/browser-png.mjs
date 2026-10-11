import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url).pathname;
await mkdir(root+'test-results',{recursive:true});
const server=spawn(process.execPath,[root+'node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4183','--strictPort'],{cwd:root,stdio:'pipe'});
let browser;const checks=[],errors=[];
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
try{
 await new Promise((res,rej)=>{const t=setTimeout(()=>rej(Error('Vite timeout')),15000);server.stdout.on('data',s=>{if(String(s).includes('http://127.0.0.1:4183')){clearTimeout(t);res();}});server.on('exit',code=>rej(Error('Vite exited '+code)));});
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true});page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:4183/',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__pivoPlateTest);
 const api=(fn,arg)=>page.evaluate(fn,arg);
 await check('real browser-generated PNG validates with correct dimensions',async()=>{const info=await api(async()=>{const c=document.createElement('canvas');c.width=32;c.height=16;const g=c.getContext('2d');g.fillStyle='rgba(220,20,40,.5)';g.fillRect(0,0,32,16);return(await import('/src/core/png.ts')).validatePngDataUrl(c.toDataURL('image/png'));});assert.equal(info.width,32);assert.equal(info.height,16);});
 await check('PNG upload rejects CRC corruption before project mutation',async()=>{
  const bytes=await api(async()=>{const a=window.__pivoPlateTest.getProject().atlases[0];const {pngDataUrlBytes}=await import('/src/core/png.ts');const b=pngDataUrlBytes(a.dataUrl);b[b.length-1]^=1;return Array.from(b);});
  const before=await api(()=>JSON.stringify(window.__pivoPlateTest.getProject()));await page.locator('aside input[type=file]').setInputFiles({name:'corrupt.png',mimeType:'image/png',buffer:Buffer.from(bytes)});await page.getByText(/Atlas import failed:.*CRC/).waitFor();assert.equal(await api(()=>JSON.stringify(window.__pivoPlateTest.getProject())),before);
 });
 await check('Image is not allocated for oversized IHDR or corrupt base64',async()=>{
  const result=await api(async()=>{const {decodeImage}=await import('/src/ui/atlasPanel.ts');const f=await import('/tests/png-fixtures.ts');const b=f.assemble([{type:'IHDR',data:f.header(50000,50000)},{type:'IDAT',data:new Uint8Array([1])},{type:'IEND',data:new Uint8Array()}]);const real=window.Image;let count=0;window.Image=class{constructor(){count++;}};const failures=[];try{for(const u of [f.dataUrlUnchecked(b),'data:image/png;base64,%%%%']){try{await decodeImage(u);}catch(e){failures.push(e.message);}}}finally{window.Image=real;}return{count,failures};});assert.equal(result.count,0);assert.equal(result.failures.length,2);assert.match(result.failures[0],/dimensions|pixels/);
 });
 await check('oversized upload size rejects before reading a File buffer',async()=>{
  const result=await api(async()=>{const input=document.querySelector('aside input[type=file]');let reads=0;const fake={name:'too-large.png',type:'image/png',size:32*1024*1024+1,arrayBuffer:()=>{reads++;throw Error('must not read');}};Object.defineProperty(input,'files',{value:[fake],configurable:true});input.dispatchEvent(new Event('change',{bubbles:true}));await Promise.resolve();delete input.files;return reads;});assert.equal(result,0);await page.getByText(/Atlas import failed:.*byte budget/).waitFor();
 });
 await check('PNG scanline/deflate corruption rejects without browser fallback',async()=>{
  const result=await api(async()=>{const png=await import('/src/core/png.ts'),f=await import('/tests/png-fixtures.ts');const b=f.rawPng();const bad=f.withChunks(b,cs=>cs.map(c=>c.type==='IDAT'?{...c,data:c.data.slice(0,3)}:c));try{png.validatePngDataUrl(f.dataUrlUnchecked(bad));return'accepted';}catch(e){return e.message;}});assert.match(result,/zlib/);
 });
 await check('binary project loading rejects actual-dimension metadata spoofing atomically',async()=>{
  const bytes=await api(async()=>{const p=window.__pivoPlateTest.getProject();const u=await import('/src/io/util.ts');const textures=p.atlases.map(a=>({path:'atlases/'+a.id+'.png',bytes:u.dataUrlToBytes(a.dataUrl).bytes}));p.atlases.forEach(a=>{a.width+=16;a.dataUrl='';});return Array.from(u.buildContainer(JSON.stringify(p),textures));});
  const before=await api(()=>JSON.stringify(window.__pivoPlateTest.getProject()));await page.getByRole('button',{name:'File',exact:true}).click();await page.locator('.menu-popup').getByRole('button',{name:'Open .pvp',exact:false}).click();await page.locator('#file-input').setInputFiles({name:'spoof.pvp',mimeType:'application/octet-stream',buffer:Buffer.from(bytes)});await page.getByRole('dialog',{name:'Could not open file',exact:true}).waitFor();assert.match(await page.getByRole('dialog').innerText(),/actual dimensions/);await page.getByRole('button',{name:'OK',exact:true}).click();assert.equal(await api(()=>JSON.stringify(window.__pivoPlateTest.getProject())),before);
 });
 await check('both browser exporters reject corrupt textures before decoding or exporting',async()=>{
  const result=await api(async()=>{const p=window.__pivoPlateTest.getProject();const png=await import('/src/core/png.ts');const b=png.pngDataUrlBytes(p.atlases[0].dataUrl);b[b.length-1]^=1;p.atlases[0].dataUrl=png.pngBytesDataUrl(b);const ex=await import('/src/io/export.ts');const failures=[];for(const fn of [ex.exportGLB,ex.exportOBJ])try{await fn(p);failures.push('accepted');}catch(e){failures.push(e.message);}return failures;});assert.ok(result.every(m=>m.includes('CRC')));
 });
 await check('corrupt recovery PNG is retained and cannot replace the scene',async()=>{
  await api(()=>new Promise((resolve,reject)=>{const p=window.__pivoPlateTest.getProject();p.name='CORRUPT-RECOVERY';p.atlases[0].width+=16;const request=indexedDB.open('pivo-plate',1);request.onsuccess=()=>{const db=request.result,tx=db.transaction('autosave','readwrite');tx.objectStore('autosave').put(JSON.stringify(p),'current');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};}));
  await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>window.__pivoPlateTest);assert.equal(await page.getByRole('button',{name:'Restore autosave',exact:true}).isDisabled(),true);assert.notEqual(await api(()=>window.__pivoPlateTest.getProject().name),'CORRUPT-RECOVERY');assert.equal(await api(async()=>{const r=await(await import('/src/io/project.ts')).inspectAutosave();return r.status;}),'invalid');assert.equal(await page.getByRole('button',{name:'Download recovery backup',exact:true}).isVisible(),true);
 });
 await check('project aggregate pixel preflight rejects before IDAT inflation',async()=>{
  const message=await api(async()=>{const f=await import('/tests/png-fixtures.ts'),e=await import('/src/core/editor.ts');const b=f.assemble([{type:'IHDR',data:f.header(4096,4096)},{type:'IDAT',data:new Uint8Array([1])},{type:'IEND',data:new Uint8Array()}]);const p=e.createProject();p.atlases=[0,1,2].map(i=>({id:'budget-'+i,name:'Budget',width:4096,height:4096,tileWidth:16,tileHeight:16,margin:0,spacing:0,dataUrl:f.dataUrlUnchecked(b)}));try{e.validateProject(p);return'accepted';}catch(err){return err.message;}});assert.match(message,/aggregate pixel budget/);
 });
 // Rejected upload is intentionally logged as a readable nonfatal UI error.
 await check('no unexpected runtime errors',async()=>{const unexpected=errors.filter(m=>!m.startsWith('[PiVo Plate] Atlas import failed:'));assert.deepEqual(unexpected,[]);});
 await writeFile(root+'test-results/png-report.json',JSON.stringify({browser:await browser.version(),passed:checks.length,checks,expectedUploadErrors:errors.filter(m=>m.startsWith('[PiVo Plate] Atlas import failed:')),unexpectedErrors:errors.filter(m=>!m.startsWith('[PiVo Plate] Atlas import failed:'))},null,2));console.log(JSON.stringify({passed:checks.length,unexpectedErrors:errors.filter(m=>!m.startsWith('[PiVo Plate] Atlas import failed:'))},null,2));
}catch(e){console.error(e);if(browser){const p=browser.contexts().flatMap(c=>c.pages())[0];if(p){await p.screenshot({path:root+'test-results/png-failure.png'});console.error((await p.locator('body').innerText()).slice(-1800));}}await writeFile(root+'test-results/png-report.json',JSON.stringify({checks,errors,failure:String(e)},null,2));process.exitCode=1;}finally{if(browser)await browser.close();server.kill('SIGTERM');}
