/** Shared, bounded PNG validation. No DOM/image-decoder allocation required.
 * Validates chunk grammar/CRC, zlib+Adler, scanline size/filters and palette
 * indices (including Adam7). Returns metadata, not a decoded image buffer. */
import { Inflate } from 'pako';

export const PNG_LIMITS = Object.freeze({
  maxBytes:32*1024*1024, maxDimension:16384, maxPixels:16777216,
  maxInflatedBytes:192*1024*1024, maxChunks:4096,
  maxAncillaryBytes:4*1024*1024, maxMetadataInflatedBytes:1024*1024,
});
export const PROJECT_PNG_LIMITS = Object.freeze({
  maxPngBytes:64*1024*1024, maxPixels:33554432,
  maxInflatedBytes:192*1024*1024, maxManifestBytes:24*1024*1024,
});
export interface PngLimits {maxBytes:number;maxDimension:number;maxPixels:number;maxInflatedBytes:number;maxChunks:number;maxAncillaryBytes:number;maxMetadataInflatedBytes:number}
export interface PngInfo {width:number;height:number;bitDepth:number;colorType:number;interlace:number;byteLength:number;inflatedBytes:number;chunks:number;ancillaryBytes:number}
export class PngValidationError extends Error {constructor(message:string){super(`PNG validation: ${message}`);this.name='PngValidationError';}}
const fail=(message:string):never=>{throw new PngValidationError(message);};
const table=new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
export function pngCrc32(bytes:Uint8Array):number {let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
const u32=(b:Uint8Array,o:number)=>((b[o]*0x1000000)+(b[o+1]<<16)+(b[o+2]<<8)+b[o+3])>>>0;
const channels:Record<number,number>={0:1,2:3,3:1,4:2,6:4};
const depths:Record<number,number[]>={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
interface Pass {width:number;height:number;rowBytes:number}
const adam7=[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]];
function passes(width:number,height:number,bits:number,interlace:number):Pass[]{
  const steps=interlace?adam7:[[0,0,1,1]];
  return steps.map(([x,y,dx,dy])=>{const w=Math.max(0,Math.ceil((width-x)/dx)),h=Math.max(0,Math.ceil((height-y)/dy));return {width:w,height:h,rowBytes:Math.ceil(w*bits/8)};}).filter(p=>p.width&&p.height);
}
function limited(overrides:Partial<PngLimits>):PngLimits {
  const result:PngLimits={...PNG_LIMITS};
  for(const key of Object.keys(overrides) as (keyof PngLimits)[]){const v=overrides[key];if(v===undefined)continue;if(!Number.isSafeInteger(v)||v<1||v>PNG_LIMITS[key])fail(`invalid ${key} budget`);result[key]=v;}
  return result;
}
function boundedZlib(parts:Uint8Array[],maxOutput:number,onData:(chunk:Uint8Array)=>void):number {
  const nonempty=parts.filter(p=>p.length);
  const inputBytes=nonempty.reduce((n,p)=>n+p.length,0);
  if(inputBytes<6)fail('missing or truncated zlib stream');
  const first=nonempty[0];const header=first.length>=2?[first[0],first[1]]:[first[0],nonempty[1]?.[0]];
  if(header[1]===undefined||(header[0]&15)!==8||(header[0]>>>4)>7||((header[0]<<8)+header[1])%31||((header[1]&32)!==0))fail('invalid PNG zlib header or preset dictionary');
  const inflater=new Inflate({windowBits:15,chunkSize:16384});
  const state=inflater as unknown as {ended:boolean;strm:{total_in:number;avail_in:number}};
  let produced=0;
  inflater.onData=(chunk:Uint8Array)=>{produced+=chunk.length;if(produced>maxOutput)fail('inflated data exceeds output budget');onData(chunk);};
  // No final result accumulation: onData consumes one fixed-size chunk at a time.
  for(let i=0;i<nonempty.length;i++){
    if(state.ended)fail('extra data after zlib stream');
    const ok=inflater.push(nonempty[i],i===nonempty.length-1);
    if(!ok||inflater.err)fail(`corrupt/truncated zlib stream: ${inflater.msg||inflater.err}`);
  }
  const stream=(inflater as unknown as {strm:{total_in:number;avail_in:number}}).strm;
  if(!state.ended||stream.total_in!==inputBytes||stream.avail_in)fail('incomplete or extra zlib stream data');
  return produced;
}
function keywordEnd(data:Uint8Array):number {
  const end=data.indexOf(0);if(end<1||end>79)fail('invalid PNG text/profile keyword');return end;
}
function checkCompressedMetadata(type:string,data:Uint8Array,remaining:number):number {
  if(type==='iCCP'||type==='zTXt'){
    const n=keywordEnd(data);if(data[n+1]!==0)fail('invalid metadata compression method');
    return boundedZlib([data.subarray(n+2)],remaining,()=>{});
  }
  if(type==='iTXt'){
    let n=keywordEnd(data)+1;const compressed=data[n++],method=data[n++];if((compressed!==0&&compressed!==1)||method!==0)fail('invalid international-text compression');
    for(let i=0;i<2;i++){const end=data.indexOf(0,n);if(end<0)fail('truncated international text');n=end+1;}
    return compressed?boundedZlib([data.subarray(n)],remaining,()=>{}):data.length-n;
  }
  return 0;
}
function paeth(a:number,b:number,c:number):number {const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
function validatePixels(idat:Uint8Array[],layout:Pass[],bitDepth:number,colorType:number,paletteEntries:number,maxInflated:number):number {
  const expected=layout.reduce((n,p)=>n+(p.rowBytes+1)*p.height,0);
  if(!Number.isSafeInteger(expected)||expected>maxInflated)fail('scanline size exceeds inflated-byte budget');
  const bpp=Math.max(1,Math.ceil(channels[colorType]*bitDepth/8));
  let pass=0,y=0,x=-1,filter=0;
  let row=new Uint8Array(layout[0].rowBytes),previous=new Uint8Array(row.length);
  const output=boundedZlib(idat,expected,chunk=>{
    for(const byte of chunk){
      if(pass>=layout.length)fail('excess scanline data');
      if(x===-1){if(byte>4)fail('invalid scanline filter');filter=byte;x=0;continue;}
      const left=x>=bpp?row[x-bpp]:0,up=previous[x],corner=x>=bpp?previous[x-bpp]:0;
      const predictor=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,corner);
      row[x++]=(byte+predictor)&255;
      if(x===row.length){
        if(colorType===3){const mask=(1<<bitDepth)-1;for(let px=0;px<layout[pass].width;px++){const bit=px*bitDepth,index=(row[bit>>>3]>>>(8-bitDepth-(bit&7)))&mask;if(index>=paletteEntries)fail('palette index outside PLTE');}}
        const old=previous;previous=row;row=old;x=-1;y++;
        if(y===layout[pass].height){pass++;y=0;if(pass<layout.length){row=new Uint8Array(layout[pass].rowBytes);previous=new Uint8Array(row.length);}}
      }
    }
  });
  if(output!==expected||pass!==layout.length||x!==-1)fail('decoded scanline length does not match IHDR dimensions');
  return output;
}
function expectedSize(info:PngInfo,expected?:{width:number;height:number}):void {
  if(expected&&(info.width!==expected.width||info.height!==expected.height))fail(`actual dimensions ${info.width}x${info.height} do not match atlas metadata ${expected.width}x${expected.height}`);
}

export function validatePngBytes(bytes:Uint8Array,expected?:{width:number;height:number},overrides:Partial<PngLimits>={}):PngInfo {
  const limits=limited(overrides);
  if(!(bytes instanceof Uint8Array)||bytes.length<8)fail('missing PNG signature');
  if(bytes.length>limits.maxBytes)fail('PNG file exceeds byte budget');
  const signature=[137,80,78,71,13,10,26,10];if(signature.some((n,i)=>bytes[i]!==n))fail('invalid PNG signature');
  let offset=8,width=0,height=0,bitDepth=0,colorType=0,interlace=0,chunkCount=0,ancillary=0,metadataOutput=0;
  let ihdr=false,ended=false,palette=false,trns=false,dataStarted=false,dataEnded=false;
  let paletteEntries=0;const idat:Uint8Array[]=[];
  const seen=new Set<string>();
  while(offset<bytes.length){
    if(++chunkCount>limits.maxChunks)fail('chunk count exceeds budget');
    if(offset+12>bytes.length)fail('truncated chunk header');
    const length=u32(bytes,offset);if(length>0x7fffffff||length>bytes.length-offset-12)fail('truncated/oversized PNG chunk');
    const type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));
    if(!/^[A-Za-z]{4}$/.test(type)||type[2]!==type[2].toUpperCase())fail('invalid chunk type or reserved bit');
    const start=offset+8,end=start+length,data=bytes.subarray(start,end);
    if(pngCrc32(bytes.subarray(offset+4,end))!==u32(bytes,end))fail(`CRC mismatch in ${type}`);
    if(!ihdr&&type!=='IHDR')fail('IHDR must be first');
    if(['acTL','fcTL','fdAT'].includes(type))fail('animated PNG is unsupported; use a static PNG');
    if(type==='IHDR'){
      if(ihdr||length!==13)fail('duplicate or invalid IHDR');ihdr=true;
      width=u32(data,0);height=u32(data,4);bitDepth=data[8];colorType=data[9];interlace=data[12];
      if(!width||!height||width>limits.maxDimension||height>limits.maxDimension||width*height>limits.maxPixels)fail('actual PNG dimensions/pixels exceed budget');
      if(!depths[colorType]?.includes(bitDepth)||data[10]!==0||data[11]!==0||(interlace!==0&&interlace!==1))fail('invalid bit depth/color/compression/filter/interlace in IHDR');
    } else if(type==='PLTE'){
      if(palette||dataStarted||trns||colorType===0||colorType===4||!length||length%3||length>768)fail('invalid/duplicate/misordered PLTE');
      palette=true;paletteEntries=length/3;if(colorType===3&&paletteEntries>2**bitDepth)fail('palette exceeds indexed bit depth');
    } else if(type==='tRNS'){
      if(trns||dataStarted||colorType===4||colorType===6)fail('invalid/duplicate/misordered tRNS');trns=true;
      if(colorType===3&&(!palette||!length||length>paletteEntries))fail('indexed transparency requires valid PLTE');
      if((colorType===0&&length!==2)||(colorType===2&&length!==6))fail('invalid transparency chunk length');
      if(colorType===0||colorType===2)for(let i=0;i<length;i+=2)if((data[i]*256+data[i+1])>2**bitDepth-1)fail('transparency sample outside bit depth');
    } else if(type==='IDAT'){
      if(dataEnded)fail('nonconsecutive IDAT chunks');if(colorType===3&&!palette)fail('indexed PNG missing PLTE');
      dataStarted=true;idat.push(data);
    } else if(type==='IEND'){
      if(length||!dataStarted)fail('invalid IEND or missing IDAT');ended=true;offset=end+4;if(offset!==bytes.length)fail('trailing data after IEND');break;
    } else {
      if(type[0]===type[0].toUpperCase())fail(`unknown critical chunk ${type}`);
      if(dataStarted)dataEnded=true;
      ancillary+=length;if(ancillary>limits.maxAncillaryBytes)fail('ancillary-byte budget exceeded');
      if(['iCCP','sRGB','gAMA','cHRM','sBIT','pHYs','bKGD','hIST'].includes(type)){
        if(seen.has(type))fail(`duplicate ${type}`);seen.add(type);
        if(dataStarted)fail(`misordered ${type}`);
      }
      if(['iCCP','sRGB','gAMA','cHRM','sBIT'].includes(type)&&palette)fail(`misordered ${type}`);
      if(type==='iCCP'&&seen.has('sRGB')||type==='sRGB'&&seen.has('iCCP'))fail('conflicting color profile chunks');
      if(type==='sRGB'&&(length!==1||data[0]>3)||type==='gAMA'&&(length!==4||!u32(data,0))||type==='cHRM'&&length!==32||type==='pHYs'&&(length!==9||data[8]>1))fail(`invalid ${type}`);
      if(type==='hIST'&&(!palette||length!==paletteEntries*2))fail('invalid histogram');
      if(type==='sBIT'){
        const count=colorType===3?3:channels[colorType];if(length!==count||[...data].some(n=>n<1||n>(colorType===3?8:bitDepth)))fail('invalid significant bits');
      }
      if(type==='bKGD'&&(colorType===3?(!palette||length!==1||data[0]>=paletteEntries):length!==(colorType===0||colorType===4?2:6)))fail('invalid background chunk');
      if(['iCCP','zTXt','iTXt'].includes(type)){
        if(metadataOutput>=limits.maxMetadataInflatedBytes)fail('metadata output budget exceeded');
        metadataOutput+=checkCompressedMetadata(type,data,limits.maxMetadataInflatedBytes-metadataOutput);
        if(metadataOutput>limits.maxMetadataInflatedBytes)fail('metadata output budget exceeded');
      }
      if(type==='tEXt')keywordEnd(data);
    }
    offset=end+4;
  }
  if(!ihdr||!ended||!dataStarted)fail('missing IHDR, IDAT or IEND');
  const layout=passes(width,height,channels[colorType]*bitDepth,interlace);
  const inflatedBytes=validatePixels(idat,layout,bitDepth,colorType,paletteEntries,limits.maxInflatedBytes);
  const info={width,height,bitDepth,colorType,interlace,byteLength:bytes.length,inflatedBytes,chunks:chunkCount,ancillaryBytes:ancillary};
  expectedSize(info,expected);return Object.freeze(info);
}

