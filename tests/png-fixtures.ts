import { zlibSync,unzlibSync } from 'fflate';
import { pngCrc32,pngBytesDataUrl } from '../src/core/png';

export interface Chunk {type:string;data:Uint8Array}
export function concat(parts:Uint8Array[]):Uint8Array {const result=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let pos=0;for(const p of parts){result.set(p,pos);pos+=p.length;}return result;}
export function chunk(type:string,data:Uint8Array):Uint8Array {const result=new Uint8Array(data.length+12),v=new DataView(result.buffer);v.setUint32(0,data.length);result.set(new TextEncoder().encode(type),4);result.set(data,8);v.setUint32(data.length+8,pngCrc32(result.subarray(4,data.length+8)));return result;}
export function assemble(chunks:Chunk[]):Uint8Array{return concat([new Uint8Array([137,80,78,71,13,10,26,10]),...chunks.map(c=>chunk(c.type,c.data))]);}
export function chunks(bytes:Uint8Array):Chunk[]{const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);const result:Chunk[]=[];for(let p=8;p<bytes.length;){const n=v.getUint32(p);result.push({type:new TextDecoder().decode(bytes.subarray(p+4,p+8)),data:bytes.slice(p+8,p+8+n)});p+=n+12;}return result;}
export function withChunks(bytes:Uint8Array,fn:(c:Chunk[])=>Chunk[]):Uint8Array{return assemble(fn(chunks(bytes)));}
export function header(width:number,height:number,depth=8,color=6,interlace=0):Uint8Array{const h=new Uint8Array(13),v=new DataView(h.buffer);v.setUint32(0,width);v.setUint32(4,height);h[8]=depth;h[9]=color;h[12]=interlace;return h;}
const channels:Record<number,number>={0:1,2:3,3:1,4:2,6:4};
const steps=[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]];
export function rawPng(width=2,height=2,depth=8,color=6,interlace=0,scanlines?:Uint8Array,extras:Chunk[]=[]):Uint8Array {
 const parts:Uint8Array[]=[];
 for(const [x,y,dx,dy] of interlace?steps:[[0,0,1,1]]){const w=Math.max(0,Math.ceil((width-x)/dx)),h=Math.max(0,Math.ceil((height-y)/dy));if(w&&h)parts.push(new Uint8Array((Math.ceil(w*channels[color]*depth/8)+1)*h));}
 const raw=scanlines??concat(parts),list:Chunk[]=[{type:'IHDR',data:header(width,height,depth,color,interlace)},...extras];
 if(color===3&&!extras.some(c=>c.type==='PLTE'))list.push({type:'PLTE',data:new Uint8Array([255,0,0,0,0,255])});
 list.push({type:'IDAT',data:zlibSync(raw)},{type:'IEND',data:new Uint8Array()});return assemble(list);
}
export function replaceRaw(bytes:Uint8Array,fn:(raw:Uint8Array)=>Uint8Array):Uint8Array {return withChunks(bytes,list=>list.map(c=>c.type==='IDAT'?{...c,data:zlibSync(fn(unzlibSync(c.data)))}:c));}
export function dataUrlUnchecked(bytes:Uint8Array):string {return pngBytesDataUrl(bytes);}
