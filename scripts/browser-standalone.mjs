import {chromium,firefox,webkit} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const name=JSON.parse(await readFile('package.json','utf8')).name,results=[];
for(const engine of (process.env.PIVO_BROWSERS??'chromium,firefox,webkit').split(',')){
 const type={chromium,firefox,webkit}[engine];
 let browser;try{
  browser=await type.launch({headless:true,...(engine==='chromium'?{args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}:{})});
  const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await page.goto(pathToFileURL(path.resolve(`dist/${name}-standalone.html`)).href,{waitUntil:'networkidle'});
  const cancel=page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true});if(await cancel.count())await cancel.click();
  const download=page.waitForEvent('download');await page.locator('.suite-header-actions').getByRole('button',{name:'Save project',exact:true}).click();
  const file=await download,bytes=await readFile(await file.path());assert.ok(bytes.length>100);assert.equal(await page.evaluate(()=>document.documentElement.dataset.archiveBusy??'0'),'0');
  assert.equal(await page.locator('.suite-header a').count(),0);
  const help=name==='pivo-plate'?page.locator('.suite-menus').getByRole('button',{name:'Help',exact:true}):page.locator('.suite-menus > details > summary').filter({hasText:/^Help$/});await help.click();await page.locator('.suite-app-menu-popup:visible').getByRole('button',{name:/^About PiVo /}).click();
  const about=page.getByRole('dialog');await about.waitFor();assert.equal(await about.getByRole('link',{name:'Documentation',exact:true}).getAttribute('href'),`https://bookklik-technologies.github.io/${name}/docs/`);await about.getByRole('button',{name:'Close',exact:true}).click();await about.waitFor({state:'hidden'});
  await help.click();await page.locator('.suite-app-menu-popup:visible').getByRole('button',{name:'Keyboard shortcuts…',exact:true}).click();const shortcuts=page.getByRole('dialog');assert.equal(await shortcuts.locator('.suite-shortcuts-title').textContent(),'Keyboard shortcuts');assert.deepEqual(await shortcuts.locator('.suite-shortcut-table').first().locator('tbody tr th').allTextContents().then(keys=>keys.slice(0,4)),['Ctrl+S','Ctrl+O','Ctrl+Z','Ctrl+Shift+Z / Ctrl+Y']);
  const backdrop=await page.evaluate(()=>{const native=document.querySelector('dialog[open]'),overlay=document.querySelector('.dialog-backdrop,.modal-overlay'),style=native?getComputedStyle(native,'::backdrop'):getComputedStyle(overlay);return {color:style.backgroundColor,blur:style.backdropFilter??style.webkitBackdropFilter};});assert.deepEqual(backdrop,{color:'rgba(3, 8, 13, 0.6)',blur:'none'});await shortcuts.getByRole('button',{name:'Close',exact:true}).click();
  assert.deepEqual(errors,[]);results.push({engine,passed:true,filename:file.suggestedFilename()});await context.close();
 }catch(error){results.push({engine,passed:false,error:String(error)});}finally{await browser?.close();}
}
await mkdir('test-results/readiness',{recursive:true});await writeFile('test-results/readiness/standalone-report.json',JSON.stringify({app:name,results},null,2));console.log(JSON.stringify(results,null,2));if(results.some(result=>!result.passed))process.exitCode=1;
