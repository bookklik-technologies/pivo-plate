import {describe,it,expect} from 'vitest';
import {zlibSync,strToU8,zipSync} from 'fflate';
import {validatePngBytes,validatePngDataUrl,preflightPngDataUrl,pngDataUrlBytes,pngBytesDataUrl,pngCrc32,PNG_LIMITS,PROJECT_PNG_LIMITS,checkProjectPngBudget} from '../src/core/png';
import {validateProject,EditorStore} from '../src/core/editor';
import {encodeProject,decodeProject} from '../src/io/project';
import {exportGLB,exportOBJ} from '../src/io/export';
import {buildContainer,dataUrlToBytes} from '../src/io/util';
import {rawPng,withChunks,chunks,assemble,header,replaceRaw,concat,dataUrlUnchecked} from './png-fixtures';
import {makeProject,makeAtlas,makeTile} from './fixtures';

const rgba=rawPng();
function atlas(bytes=rgba,extra:Partial<ReturnType<typeof makeAtlas>>={}){return makeAtlas({dataUrl:dataUrlUnchecked(bytes),...extra});}
function corrupt(){const p=rgba.slice();p[p.length-1]^=1;return p;}

// All legal PNG color/depth families plus Adam7 have exact row layouts.
const formats:[[number,number],...Array<[number,number]>]=[[0,1],[0,2],[0,4],[0,8],[0,16],[2,8],[2,16],[3,1],[3,2],[3,4],[3,8],[4,8],[4,16],[6,8],[6,16]];
describe('PNG valid encodings',()=>{
 it('CRC matches the independent standard check vector',()=>expect(pngCrc32(strToU8('123456789'))).toBe(0xcbf43926));
 it.each(formats)('color %i / depth %i validates', (color,depth)=>{const bytes=rawPng(9,7,depth,color);const info=validatePngBytes(bytes);expect([info.width,info.height,info.bitDepth,info.colorType]).toEqual([9,7,depth,color]);});
 it.each([0,2,3,4,6])('Adam7 color %i validates empty/nonempty passes',color=>{const bytes=rawPng(9,7,color===3?2:8,color,1);expect(validatePngBytes(bytes).interlace).toBe(1);expect(validatePngBytes(rawPng(1,1,color===3?1:8,color,1)).width).toBe(1);});
 it.each([0,1,2,3,4])('filter %i is valid and row reconstruction bounded',filter=>{const raw=new Uint8Array(18);raw[0]=filter;raw[9]=filter;expect(validatePngBytes(rawPng(2,2,8,6,0,raw)).inflatedBytes).toBe(18);});
 it('multiple contiguous IDAT chunks including split zlib header validate',()=>{const b=withChunks(rgba,cs=>cs.flatMap(c=>c.type==='IDAT'?[{type:'IDAT',data:c.data.slice(0,1)},{type:'IDAT',data:c.data.slice(1,2)},{type:'IDAT',data:c.data.slice(2)}]:[c]));expect(validatePngBytes(b).width).toBe(2);});
 it('indexed transparency is valid',()=>expect(validatePngBytes(rawPng(2,2,1,3,0,undefined,[{type:'PLTE',data:new Uint8Array([255,0,0,0,0,255])},{type:'tRNS',data:new Uint8Array([0,255])}])).colorType).toBe(3));
 it('valid text metadata does not affect dimensions',()=>expect(validatePngBytes(rawPng(2,2,8,6,0,undefined,[{type:'zTXt',data:concat([strToU8('note'),new Uint8Array([0,0]),zlibSync(strToU8('hello'))])}])).width).toBe(2));
 it('byte/string paths preserve source bytes and verify expected dimensions',()=>{const url=pngBytesDataUrl(rgba);expect(pngDataUrlBytes(url)).toEqual(rgba);expect(validatePngDataUrl(url,{width:2,height:2}).width).toBe(2);expect(preflightPngDataUrl(url).width).toBe(2);});
});

