// Manual public-asset capture for an exact deployed service-worker upgrade check.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const name=JSON.parse(await readFile('package.json','utf8')).name.split('/').pop();
const origin=`https://bookklik-technologies.github.io/${name}/`;
const root=path.resolve('test-results/predecessor');await mkdir(root,{recursive:true});
const fetchFile=async file=>{
 if(file.startsWith('/')||file.includes('..')||/^https?:/.test(file))throw Error('Unexpected predecessor asset path');
 const response=await fetch(new URL(file,origin),{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error(`${file}: ${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer());const destination=path.join(root,file);await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,bytes);return bytes;
};
const sw=await fetchFile('sw.js'),text=sw.toString();
const assets=new Set([...text.matchAll(/url:"([^"]+)"/g)].map(match=>match[1]));
for(const dependency of text.matchAll(/"\.\/(workbox-[a-z0-9]+)"/g))assets.add(dependency[1]+'.js');
const files={'sw.js':createHash('sha256').update(sw).digest('hex')};
for(const file of assets){const bytes=await fetchFile(file);files[file]=createHash('sha256').update(bytes).digest('hex');}
await writeFile(path.join(root,'capture.json'),JSON.stringify({origin,date:new Date().toISOString(),files},null,2));
console.log(JSON.stringify({origin,assets:Object.keys(files).length,serviceWorkerSha256:files['sw.js']},null,2));
