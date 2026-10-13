import {it,expect} from 'vitest';
import {EditorStore} from '../src/core/editor';
import {makeProject} from './fixtures';

it('byte budget retains the newest whole undo transaction',()=>{
 const store=new EditorStore(makeProject(),1);
 store.transact('First',p=>{p.name='First';});store.transact('Second',p=>{p.name='Second';});
 store.undo();expect(store.project.name).toBe('First');expect(store.canUndo).toBe(false);
});
it('a new edit after undo releases redo snapshots',()=>{
 const store=new EditorStore(makeProject());store.transact('First',p=>{p.name='First';});store.undo();store.transact('Second',p=>{p.name='Second';});
 expect(store.canRedo).toBe(false);expect(store.retainedHistoryBytes).toBeGreaterThan(0);
});

it('an asynchronous save marks its captured content and undo returns to clean',()=>{
 const store=new EditorStore(makeProject());
 store.transact('Saved',p=>{p.name='Saved';});const snapshot=structuredClone(store.project);
 store.transact('Newer edit',p=>{p.name='Newer';});store.markSaved(snapshot);
 expect(store.dirty).toBe(true);store.undo();expect(store.dirty).toBe(false);
});