const bads:[string,()=>Uint8Array,RegExp][]=[
 ['bad signature',()=>new Uint8Array(32),/signature/],
 ['truncated header',()=>rgba.slice(0,15),/truncated/],
 ['CRC mismatch',corrupt,/CRC/],
 ['signature and IHDR only',()=>assemble(chunks(rgba).filter(c=>c.type==='IHDR')),/missing/],
 ['missing IEND',()=>assemble(chunks(rgba).filter(c=>c.type!=='IEND')),/missing/],
 ['missing IDAT',()=>assemble(chunks(rgba).filter(c=>c.type!=='IDAT')),/missing|IEND/],
 ['duplicate IHDR',()=>withChunks(rgba,c=>[c[0],c[0],...c.slice(1)]),/IHDR/],
 ['misordered IHDR',()=>withChunks(rgba,c=>[c[1],c[0],c[2]]),/IHDR/],
 ['unknown critical chunk',()=>rawPng(2,2,8,6,0,undefined,[{type:'ABCD',data:new Uint8Array()}]),/critical/],
 ['reserved chunk bit',()=>rawPng(2,2,8,6,0,undefined,[{type:'abca',data:new Uint8Array()}]),/reserved/],
 ['illegal encoding',()=>withChunks(rgba,c=>c.map(x=>x.type==='IHDR'?{...x,data:header(2,2,4,6)}:x)),/bit depth|IHDR/],
 ['nonconsecutive IDAT',()=>withChunks(rgba,c=>{const d=c[1].data;return [c[0],{type:'IDAT',data:d.slice(0,2)},{type:'tEXt',data:strToU8('a\0b')},{type:'IDAT',data:d.slice(2)},c[2]];}),/nonconsecutive/],
 ['trailing bytes',()=>concat([rgba,new Uint8Array([0])]),/trailing/],
 ['palette missing',()=>withChunks(rawPng(2,2,1,3),c=>c.filter(x=>x.type!=='PLTE')),/PLTE/],
 ['palette index overflow',()=>rawPng(1,1,8,3,0,new Uint8Array([0,9])),/palette index/],
 ['invalid filter',()=>replaceRaw(rgba,r=>{r[0]=5;return r;}),/filter/],
 ['scanline underflow',()=>replaceRaw(rgba,r=>r.slice(0,-1)),/scanline length/],
 ['scanline overflow',()=>replaceRaw(rgba,r=>concat([r,new Uint8Array([0])])),/output budget|excess/],
 ['truncated deflate',()=>withChunks(rgba,c=>c.map(x=>x.type==='IDAT'?{...x,data:x.data.slice(0,3)}:x)),/zlib/],
 ['bad Adler with valid chunk CRC',()=>withChunks(rgba,c=>c.map(x=>{if(x.type!=='IDAT')return x;const d=x.data.slice();d[d.length-1]^=1;return {...x,data:d};})),/zlib/],
 ['extra zlib trailer byte',()=>withChunks(rgba,c=>c.map(x=>x.type==='IDAT'?{...x,data:concat([x.data,new Uint8Array([0])])}:x)),/extra|zlib/],
 ['APNG animation',()=>rawPng(2,2,8,6,0,undefined,[{type:'acTL',data:new Uint8Array(8)}]),/animated/],
];
describe('PNG corruption rejection',()=>{
 it.each(bads)('%s rejects without mutating input',(_name,make,pattern)=>{const bytes=make(),before=bytes.slice();expect(()=>validatePngBytes(bytes)).toThrow(pattern);expect(bytes).toEqual(before);});
 it('cached URL success never bypasses metadata comparison',()=>{const u=pngBytesDataUrl(rgba);validatePngDataUrl(u,{width:2,height:2});expect(()=>validatePngDataUrl(u,{width:64,height:64})).toThrow(/actual dimensions/);});
 it('mutable byte arrays are never cached as trusted',()=>{const b=rgba.slice();validatePngBytes(b);b[b.length-1]^=1;expect(()=>validatePngBytes(b)).toThrow(/CRC/);});
 it.each(['data:image/jpeg;base64,AAAA','data:image/png;base64,%%%%','data:image/png;base64,AAAA='])('strict URL validation rejects %s',url=>expect(()=>pngDataUrlBytes(url)).toThrow(/PNG|base64/));
});

