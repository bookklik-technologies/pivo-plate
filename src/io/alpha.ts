import { validatePngDataUrl } from '../core/png';
import type { Atlas, Project } from '../core/types';
/** Browser-only pixel inspection. Node exporters retain deterministic MASK defaults. */
export async function inspectAlpha(project:Project):Promise<Map<string,'opaque'|'cutout'|'blend'>|undefined> {
  if(typeof document==='undefined'||typeof Image==='undefined') return undefined;
  const result=new Map<string,'opaque'|'cutout'|'blend'>();
  const used=new Set(project.tiles.map(t=>t.atlasId));
  for(const atlas of project.atlases.filter(a=>used.has(a.id))) {
    const expected=validatePngDataUrl(atlas.dataUrl,{width:atlas.width,height:atlas.height});
    const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error(`Cannot decode PNG ${atlas.name} for export`));img.src=atlas.dataUrl;});
    if(image.naturalWidth!==expected.width||image.naturalHeight!==expected.height)throw Error('Export image dimensions do not match validated PNG');
    const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;
    const ctx=c.getContext('2d',{willReadFrequently:true});
    if(!ctx) throw Error('Canvas pixel inspection unavailable');
    ctx.drawImage(image,0,0);
    const data=ctx.getImageData(0,0,c.width,c.height).data;
    let mode:'opaque'|'cutout'|'blend'='opaque';
    for(let i=3;i<data.length;i+=4){if(data[i]>0&&data[i]<255){mode='blend';break;}if(data[i]===0)mode='cutout';}
    result.set(atlas.id,mode);c.width=c.height=0;
  }
  return result;
}
