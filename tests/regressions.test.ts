import { describe,it,expect } from 'vitest';
import { createSession, selectedCorners, translateSelection, brushUVs, transformUVs, validateProject, EditorStore } from '../src/core/editor';
import { exportGLB,exportOBJ } from '../src/io/export';
import { encodeProject,decodeProject } from '../src/io/project';
import { makeProject,makeAtlas,makeTile,pngDataUrl } from './fixtures';
import { zipSync,strToU8 } from 'fflate';

describe('Integration regressions',()=>{
 it('selected faces expand to four corners with deduplication',()=>{const p=makeProject();expect(selectedCorners(p,{tileIds:['tile-1'],vertices:[{tileId:'tile-1',corner:0}]})).toHaveLength(4);});
 it('face transforms work without explicit vertex selection',()=>{const p=makeProject();translateSelection(p,{tileIds:['tile-1'],vertices:[]},[2,3,4]);expect(p.tiles[0].vertices[0]).toEqual([2,3,4]);});
 it('canonical validation preserves the embedded PNG and whole document',()=>{const p=makeProject();expect(validateProject(p)).toEqual(p);});
 it('non-square atlas brush rotations preserve source region bounds',()=>{const a=makeAtlas({width:64,height:32,dataUrl:pngDataUrl(64,32),tileWidth:16,tileHeight:16});for(const rotation of [0,1,2,3] as const){const uv=brushUVs(a,{atlasId:a.id,region:{x:16,y:0,width:32,height:16},rotation,flipX:false,flipY:false});expect(uv.map(v=>v[0]).sort()).toEqual([.25,.25,.75,.75]);expect(uv.map(v=>v[1]).sort()).toEqual([.5,.5,1,1]);}});
 it('rotating a rectangular UV region never samples a neighbor',()=>{const p=makeProject({tiles:[makeTile({uvs:[[0,0],[.5,0],[.5,.25],[0,.25]]})]});transformUVs(p,{tileIds:['tile-1'],vertices:[]},'rotate');expect(p.tiles[0].uvs).toEqual([[.5,0],[.5,.25],[0,.25],[0,0]]);});
 it('sessions start within atlas margin',()=>{const p=makeProject({atlases:[makeAtlas({width:64,height:64,tileWidth:16,tileHeight:16,margin:2,dataUrl:pngDataUrl(64,64)})]});expect(createSession(p).brush.region.x).toBe(2);expect(createSession(p).brush.region.y).toBe(2);});
 it('rejects zero-sized texture metadata',()=>{const p=makeProject();p.atlases[0].width=0;expect(()=>validateProject(p)).toThrow(/dimensions/);});
 it('rejects no complete cell after margins',()=>{const p=makeProject();p.atlases[0].margin=2;expect(()=>validateProject(p)).toThrow(/margin/);});
 it('partial-alpha PNG bytes survive file round trip',async()=>{const p=makeProject({atlases:[makeAtlas({},new Uint8Array([255,0,0,128,0,255,0,255,0,0,255,0,255,255,255,200]))]});expect((await decodeProject(await encodeProject(p))).atlases[0].dataUrl).toBe(p.atlases[0].dataUrl);});
 it('GLB converts editor bottom-left V to glTF top-left V',async()=>{const p=makeProject();const b=await exportGLB(p),dv=new DataView(b.buffer,b.byteOffset,b.byteLength);const len=dv.getUint32(12,true);const j=JSON.parse(new TextDecoder().decode(b.slice(20,20+len)));const acc=j.accessors[j.meshes[0].primitives[0].attributes.TEXCOORD_0];const view=j.bufferViews[acc.bufferView];const bin=20+len+8;const offset=bin+view.byteOffset+(acc.byteOffset||0);expect(dv.getFloat32(offset+4,true)).toBe(1-p.tiles[0].uvs[0][1]);});
 it('GLB rejects degenerate first triangle',async()=>{const p=makeProject();p.tiles[0].vertices[1]=[...p.tiles[0].vertices[0]];await expect(exportGLB(p)).rejects.toThrow(/degenerate/);});
 it('OBJ rejects degenerate second triangle',async()=>{const p=makeProject();p.tiles[0].vertices[3]=[...p.tiles[0].vertices[0]];await expect(exportOBJ(p)).rejects.toThrow(/degenerate/);});
 it('compressed ZIP bomb is rejected before allocating output',async()=>{const bomb=zipSync({'project.json':new Uint8Array(100*1024*1024)},{level:9});expect(bomb.length).toBeLessThan(2*1024*1024);await expect(decodeProject(bomb)).rejects.toThrow(/maximum file size|manifest exceeds byte budget/);});
 it('malformed project load cannot change an existing store',async()=>{const p=makeProject(),store=new EditorStore(p);await expect(decodeProject(zipSync({'project.json':strToU8('{}')}))).rejects.toThrow();expect(store.project).toEqual(p);});
});