describe('PNG resource budgets',()=>{
 it('oversized base64 rejects before invoking the decoder',()=>{const previous=globalThis.atob;let calls=0;globalThis.atob=()=>{calls++;throw new Error('must not decode');};try{const u='data:image/png;base64,'+'A'.repeat(4*Math.ceil(PNG_LIMITS.maxBytes/3)+4);expect(()=>pngDataUrlBytes(u)).toThrow(/byte budget/);expect(()=>preflightPngDataUrl(u)).toThrow(/byte budget/);expect(calls).toBe(0);}finally{globalThis.atob=previous;}});
 it('file-byte cap rejects before structural decode',()=>expect(()=>validatePngBytes(rgba,undefined,{maxBytes:rgba.length-1})).toThrow(/byte budget/));
 it('actual dimension/pixels cap rejects tiny files advertising huge images',()=>expect(()=>validatePngBytes(assemble([{type:'IHDR',data:header(50000,50000)},{type:'IDAT',data:zlibSync(new Uint8Array([0]))},{type:'IEND',data:new Uint8Array()}]))).toThrow(/dimensions\/pixels/));
 it('pixel override cap rejects valid dimensions',()=>expect(()=>validatePngBytes(rgba,undefined,{maxPixels:3})).toThrow(/pixels/));
 it('chunk-count cap is checked',()=>expect(()=>validatePngBytes(rawPng(2,2,8,6,0,undefined,Array.from({length:4},()=>({type:'tEXt',data:strToU8('a\0b')}))),undefined,{maxChunks:4})).toThrow(/chunk count/));
 it('ancillary input cap is checked',()=>expect(()=>validatePngBytes(rawPng(2,2,8,6,0,undefined,[{type:'tEXt',data:strToU8('a\0xxxxxxxxxx')}]),undefined,{maxAncillaryBytes:4})).toThrow(/ancillary/));
 it('compressed metadata cannot inflate beyond its own cap',()=>expect(()=>validatePngBytes(rawPng(2,2,8,6,0,undefined,[{type:'zTXt',data:concat([strToU8('a'),new Uint8Array([0,0]),zlibSync(new Uint8Array(4096))])}]),undefined,{maxMetadataInflatedBytes:64})).toThrow(/output budget/));
 it('image deflate bomb stops at dimension-derived output budget',()=>{const bomb=assemble([{type:'IHDR',data:header(1,1)},{type:'IDAT',data:zlibSync(new Uint8Array(1024*1024))},{type:'IEND',data:new Uint8Array()}]);expect(bomb.length).toBeLessThan(4096);expect(()=>validatePngBytes(bomb)).toThrow(/output budget/);});
 it('scanline allocation cannot exceed custom inflate cap',()=>expect(()=>validatePngBytes(rgba,undefined,{maxInflatedBytes:8})).toThrow(/scanline size/));
 it('custom budgets cannot disable the hard limits',()=>expect(()=>validatePngBytes(rgba,undefined,{maxPixels:PNG_LIMITS.maxPixels+1})).toThrow(/invalid.*budget/));
 it('aggregate declared pixels reject before invalid IDAT streams are decoded',()=>{const bytes=assemble([{type:'IHDR',data:header(4096,4096)},{type:'IDAT',data:zlibSync(new Uint8Array([0]))},{type:'IEND',data:new Uint8Array()}]);const p=makeProject({atlases:[0,1,2].map(i=>atlas(bytes,{id:'budget-'+i,width:4096,height:4096,tileWidth:16,tileHeight:16})),tiles:[]});expect(()=>validateProject(p)).toThrow(/aggregate pixel budget/);});
 it.each(['maxPngBytes','maxPixels','maxInflatedBytes','maxManifestBytes'] as const)('project %s budget enforced',key=>{const info=validatePngBytes(rgba);if(key==='maxManifestBytes')expect(()=>checkProjectPngBudget([info],PROJECT_PNG_LIMITS[key]+1)).toThrow(/manifest/);else{const fake={...info,...(key==='maxPngBytes'?{byteLength:PROJECT_PNG_LIMITS[key]+1}:key==='maxPixels'?{width:PROJECT_PNG_LIMITS[key]+1,height:1}:{inflatedBytes:PROJECT_PNG_LIMITS[key]+1})};expect(()=>checkProjectPngBudget([fake],1)).toThrow(/aggregate/);}});
});

describe('shared import/codec/recovery/export invariants',()=>{
 it('ZIP manifest and PNG entry budgets reject before decompression',async()=>{const manifest=zipSync({'project.json':new Uint8Array(PROJECT_PNG_LIMITS.maxManifestBytes+1)},{level:1});await expect(decodeProject(manifest)).rejects.toThrow(/manifest exceeds byte budget/);const image=zipSync({'project.json':strToU8('{}'),'atlases/oversized.png':new Uint8Array(PNG_LIMITS.maxBytes+1)},{level:1});await expect(decodeProject(image)).rejects.toThrow(/PNG archive entry exceeds byte budget/);});
 it('canonical validation rejects metadata spoofing',()=>expect(()=>validateProject(makeProject({atlases:[atlas(rgba,{width:64,height:64,tileWidth:16,tileHeight:16})]}))).toThrow(/actual dimensions/));
 it('bad PNG mutation rolls back all committed state',()=>{const store=new EditorStore(makeProject({atlases:[atlas()]}));const before=JSON.stringify(store.project),rev=store.revision;expect(()=>store.transact('corrupt texture',p=>p.atlases[0].dataUrl=dataUrlUnchecked(corrupt()))).toThrow(/CRC/);expect(JSON.stringify(store.project)).toBe(before);expect(store.revision).toBe(rev);expect(store.canUndo).toBe(false);});
 it('binary codec helper rejects corruption',()=>expect(()=>dataUrlToBytes(dataUrlUnchecked(corrupt()))).toThrow(/CRC/));
 it('encode and both exports reject the identical malformed PNG',async()=>{const p=makeProject({atlases:[atlas(corrupt())]});await expect(encodeProject(p)).rejects.toThrow(/CRC/);await expect(exportGLB(p)).rejects.toThrow(/CRC/);await expect(exportOBJ(p)).rejects.toThrow(/CRC/);});
 it('decode rejects corrupt embedded PNG before returning a project',async()=>{const p=makeProject({atlases:[atlas()]}),stored={...p,atlases:p.atlases.map(a=>({...a,dataUrl:''}))};const b=buildContainer(JSON.stringify(stored),[{path:'atlases/atlas-a.png',bytes:corrupt()}]);await expect(decodeProject(b)).rejects.toThrow(/not a valid PNG|CRC/);});
 it('valid PNG project still round-trips without bytes or UV changes',async()=>{const p=makeProject({atlases:[atlas()],tiles:[makeTile()]});expect(await decodeProject(await encodeProject(p))).toEqual(p);});
});
