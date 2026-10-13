import {build} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
process.env.PIVO_STANDALONE='1';
const results=await build({configFile:path.join(root,'vite.config.ts'),plugins:[{
 name:'standalone-pwa',enforce:'pre',
 resolveId(id){if(id==='virtual:pwa-register')return '\0standalone-pwa';},
 load(id){if(id==='\0standalone-pwa')return 'export const registerSW=()=>async()=>{};';}
}],build:{outDir:path.join(root,'dist-standalone'),emptyOutDir:true,rollupOptions:{output:{inlineDynamicImports:true}}}});
const output=Array.isArray(results)?results[0].output:results.output;
const chunks=output.filter(item=>item.type==='chunk');
if(chunks.length!==1)throw Error('Standalone packaging requires one JavaScript entry');
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const html=output.find(item=>item.type==='asset'&&item.fileName==='index.html');
if(!html)throw Error('Standalone build has no index.html');
let content=String(html.source);
content=content.replace(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*><\/script>/g,'');
content=content.replace(/<link\b[^>]*(?:rel=["'](?:stylesheet|modulepreload)["'])[^>]*>/g,'');
const css=output.filter(item=>item.type==='asset'&&item.fileName.endsWith('.css')).map(item=>String(item.source)).join('\n');
content=content.replace('</head>',()=>`<style>${css.replace(/<\/style/gi,'<\\/style')}</style></head>`);
let javascript=chunks[0].code;
for(const asset of output.filter(item=>item.type==='asset'&&item.fileName.endsWith('.js'))){
 const embedded=JSON.stringify(`data:text/javascript;base64,${Buffer.from(asset.source).toString('base64')}`);
 const escaped=path.basename(asset.fileName).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 javascript=javascript.replace(new RegExp(`new URL\\(["'][^"']*${escaped}["'],import\\.meta\\.url\\)\\.href`,'g'),embedded);
}
content=content.replace('</body>',()=>`<script type="module">${javascript.replace(/<\/script/gi,'<\\/script')}</script></body>`);
// Replace favicon references too: file:// builds must not need sibling assets.
content=content.replace(/(?:href|src)=["']([^"']+)["']/g,(match,url)=>{
 if(/^(?:data:|https?:|#)/.test(url))return match;
 const asset=output.find(item=>item.type==='asset'&&(url.endsWith(item.fileName)));
 if(!asset)return match;
 const type=asset.fileName.endsWith('.svg')?'image/svg+xml':asset.fileName.endsWith('.png')?'image/png':'application/octet-stream';
 return match.replace(url,`data:${type};base64,${Buffer.from(asset.source).toString('base64')}`);
});
await mkdir(path.join(root,'dist'),{recursive:true});
const noticePaths=[path.join(root,'LICENSE'),path.join(root,'THIRD_PARTY_NOTICES.txt'),path.join(root,'THIRD_PARTY_NOTICES.md')];
for(const directory of ['docs/third-party','docs/licenses']){
 const folder=path.join(root,directory);if(existsSync(folder))noticePaths.push(...readdirSync(folder).filter(file=>file.endsWith('.txt')).map(file=>path.join(folder,file)));
}
const notices=noticePaths.filter(existsSync).map(file=>readFileSync(file,'utf8')).join('\n\n');
content=content.replace('</body>',()=>`<!-- Dependency notices\n${notices.replace(/--/g,'—')}\n--></body>`);
const target=path.join(root,'dist',`${pkg.name}-standalone.html`);
await writeFile(target,content);
if(pkg.name==='pivo-craft')await writeFile(path.join(root,'dist','standalone.html'),content);
console.log(`Standalone editor: ${target} (${Buffer.byteLength(content)} bytes)`);
