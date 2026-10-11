import {it,expect} from 'vitest';
import {EditorStore,validateProject,isObjectLocked,isObjectVisible} from '../src/core/editor';
import {MAX_HIERARCHY_DEPTH,objectDepths} from '../src/core/hierarchy';
import {makeProject,makeObject} from './fixtures';

function chain(depth:number){return Array.from({length:depth+1},(_,i)=>makeObject({id:'n'+i,parentId:i?'n'+(i-1):null}));}
for(const reverse of [false,true]) {
 it(`hierarchy exact depth limit accepts ${reverse?'leaf-first':'root-first'} ordering`,()=>{
  const objects=chain(MAX_HIERARCHY_DEPTH);if(reverse)objects.reverse();
  expect(objectDepths(objects).get('n'+MAX_HIERARCHY_DEPTH)).toBe(MAX_HIERARCHY_DEPTH);
  const p=makeProject({objects,tiles:[]});expect(()=>validateProject(p)).not.toThrow();
 });
 it(`3000-object chain rejects quickly ${reverse?'leaf-first':'root-first'}`,()=>{
  const objects=chain(2999);if(reverse)objects.reverse();const started=performance.now();
  expect(()=>validateProject(makeProject({objects,tiles:[]}))).toThrow(/depth/);
  expect(performance.now()-started).toBeLessThan(1000);
 });
}
it('core ancestor queries terminate on poisoned graph',()=>{
 const p=makeProject({objects:[makeObject({id:'a',parentId:'b'}),makeObject({id:'b',parentId:'a'})],tiles:[]});
 expect(()=>isObjectLocked(p,'a')).toThrow(/cycle/);expect(()=>isObjectVisible(p,'a')).toThrow(/cycle/);
});
it('a real async transaction is rejected and its later mutations remain detached',async()=>{
 const store=new EditorStore(makeProject()),before=JSON.stringify(store.project);let release!:()=>void;
 const gate=new Promise<void>(r=>release=r);
 expect(()=>store.transact('async',async d=>{d.name='before-await';await gate;d.name='after-await';})).toThrow(/synchronous/);
 release();await Promise.resolve();await Promise.resolve();
 expect(JSON.stringify(store.project)).toBe(before);expect(store.revision).toBe(0);expect(store.canUndo).toBe(false);
});
it('canonical normalization is published, not merely checked',()=>{
 const store=new EditorStore(makeProject());store.transact('drift',d=>{d.tiles[0].uvs[0][0]=-0.0000001;});
 expect(store.project.tiles[0].uvs[0][0]).toBe(0);expect(store.canUndo).toBe(false);expect(store.dirty).toBe(false);
});
it('key-order-only draft changes do not create history',()=>{
 const store=new EditorStore(makeProject());store.transact('order',d=>{d.tiles[0]={...d.tiles[0],vertices:d.tiles[0].vertices};const t=d.tiles[0];d.tiles[0]={uvs:t.uvs,reversed:t.reversed,vertices:t.vertices,atlasId:t.atlasId,objectId:t.objectId,id:t.id};});
 expect(store.canUndo).toBe(false);expect(store.revision).toBe(0);expect(store.dirty).toBe(false);
});