/** Cheap header preflight used to sum project budgets before any texture
 * is inflated. It is NOT a substitute for validatePngBytes. */
export function preflightPngDataUrl(url:string,expected?:{width:number;height:number}):PngInfo {
  const prefix='data:image/png;base64,';
  if(typeof url!=='string')fail('expected PNG base64 data URL');
  if(url.length>prefix.length+4*Math.ceil(PNG_LIMITS.maxBytes/3))fail('PNG data URL exceeds byte budget');
  if(!url.startsWith(prefix))fail('expected PNG base64 data URL');
  const b64=url.slice(prefix.length);
  if(b64.length<44||b64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(b64))fail('invalid/truncated PNG base64 payload');
  const padding=b64.endsWith('==')?2:b64.endsWith('=')?1:0,byteLength=b64.length/4*3-padding;
  if(byteLength>PNG_LIMITS.maxBytes)fail('PNG base64 decoded size exceeds byte budget');
  let bin='';try{bin=atob(b64.slice(0,44));}catch{fail('invalid PNG base64 header');}
  const b=Uint8Array.from(bin,c=>c.charCodeAt(0));
  if([137,80,78,71,13,10,26,10].some((n,i)=>b[i]!==n)||u32(b,8)!==13||String.fromCharCode(...b.subarray(12,16))!=='IHDR')fail('invalid PNG signature or IHDR');
  if(pngCrc32(b.subarray(12,29))!==u32(b,29))fail('CRC mismatch in IHDR');
  const width=u32(b,16),height=u32(b,20),bitDepth=b[24],colorType=b[25],interlace=b[28];
  if(!width||!height||width>PNG_LIMITS.maxDimension||height>PNG_LIMITS.maxDimension||width*height>PNG_LIMITS.maxPixels)fail('actual PNG dimensions/pixels exceed budget');
  if(!depths[colorType]?.includes(bitDepth)||b[26]!==0||b[27]!==0||(interlace!==0&&interlace!==1))fail('invalid IHDR encoding');
  const inflatedBytes=passes(width,height,channels[colorType]*bitDepth,interlace).reduce((n,p)=>n+(p.rowBytes+1)*p.height,0);
  if(inflatedBytes>PNG_LIMITS.maxInflatedBytes)fail('scanline size exceeds inflated-byte budget');
  const info={width,height,bitDepth,colorType,interlace,byteLength,inflatedBytes,chunks:0,ancillaryBytes:0};expectedSize(info,expected);return info;
}

