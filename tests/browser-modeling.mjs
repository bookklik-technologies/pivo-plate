import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url).pathname;
await mkdir(root+'test-results',{recursive:true});
const server=spawn(process.execPath,[root+'node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4182','--strictPort'],{cwd:root,stdio:'pipe'});
let browser;const checks=[],errors=[];
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
function near(a,b,tol=1e-5){a.forEach((n,i)=>assert.ok(Math.abs(n-b[i])<tol,`${a} vs ${b}`));}
try{
 await new Promise((res,rej)=>{const t=setTimeout(()=>rej(Error('Vite timeout')),15000);server.stdout.on('data',s=>{if(String(s).includes('http://127.0.0.1:4182')){clearTimeout(t);res();}});server.on('exit',code=>rej(Error('Vite exited '+code)));});
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:4182/',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__pivoPlateTest);
 const api=(fn,arg)=>page.evaluate(fn,arg),canvas=page.locator('#viewport-host > canvas');
 async function menu(name,item){await page.getByRole('button',{name,exact:true}).click();await page.locator('.menu-popup').getByRole('button',{name:item,exact:false}).click();}
 async function chooseFaces(ids){await api(ids=>{const a=window.__pivoPlateTest;a.getSession().selection={tileIds:ids,vertices:[]};a.setMode('edit');},ids);}
 const id=await api(()=>window.__pivoPlateTest.getProject().tiles[0].id);
 await check('Apply Brush is present and disabled without face selection',async()=>{await page.getByRole('button',{name:'Atlas',exact:true}).click();assert.equal(await page.locator('#atlas-apply-brush').isDisabled(),true);await page.getByRole('button',{name:'Edit',exact:true}).first().click();assert.equal(await page.locator('.menu-popup').getByRole('button',{name:'Apply Brush',exact:true}).isDisabled(),true);await page.mouse.click(700,25);});
 await check('Edit Apply Brush remaps UVs without changing geometry in one transaction',async()=>{
  await chooseFaces([id]);await api(()=>window.__pivoPlateTest.setBrush(0,1,0));const before=await api(id=>window.__pivoPlateTest.getProject().tiles.find(t=>t.id===id),id),r=await api(()=>window.__pivoPlateTest.getRevision());
  await menu('Edit','Apply Brush');const after=await api(id=>window.__pivoPlateTest.getProject().tiles.find(t=>t.id===id),id);assert.deepEqual(after.vertices,before.vertices);assert.notDeepEqual(after.uvs,before.uvs);assert.equal(await api(()=>window.__pivoPlateTest.getRevision()),r+1);
  await canvas.focus();await page.keyboard.press('Control+z');assert.deepEqual(await api(id=>window.__pivoPlateTest.getProject().tiles.find(t=>t.id===id),id),before);await page.keyboard.press('Control+y');assert.deepEqual(await api(id=>window.__pivoPlateTest.getProject().tiles.find(t=>t.id===id),id),after);
 });
 await check('Atlas Apply Brush uses quarter turns and flips',async()=>{
  await page.getByRole('button',{name:'Atlas',exact:true}).click();await page.getByRole('button',{name:'90°',exact:true}).click();await page.getByRole('button',{name:'Flip X',exact:true}).click();await page.locator('#atlas-apply-brush').click();const correct=await api(async id=>{const a=window.__pivoPlateTest,{brushUVs}=await import('/src/core/editor.ts');const p=a.getProject(),s=a.getSession(),t=p.tiles.find(t=>t.id===id);return JSON.stringify(t.uvs)===JSON.stringify(brushUVs(p.atlases.find(x=>x.id===s.brush.atlasId),s.brush));},id);assert.equal(correct,true);
 });
 await check('hidden-tab PNG import is fitted on first visible refresh',async()=>{
  await page.getByRole('button',{name:'Scene',exact:true}).click();const dataUrl=await api(()=>{const c=document.createElement('canvas');c.width=32;c.height=16;const g=c.getContext('2d');g.fillStyle='#d84932';g.fillRect(0,0,16,16);g.fillStyle='#367fcc';g.fillRect(16,0,16,16);return c.toDataURL('image/png');});const count=await api(()=>window.__pivoPlateTest.getProject().atlases.length);await page.locator('aside input[type=file]').setInputFiles({name:'hidden-two-tone.png',mimeType:'image/png',buffer:Buffer.from(dataUrl.split(',')[1],'base64')});await page.waitForFunction(n=>window.__pivoPlateTest.getProject().atlases.length===n+1,count);
  await page.waitForFunction(()=>window.__pivoPlateTest.getAtlasView().imageReady);
  assert.equal(await api(()=>window.__pivoPlateTest.getAtlasView().needsFit),true);
  await page.getByRole('button',{name:'Atlas',exact:true}).click();await page.waitForFunction(()=>!window.__pivoPlateTest.getAtlasView().needsFit);
  const result=await api(()=>{const c=document.getElementById('atlas-canvas'),wrap=c.parentElement,a=window.__pivoPlateTest.getProject().atlases.at(-1),v=window.__pivoPlateTest.getAtlasView();return {zoom:v.zoom,expected:Math.min(wrap.clientWidth/a.width,wrap.clientHeight/a.height),pixel:[...c.getContext('2d').getImageData(Math.floor(c.width*.75),Math.floor(c.height*.25),1,1).data]};});assert.ok(result.zoom>1);assert.ok(Math.abs(result.zoom-result.expected)<.01);assert.ok(result.pixel[2]>result.pixel[0]);
 });
 await check('Apply Brush reassigns to imported atlas and respects ancestor locking',async()=>{
  await page.locator('#atlas-tileWidth').fill('16');await page.locator('#atlas-tileWidth').press('Tab');await page.locator('#atlas-tileHeight').fill('16');await page.locator('#atlas-tileHeight').press('Tab');await api(()=>window.__pivoPlateTest.setBrush(window.__pivoPlateTest.getProject().atlases.length-1,1,0));await chooseFaces([id]);await page.locator('#atlas-apply-brush').click();const after=await api(id=>window.__pivoPlateTest.getProject().tiles.find(t=>t.id===id),id);assert.equal(after.atlasId,await api(()=>window.__pivoPlateTest.getProject().atlases.at(-1).id));
  await api(id=>{const a=window.__pivoPlateTest;a.store.transact('Lock selected',p=>{const t=p.tiles.find(t=>t.id===id);p.objects.find(o=>o.id===t.objectId).locked=true;});},id);assert.equal(await page.locator('#atlas-apply-brush').isDisabled(),true);
  await api(id=>{const a=window.__pivoPlateTest;a.store.transact('Unlock selected',p=>{const t=p.tiles.find(t=>t.id===id);p.objects.find(o=>o.id===t.objectId).locked=false;});},id);
 });
 await check('ordinary tab switching preserves manual atlas zoom',async()=>{
  await page.locator('#atlas-canvas-wrap').hover();await page.mouse.wheel(0,-160);const zoom=await api(()=>window.__pivoPlateTest.getAtlasView().zoom);await page.getByRole('button',{name:'Props',exact:true}).click();await page.getByRole('button',{name:'Atlas',exact:true}).click();assert.equal(await api(()=>window.__pivoPlateTest.getAtlasView().zoom),zoom);
 });
 await check('sidebar Frame selection moves the actual camera/target',async()=>{
  await chooseFaces([id]);await api(id=>{const a=window.__pivoPlateTest;a.store.transact('Move far face',p=>{const t=p.tiles.find(t=>t.id===id);t.vertices=t.vertices.map(v=>[v[0]+20,v[1]+2,v[2]]);});a.frameAll();},id);await page.getByRole('button',{name:'Props',exact:true}).click();const before=await api(()=>window.__pivoPlateTest.getCameraState());await page.locator('.side-page.active .act-frame').click();const after=await api(()=>window.__pivoPlateTest.getCameraState());assert.notDeepEqual(after.position,before.position);const center=await api(id=>window.__pivoPlateTest.getProject().tiles.find(t=>t.id===id).vertices.reduce((s,v)=>s.map((n,i)=>n+v[i]/4),[0,0,0]),id);near(after.target,center);
 });
 await check('plane tooltips match working X/Z/C shortcuts',async()=>{
  await api(()=>window.__pivoPlateTest.setPlane('XY',true));const mappings=[['XY','x'],['XZ','z'],['YZ','c']];for(const [plane,key] of mappings){assert.equal(await page.locator('[data-rail="plane-'+plane+'"]').getAttribute('title'),`Plane ${plane} (key ${key})`);await canvas.focus();await page.keyboard.press(key);assert.equal(await api(()=>window.__pivoPlateTest.getSession().plane),plane);}
 });
 await check('deformed quad renderer and independently loaded GLB normals agree',async()=>{
  const result=await api(async id=>{const a=window.__pivoPlateTest;a.store.transact('Deform quad',p=>{const t=p.tiles.find(t=>t.id===id);t.vertices=[[0,0,0],[1,0,0],[1,1,0],[0,1,1]];});const {exportGLB}=await import('/src/io/export.ts');const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');const p=a.getProject();p.tiles=p.tiles.filter(t=>t.id===id);const b=await exportGLB(p),scene=(await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;let normals;scene.traverse(o=>{if(o.isMesh){const n=o.geometry.attributes.normal;normals=[0,1,2,3].map(i=>[n.getX(i),n.getY(i),n.getZ(i)]);}});return {viewport:a.getTileNormals(id),glb:normals};},id);
  const expected=[1/Math.sqrt(3),-1/Math.sqrt(3),1/Math.sqrt(3)];near(result.viewport[3],expected);near(result.glb[3],expected);result.viewport.forEach((v,i)=>near(v,result.glb[i]));
 });
 await check('no console or uncaught errors from modeling workflows',async()=>assert.deepEqual(errors,[]));
 await writeFile(root+'test-results/modeling-report.json',JSON.stringify({browser:await browser.version(),passed:checks.length,checks,errors},null,2));console.log(JSON.stringify({passed:checks.length,errors},null,2));
}catch(e){console.error(e);if(browser){const p=browser.contexts().flatMap(c=>c.pages())[0];if(p){await p.screenshot({path:root+'test-results/modeling-failure.png'});console.error((await p.locator('body').innerText()).slice(-1600));}}await writeFile(root+'test-results/modeling-report.json',JSON.stringify({checks,errors,failure:String(e)},null,2));process.exitCode=1;}finally{if(browser)await browser.close();server.kill('SIGTERM');}
