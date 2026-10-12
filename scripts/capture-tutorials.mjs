import { join } from 'node:path';
import { startCapture } from './tutorial-capture-lib.mjs';

const capture = await startCapture(new URL('../', import.meta.url), 5183);
const { page, shot, download, out, settle } = capture;
const button = name => page.getByRole('button',{name,exact:true});
const canvas = page.locator('#viewport-host > canvas');
async function menu(label,item) { await button(label).click(); await page.locator('.menu-popup').getByRole('button',{name:item,exact:false}).click(); }
async function key(value) { await canvas.focus(); await page.keyboard.press(value); await settle(); }
async function cell(col,row) {
  await page.getByRole('tab',{name:'Atlas',exact:true}).click(); await settle();
  const box = await page.locator('#atlas-canvas').boundingBox();
  const zoom = Math.min(box.width/110,box.height/56);
  await page.mouse.click(box.x+(2+col*18+8)*zoom,box.y+(2+row*18+8)*zoom);
}
async function world(point,modifiers) {
  const pos=await page.evaluate(v=>window.__pivoPlateTest.projectPoint(v),point);
  for(const modifier of modifiers??[]) await page.keyboard.down(modifier);
  try { await page.mouse.click(pos.x,pos.y); } finally { for(const modifier of modifiers??[]) await page.keyboard.up(modifier); }
}
async function save(name) { await download(name,()=>menu('File','Save project')); }
async function reopen(name) {
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),menu('File','Open .pvp…')]); await chooser.setFiles(join(out,name)); await page.getByText(`Opened ${name}`,{exact:true}).waitFor({state:'visible'}); await settle();
}
try {
  await menu('File','New (demo tileset)'); await shot('platform-01-new');
  await cell(0,0); await shot('platform-02-atlas',page.locator('#atlas-canvas-wrap'));
  await page.getByRole('tab',{name:'Properties',exact:true}).click(); await key('z'); await key('l');
  await page.locator('summary').filter({hasText:/^Construction settings$/}).click();
  await shot('platform-03-plane',page.locator('.suite-construction .suite-menu-popup')); await page.mouse.click(700,25);
  for(let z=0;z<3;z++)for(let x=0;x<3;x++)await world([x+.5,0,z+.5]);
  await key('Home'); await save('stone-platform.pvp'); await shot('platform-04-finished');
  await reopen('stone-platform.pvp'); await shot('wall-01-platform');
  await cell(3,1); await page.getByRole('tab',{name:'Properties',exact:true}).click(); await key('x');
  // Opening a project resets session state, so explicitly lock the new plane.
  await key('l');
  await page.locator('#crosshair-z').fill('0'); await page.locator('#crosshair-z').press('Tab');
  await shot('wall-02-plane');
  for(let y=0;y<2;y++)for(let x=0;x<3;x++)await world([x+.5,y+.5,0]);
  await key('Home'); await shot('wall-03-drawn');
  await key('Tab');
  for(let y=0;y<2;y++)for(let x=0;x<3;x++)await world([x+.5,y+.5,0],(x||y)?['Shift']:[]);
  await button('Group selected').click();
  await button('Rename Group 1').click(); await page.locator('#obj-tree input').fill('Wall'); await page.locator('#obj-tree input').press('Enter');
  await shot('wall-04-group'); await save('platform-wall.pvp'); await reopen('platform-wall.pvp');
  await key('Tab'); await world([1.5,0,1.5]); await shot('export-01-selected');
  await cell(1,0); await shot('export-02-brush'); await button('Apply Brush').click();
  await shot('export-03-applied'); await save('finished-platform.pvp'); await reopen('finished-platform.pvp');
  const project=await page.evaluate(()=>window.__pivoPlateTest.getProject());
  const wall=project.objects.find(o=>o.name==='Wall');
  if(project.tiles.length!==15||!wall||project.tiles.filter(t=>t.objectId===wall.id).length!==6)throw new Error('Plate checkpoint differs from tutorial');
  await menu('File','Export…'); await page.getByLabel('Export format',{exact:true}).selectOption('glb');
  await shot('export-04-glb',page.locator('.modal-box'));
  await download('finished-platform.glb',()=>page.locator('.modal-box').getByRole('button',{name:'Export',exact:true}).click());
  await capture.report({project:'Stone platform and wall',tiles:15,checkpointsReopened:['stone-platform.pvp','platform-wall.pvp','finished-platform.pvp']});
}catch(error){await page.screenshot({path:join(out,'capture-error.png')});throw error;}finally{await capture.close();}