/** Strict base64 decoded-size checks happen BEFORE allocating binary data. */
export function pngDataUrlBytes(url:string):Uint8Array {
  const prefix='data:image/png;base64,';if(typeof url!=='string')fail('expected PNG base64 data URL');
  if(url.length>prefix.length+4*Math.ceil(PNG_LIMITS.maxBytes/3))fail('PNG data URL exceeds byte budget');
  if(!url.startsWith(prefix))fail('expected PNG base64 data URL');
  const b64=url.slice(prefix.length);
  if(!b64||b64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(b64))fail('invalid PNG base64 payload');
  const padding=b64.endsWith('==')?2:b64.endsWith('=')?1:0,size=b64.length/4*3-padding;
  if(size>PNG_LIMITS.maxBytes)fail('PNG base64 decoded size exceeds byte budget');
  let bin='';try{bin=atob(b64);}catch{fail('invalid PNG base64 payload');}
  if(bin.length!==size)fail('invalid PNG base64 length');
  const bytes=new Uint8Array(size);for(let i=0;i<size;i++)bytes[i]=bin.charCodeAt(i);return bytes;
}
export function pngBytesDataUrl(bytes:Uint8Array):string {
  if(bytes.length>PNG_LIMITS.maxBytes)fail('PNG file exceeds byte budget');
  let bin='';for(let i=0;i<bytes.length;i+=32768)bin+=String.fromCharCode(...bytes.subarray(i,i+32768));return 'data:image/png;base64,'+btoa(bin);
}
// Immutable string-key cache avoids re-inflating unchanged textures on every
// transaction. Bounded to 16 entries and 8 MiB of encoded keys; byte-array APIs
// are never cached because their caller can mutate the underlying buffer.
const cache=new Map<string,PngInfo>();let cacheChars=0;
export function validatePngDataUrl(url:string,expected?:{width:number;height:number}):PngInfo {
  let info=cache.get(url);
  if(!info){info=validatePngBytes(pngDataUrlBytes(url));if(url.length<=8*1024*1024){while(cache.size>=16||cacheChars+url.length>8*1024*1024){const key=cache.keys().next().value;if(key===undefined)break;cacheChars-=key.length;cache.delete(key);}cache.set(url,info);cacheChars+=url.length;}}
  expectedSize(info,expected);return info;
}
export function checkProjectPngBudget(infos:PngInfo[],manifestBytes:number):void {
  const bytes=infos.reduce((n,i)=>n+i.byteLength,0),pixels=infos.reduce((n,i)=>n+i.width*i.height,0),inflated=infos.reduce((n,i)=>n+i.inflatedBytes,0);
  if(bytes>PROJECT_PNG_LIMITS.maxPngBytes)fail('project aggregate PNG-byte budget exceeded');
  if(pixels>PROJECT_PNG_LIMITS.maxPixels)fail('project aggregate pixel budget exceeded');
  if(inflated>PROJECT_PNG_LIMITS.maxInflatedBytes)fail('project aggregate inflated-byte budget exceeded');
  if(manifestBytes>PROJECT_PNG_LIMITS.maxManifestBytes)fail('project manifest-byte budget exceeded');
}
