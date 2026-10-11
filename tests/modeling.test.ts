import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {tileCornerNormals} from '../src/core/geometry';
import {exportGLB,exportOBJ} from '../src/io/export';
import {makeProject,makeTile} from './fixtures';
import {unzipSync,strFromU8} from 'fflate';

const deformed=makeTile({vertices:[[0,0,0],[1,0,0],[1,1,0],[0,1,1]]});
function near(a:number[],b:number[]){a.forEach((n,i)=>expect(n).toBeCloseTo(b[i],5));}
function reference(t:typeof deformed){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(t.vertices.flat(),3));g.setIndex(t.reversed?[0,2,1,0,3,2]:[0,1,2,0,2,3]);g.computeVertexNormals();return Array.from({length:4},(_,i)=>[g.attributes.normal.getX(i),g.attributes.normal.getY(i),g.attributes.normal.getZ(i)]);}

describe('shared nonplanar normals',()=>{
 it('uses the second triangle at its exclusive corner',()=>{near(tileCornerNormals(deformed)[3],[1/Math.sqrt(3),-1/Math.sqrt(3),1/Math.sqrt(3)]);});
 it('matches Three indexed computeVertexNormals at all four corners',()=>{const expected=reference(deformed);tileCornerNormals(deformed).forEach((n,i)=>near(n,expected[i]));});
 it('reversed winding negates every corner normal',()=>{const reversed={...deformed,reversed:true};const normals=tileCornerNormals(deformed);tileCornerNormals(reversed).forEach((n,i)=>near(n,normals[i].map(v=>-v)));});
 it('leaves planar square normals unchanged',()=>{tileCornerNormals(makeTile({vertices:[[0,0,0],[1,0,0],[1,1,0],[0,1,0]]})).forEach(n=>near(n,[0,0,1]));});
 it('does not emit NaN for collapsed preview geometry',()=>{const t=makeTile({vertices:[[0,0,0],[0,0,0],[0,0,0],[0,0,0]]});expect(tileCornerNormals(t).flat().every(Number.isFinite)).toBe(true);});
 it('tilted/unequal triangles use area-weighted shared normals',()=>{const t=makeTile({vertices:[[0,0,0],[4,0,0],[2,1,1],[0,3,-1]]});const expected=reference(t);tileCornerNormals(t).forEach((n,i)=>near(n,expected[i]));});
 it('never averages normals with a neighboring tile',()=>{const other=makeTile({vertices:[[0,0,0],[0,1,0],[0,1,1],[0,0,1]]});const before=tileCornerNormals(deformed);tileCornerNormals(other);expect(tileCornerNormals(deformed)).toEqual(before);});
});

describe('nonplanar interchange regressions',()=>{
 for(const reversed of [false,true]){
  it(`OBJ/independent OBJLoader preserves corner normals (reversed=${reversed})`,async()=>{
   const t={...deformed,reversed};const files=unzipSync(await exportOBJ(makeProject({tiles:[t]})));const text=strFromU8(files['pivo-plate.obj']);const normals=text.split('\n').filter(l=>l.startsWith('vn ')).map(l=>l.split(' ').slice(1).map(Number));
   normals.forEach((n,i)=>near(n,tileCornerNormals(t)[i]));
   const object=new OBJLoader().parse(text),mesh=object.getObjectByProperty('isMesh',true) as THREE.Mesh;
   const pos=mesh.geometry.attributes.position,normal=mesh.geometry.attributes.normal;
   let found=false;for(let i=0;i<pos.count;i++){if(pos.getX(i)===0&&pos.getY(i)===1&&pos.getZ(i)===1){near([normal.getX(i),normal.getY(i),normal.getZ(i)],tileCornerNormals(t)[3]);found=true;}}
   expect(found).toBe(true);
  });
  it(`GLB binary preserves normals without moving positions or UVs (reversed=${reversed})`,async()=>{
   const t={...deformed,reversed},p=makeProject({tiles:[t]}),before=JSON.stringify(p);const bytes=await exportGLB(p),dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),len=dv.getUint32(12,true);const j=JSON.parse(new TextDecoder().decode(bytes.slice(20,20+len)));const attrs=j.meshes[0].primitives[0].attributes;
   function values(index:number,size:number){const a=j.accessors[index],v=j.bufferViews[a.bufferView],off=20+len+8+v.byteOffset+(a.byteOffset||0);return Array.from({length:a.count},(_,i)=>Array.from({length:size},(_,k)=>dv.getFloat32(off+(i*size+k)*4,true)));}
   values(attrs.NORMAL,3).forEach((n,i)=>near(n,tileCornerNormals(t)[i]));
   expect(values(attrs.POSITION,3)).toEqual(t.vertices);values(attrs.TEXCOORD_0,2).forEach((uv,i)=>near(uv,[t.uvs[i][0],1-t.uvs[i][1]]));expect(JSON.stringify(p)).toBe(before);
  });
 }
});
