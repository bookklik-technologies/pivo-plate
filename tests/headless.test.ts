import { describe, expect, it } from 'vitest';
import { createHeadlessEditor, createProject, type Project } from '../sdk/index.js';

describe('headless editor embedding', () => {
  it('isolates the seed, snapshots, and retained transaction drafts', () => {
    const seed = createProject();
    const editor = createHeadlessEditor(seed);
    seed.name = 'outside';
    expect(editor.getProject().name).not.toBe('outside');
    const snapshot = editor.getProject();
    snapshot.name = 'snapshot';
    expect(editor.getProject().name).not.toBe('snapshot');
    let retained: Project | undefined;
    editor.transact(draft => { draft.name = 'committed'; retained = draft; });
    retained!.name = 'late mutation';
    expect(editor.getProject().name).toBe('committed');
  });

  it('rolls back thrown and invalid mutations', () => {
    const editor = createHeadlessEditor();
    const before = editor.getProject();
    expect(() => editor.transact(draft => { draft.name = 'lost'; throw new Error('abort'); })).toThrow('abort');
    expect(() => editor.transact(draft => { Object.assign(draft, { version: 2 }); })).toThrow();
    expect(editor.getProject()).toEqual(before);
  });

  it('rejects asynchronous mutations without leaking their changes', async () => {
    const editor = createHeadlessEditor();
    const before = editor.getProject();
    expect(() => editor.transact(async draft => { await Promise.resolve(); draft.name = 'late'; throw new Error('late rejection'); })).toThrow(/synchronous/);
    await Promise.resolve();
    expect(editor.getProject()).toEqual(before);
  });

  it('rejects reentrant mutations and remains usable afterward', () => {
    const editor = createHeadlessEditor();
    const before = editor.getProject();
    expect(() => editor.transact(() => editor.replace(createProject()))).toThrow(/nested/);
    expect(() => editor.transact(() => editor.transact(() => {}))).toThrow(/nested/);
    expect(editor.getProject()).toEqual(before);
    editor.transact(draft => { draft.name = 'recovered'; });
    expect(editor.getProject().name).toBe('recovered');
  });

  it('replaces documents atomically without aliasing the replacement', () => {
    const editor = createHeadlessEditor();
    const replacement = createProject();
    replacement.name = 'replacement';
    editor.replace(replacement);
    replacement.name = 'outside';
    expect(editor.getProject().name).toBe('replacement');
    expect(() => editor.replace({ ...replacement, version: 2 } as unknown as Project)).toThrow();
    expect(editor.getProject().name).toBe('replacement');
  });
});
