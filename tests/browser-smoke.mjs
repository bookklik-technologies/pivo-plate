import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
const root = new URL('../', import.meta.url).pathname;
const server = spawn(process.execPath, [root + 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4175'], {cwd:root, stdio:'pipe'});
let browser;
try {
  await new Promise((resolve,reject) => { const t=setTimeout(()=>reject(new Error('Vite did not start')),15000); server.stdout.on('data',s=>{if(String(s).includes('4175')){clearTimeout(t);resolve();}});server.on('error',reject); });
  browser = await chromium.launch({headless:true, args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[], warnings=[];
  page.on('pageerror',err=>errors.push(String(err)));
  page.on('console',msg=>{if(msg.type()==='error') errors.push(msg.text());if(msg.type()==='warning') warnings.push(msg.text());});
  await page.goto('http://127.0.0.1:4175/',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__pivoPlateTest,{timeout:15000});
  // Startup help is a nonblocking toast; the editor is immediately interactive.
  await page.screenshot({path:root+'browser-initial.png'});
  const report = await page.evaluate(()=>({stats:window.__pivoPlateTest.stats(),renderer:window.__pivoPlateTest.getRendererInfo(),session:window.__pivoPlateTest.getSession(),text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(e=>({id:e.id,text:e.textContent,title:e.title})),inputs:[...document.querySelectorAll('input')].map(e=>({id:e.id,type:e.type,value:e.value}))}));
  await writeFile(root+'browser-initial.json',JSON.stringify({...report,errors,warnings},null,2));
  console.log(JSON.stringify({stats:report.stats,renderer:report.renderer,errors,warnings},null,2));
} finally { if(browser) await browser.close(); server.kill('SIGTERM'); }
