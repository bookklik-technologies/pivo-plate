import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFile,mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url).pathname;
await mkdir(root+'test-results',{recursive:true});
const server=spawn(process.execPath,[root+'node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4177'],{cwd:root,stdio:'pipe'});
let browser;const reports=[];
try{
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Server timeout')),15000);server.stdout.on('data',s=>{if(String(s).includes('4177')){clearTimeout(t);resolve();}});server.on('error',reject);});
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:4177/',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__pivoPlateTest);
 await page.locator('.toast-x').first().click();
 for(const [width,height] of [[1920,1080],[1440,900],[1366,768],[1024,768],[900,700],[760,640],[600,700]]){
  await page.setViewportSize({width,height});
  if(width<=880 && !(await page.locator('#sidebar-right').evaluate(e=>e.classList.contains('open'))))await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();
  for(const tab of ['Atlas','Scene','Props']){
   await page.getByRole('button',{name:tab,exact:true}).click();
   const result=await page.evaluate(()=>{
    const panel=document.querySelector('.side-page.active'),r=panel.getBoundingClientRect();
    const controls=[...panel.querySelectorAll('button,input,select')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&b.height>0&&getComputedStyle(e).visibility!=='hidden'&&e.type!=='file';});
    const clipped=controls.filter(e=>{const b=e.getBoundingClientRect();return b.left<r.left-1||b.right>r.right+1||e.scrollWidth>e.clientWidth+2;}).map(e=>({id:e.id,text:e.textContent,width:e.clientWidth,scroll:e.scrollWidth,rect:e.getBoundingClientRect().toJSON()}));
    const tooSmall=controls.filter(e=>e.tagName==='BUTTON'&&e.getBoundingClientRect().height<27).map(e=>e.textContent||e.getAttribute('aria-label'));
    return {clipped,tooSmall,sideWidth:document.querySelector('#sidebar-right').getBoundingClientRect().width,bodyOverflow:document.documentElement.scrollWidth>innerWidth};
   });
   reports.push({width,height,tab,...result});
   assert.deepEqual(result.clipped,[],`Clipped controls at ${width} ${tab}`);
   assert.deepEqual(result.tooSmall,[],`Tiny controls at ${width} ${tab}`);
   assert.equal(result.bodyOverflow,false);
   if(width===1440)await page.screenshot({path:root+`test-results/refined-${tab.toLowerCase()}.png`});
  }
 }
 assert.deepEqual(errors,[]);
 await writeFile(root+'test-results/layout-report.json',JSON.stringify({layouts:reports.length,errors,reports},null,2));
 console.log(JSON.stringify({layouts:reports.length,errors},null,2));
}catch(e){console.error(e);if(browser){const p=browser.contexts().flatMap(c=>c.pages())[0];if(p)await p.screenshot({path:root+'test-results/layout-failure.png'});}await writeFile(root+'test-results/layout-report.json',JSON.stringify({failure:String(e),reports},null,2));process.exitCode=1;}finally{if(browser)await browser.close();server.kill('SIGTERM');}
