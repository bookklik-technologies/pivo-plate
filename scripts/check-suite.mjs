import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';

const root=process.cwd(),manifestPath=path.join(root,'suite-manifest.json');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
// Hash consistent LF text on both Windows and Linux checkouts.
const hash=file=>createHash('sha256').update(readFileSync(file,'utf8').replace(/\r\n/g,'\n')).digest('hex');
const canonical=path.resolve(root,'../pivo-suite');
const names={'suite.ts':'suite.ts','suite.css':'suite.css','suite-recovery.ts':'recovery.ts','suite-pwa.ts':'pwa.ts','suite-worker.ts':'worker-client.ts'};
const refresh=process.argv.includes('--refresh');
for(const [file,source] of Object.entries(names)){
  const actual=hash(path.join(root,manifest.root,file));
  if(existsSync(path.join(canonical,source))&&actual!==hash(path.join(canonical,source)))throw Error(`Canonical suite drift: ${file}`);
  if(refresh)manifest.files[file]=actual;
  else if(actual!==manifest.files[file])throw Error(`Suite manifest mismatch: ${file}`);
}
if(refresh)writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(`Shared suite ${manifest.version}: verified`);
