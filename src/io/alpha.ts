import { validatePngDataUrl, pngDataUrlBytes } from '../core/png';
import type { Atlas, Project } from '../core/types';
/** Browser-only pixel inspection. Node exporters retain deterministic MASK defaults. */
export async function inspectAlpha(project:Project):Promise<Map<string,'opaque'|'cutout'|'blend'>|undefined> {
  const workerCanvas=typeof OffscreenCanvas!=='undefined'&&typeof createImageBitmap==='function';
  if((typeof document==='undefined'||typeof Image==='undefined')&&!workerCanvas){if('importScripts' in globalThis)throw Error('Texture alpha inspection requires worker canvas support. Use a current desktop browser.');return undefined;}
  const result=new Map<string,'opaque'|'cutout'|'blend'>();
  const used=new Set(project.tiles.map(t=>t.atlasId));
  for(const atlas of project.atlases.filter(a=>used.has(a.id))) {
    const expected=validatePngDataUrl(atlas.dataUrl,{width:atlas.width,height:atlas.height});
    let data:Uint8ClampedArray;
    if(typeof document==='undefined') {
      const bytes=pngDataUrlBytes(atlas.dataUrl);
      const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
      try {
        if(bitmap.width!==expected.width||bitmap.height!==expected.height)throw Error('Export image dimensions do not match validated PNG');
        const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        if(!ctx)throw Error('Worker pixel inspection unavailable');
        ctx.drawImage(bitmap,0,0);data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        canvas.width=canvas.height=0;
      }finally{bitmap.close();}
    }else {
      const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error(`Cannot decode PNG ${atlas.name} for export`));img.src=atlas.dataUrl;});
      if(image.naturalWidth!==expected.width||image.naturalHeight!==expected.height)throw Error('Export image dimensions do not match validated PNG');
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('Canvas pixel inspection unavailable');
      ctx.drawImage(image,0,0);data=ctx.getImageData(0,0,canvas.width,canvas.height).data;canvas.width=canvas.height=0;
    }
    let mode:'opaque'|'cutout'|'blend'='opaque';
    for(let i=3;i<data.length;i+=4){if(data[i]>0&&data[i]<255){mode='blend';break;}if(data[i]===0)mode='cutout';}
    result.set(atlas.id,mode);
  }
  return result;
}
