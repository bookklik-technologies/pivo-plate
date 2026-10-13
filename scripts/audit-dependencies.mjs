import {spawnSync} from 'node:child_process';
// VitePress 1.6.4 is used only to build static files; no vulnerable dev server is exposed.
const result=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['audit','--json'],{encoding:'utf8',shell:process.platform==='win32'});
let report;try{report=JSON.parse(result.stdout);}catch{throw Error('Dependency audit unavailable: '+result.stderr);}
if(report.error)throw Error(JSON.stringify(report.error));
const exceptions=new Set(['vitepress','vite','esbuild']);
const advisoryExceptions=new Set([
 'GHSA-67mh-4wv8-2f99','GHSA-4w7w-66w2-5vf9','GHSA-p9ff-h696-f583',
 'GHSA-v6wh-96g9-6wx3','GHSA-fx2h-pf6j-xcff',
]);
const blocking=Object.entries(report.vulnerabilities??{}).filter(([name,value])=>{
 const known=(value.via??[]).every(via=>typeof via==='string'?exceptions.has(via):advisoryExceptions.has(via.url?.split('/').pop()));
 const buildOnly=known&&exceptions.has(name)&&value.nodes?.every(node=>node==='node_modules/vitepress'||node.startsWith('node_modules/vitepress/'));
 return !buildOnly;
});
console.log(JSON.stringify({counts:report.metadata?.vulnerabilities,buildOnlyExceptions:['VitePress nested Vite/esbuild; static build only, no dev server'],blocking:blocking.map(([name,value])=>({name,severity:value.severity,nodes:value.nodes}))},null,2));
if(blocking.length)process.exitCode=1;
