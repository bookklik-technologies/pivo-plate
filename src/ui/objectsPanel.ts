/** Scene objects panel — tree with add/rename/delete, hide/lock, active object. */
import type { Project, SceneObject } from '../core/types';
import { isObjectLocked, isObjectVisible, reparentObject, uid } from '../core/editor';
import { DEFAULT_OBJECT_ID } from '../core/types';
import { svgIcon, button, clearChildren, div, h, iconButton, toastError } from './dom';
import { ICONS } from './dom';

export interface ObjectsPanelContext {
  store: import('../core/editor').EditorStore;
  session: import('../core/types').EditorSession;
  refreshAll: () => void;
  requestConfirm: (title: string, body: string, confirmLabel: string, onConfirm: () => void, danger?: boolean) => void;
}

export class ObjectsPanel {
  private ctx: ObjectsPanelContext;
  private tree: HTMLElement;
  private countEl: HTMLElement;

  constructor(root: HTMLElement, ctx: ObjectsPanelContext) {
    this.ctx = ctx;
    this.tree = div('');
    this.tree.id = 'obj-tree';this.tree.setAttribute('role','tree');this.tree.setAttribute('aria-label','Scene objects');
    this.countEl = h('span', { class: 'obj-count' }) as HTMLElement;
    const sec = div('panel-sec',
      h('h4', null, 'Scene objects', div('actions',
        iconButton('obj-add', ICONS.plus, 'Add object'),
      )),
      this.tree,
      h('p', { class: 'hint' }, this.countEl, ' — click to set the active object; new tiles join it.'),
    );
    const group = button('btn','Group selected');
    group.prepend(svgIcon(ICONS.layers,14));
    group.addEventListener('click', () => {
      try {
        const ids = new Set(this.ctx.session.selection.tileIds);
        if (!ids.size) throw new Error('Select faces to group first');
        this.ctx.store.transact('Group selected tiles',p=>{
          const editable = p.tiles.filter(t=>ids.has(t.id) && !isObjectLocked(p,t.objectId));
          if (!editable.length) throw new Error('Selected objects are locked');
          const id = uid('object');
          p.objects.push({id,name:'Group '+p.objects.length,parentId:null,visible:true,locked:false});
          editable.forEach(t=>t.objectId=id);
          this.ctx.session.activeObjectId=id;
        });
      } catch(e) { toastError(e,'Group'); }
    });
    const parent = h('select', {'aria-label':'Parent object'});
    parent.id='object-parent';
    parent.addEventListener('change',()=>{
      try { this.ctx.store.transact('Reparent object',p=>reparentObject(p,this.ctx.session.activeObjectId,parent.value||null)); } catch(e) { toastError(e,'Parent'); this.refresh(); }
    });
    sec.append(group,h('label',{class:'field-row'},'Parent of active object',parent));
    root.append(sec);
    const addBtn = sec.querySelector('.obj-add') as HTMLButtonElement;
    addBtn.addEventListener('click', () => this.addObject());
  }

  private addObject(): void {
    try {
      this.ctx.store.transact('Add object', (project) => {
        const id = `object-${Math.random().toString(36).slice(2, 8)}`;
        // parent under active object for organizational grouping
        const active = this.ctx.session.activeObjectId;
        const parent = active && active !== DEFAULT_OBJECT_ID
          ? project.objects.find((o) => o.id === active) ?? null
          : null;
        project.objects.push({
          id, name: `Object ${project.objects.length + 1}`,
          parentId: parent ? parent.id : null,
          visible: true, locked: false,
        });
        this.ctx.session.activeObjectId = id;
      });
      this.ctx.refreshAll();
    } catch (err) { toastError(err, 'Add object'); }
  }

  refresh(): void {
    const project = this.ctx.store.project;
    clearChildren(this.tree);
    this.countEl.textContent = `${project.objects.length} object(s), ${project.tiles.length} tile(s)`;
    const active = this.ctx.session.activeObjectId;
    const parent = document.getElementById('object-parent') as HTMLSelectElement|null;
    if(parent) {
      parent.replaceChildren(h('option',{value:''},'No parent'));
      project.objects.filter(o=>o.id!==active).forEach(o=>parent.append(h('option',{value:o.id},o.name)));
      parent.value=project.objects.find(o=>o.id===active)?.parentId??'';
    }
    const byParent = new Map<string | null, SceneObject[]>();
    for (const o of project.objects) {
      const list = byParent.get(o.parentId) ?? [];
      list.push(o);
      byParent.set(o.parentId, list);
    }
    const renderLevel = (parentId: string | null, depth: number): void => {
      for (const o of byParent.get(parentId) ?? []) {
        this.tree.append(this.renderRow(project, o, depth));
        renderLevel(o.id, depth + 1);
      }
    };
    renderLevel(null, 0);
    // orphaned objects (defensive)
    const known = new Set(project.objects.map((o) => o.id));
    for (const o of project.objects) {
      if (o.parentId && !known.has(o.parentId)) this.tree.append(this.renderRow(project, o, 0));
    }
  }

  private renderRow(project: Project, o: SceneObject, depth: number): HTMLElement {
    const row = div('obj-row');row.dataset.objectId=o.id;row.tabIndex=o.id===this.ctx.session.activeObjectId?0:-1;row.setAttribute('role','treeitem');row.setAttribute('aria-label',o.name);row.setAttribute('aria-selected',String(o.id===this.ctx.session.activeObjectId));row.setAttribute('aria-level',String(depth+1));
    if (o.id === this.ctx.session.activeObjectId) row.classList.add('active');
    row.style.paddingLeft = `${6 + depth * 14}px`;
    const visible = isObjectVisible(project, o.id);
    const locked = isObjectLocked(project, o.id);
    const tileCount = project.tiles.filter((t) => t.objectId === o.id).length;

    const name = h('span', { class: `obj-name${visible ? '' : ' dim'}` }, `${o.name} `);
    const count = h('span', { class: 'obj-count' }, String(tileCount));
    const eye = iconButton('obj-eye', visible ? ICONS.eye : ICONS.eyeOff, `${visible?'Hide':'Show'} ${o.name}`);
    if (!visible) eye.classList.add('on');
    const lock = iconButton('obj-lock', locked ? ICONS.lock : ICONS.unlock, `${locked?'Unlock':'Lock'} ${o.name}`);
    if (locked) lock.classList.add('on');
    const del = iconButton('obj-del', ICONS.trash, `Delete ${o.name}`);
    const rename=button('obj-rename','Rename');rename.setAttribute('aria-label',`Rename ${o.name}`);rename.onclick=()=>this.startRename(row,o);
    row.append(eye,name,count,rename,lock,del);
    row.addEventListener('keydown',e=>{if(e.target!==row)return;if(e.key==='Enter'||e.key===' '){e.preventDefault();this.ctx.session.activeObjectId=o.id;this.ctx.refreshAll();this.focusRow(o.id);}else if(e.key==='F2'){e.preventDefault();this.startRename(row,o);}else if(e.key==='ArrowDown'||e.key==='ArrowUp'||e.key==='Home'||e.key==='End'){e.preventDefault();const rows=[...this.tree.querySelectorAll<HTMLElement>('[role=treeitem]')];const n=rows.indexOf(row);rows[e.key==='Home'?0:e.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,n+(e.key==='ArrowDown'?1:-1)))]?.focus();}});

    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this.ctx.session.activeObjectId = o.id;
      this.ctx.refreshAll();
    });
    row.addEventListener('dblclick', e => {if(!(e.target as HTMLElement).closest('button'))this.startRename(row,o);});

    eye.addEventListener('click', () => {
      try {
        this.ctx.store.transact(o.visible ? `Hide ${o.name}` : `Show ${o.name}`, (p) => {
          const t = p.objects.find((x) => x.id === o.id);
          if (t) t.visible = !t.visible;
        });
        this.ctx.refreshAll();
      } catch (err) { toastError(err, 'Visibility'); }
    });
    lock.addEventListener('click', () => {
      try {
        this.ctx.store.transact(locked ? `Unlock ${o.name}` : `Lock ${o.name}`, (p) => {
          const t = p.objects.find((x) => x.id === o.id);
          if (t) t.locked = !t.locked;
        });
        this.ctx.refreshAll();
      } catch (err) { toastError(err, 'Lock'); }
    });
    del.addEventListener('click', () => {
      const n = tileCount;
      this.ctx.requestConfirm(
        'Delete object',
        n > 0
          ? `“${o.name}” contains ${n} tile(s). Deleting removes them from the document. This can be undone with Ctrl+Z.`
          : `Delete empty object “${o.name}”?`,
        'Delete',
        () => {
          try {
            this.ctx.store.transact(`Delete ${o.name}`, (p) => {
              const ids = new Set<string>([o.id]);
              // delete descendants
              let grew = true;
              while (grew) {
                grew = false;
                for (const x of p.objects) {
                  if (x.parentId && ids.has(x.parentId) && !ids.has(x.id)) { ids.add(x.id); grew = true; }
                }
              }
              p.objects = p.objects.filter((x) => !ids.has(x.id));
              p.tiles = p.tiles.filter((t) => !ids.has(t.objectId));
              if (ids.has(this.ctx.session.activeObjectId)) {
                this.ctx.session.activeObjectId = p.objects[0]?.id ?? '';
              }
              // drop selection tiles that vanished
              const alive = new Set(p.tiles.map((t) => t.id));
              this.ctx.session.selection.tileIds = this.ctx.session.selection.tileIds.filter((id) => alive.has(id));
              this.ctx.session.selection.vertices = this.ctx.session.selection.vertices.filter((v) => alive.has(v.tileId));
            });
            this.ctx.refreshAll();
          } catch (err) { toastError(err, 'Delete object'); }
        },
        n > 0,
      );
    });
    return row;
  }

  private focusRow(id:string):void { [...this.tree.querySelectorAll<HTMLElement>('[data-object-id]')].find(el=>el.dataset.objectId===id)?.focus(); }

  private startRename(row: HTMLElement, o: SceneObject): void {
    if(row.querySelector('input'))return;
    const span = row.querySelector('.obj-name') as HTMLElement;
    const input = h('input', { type: 'text', value: o.name,'aria-label':`Rename ${o.name}` }) as HTMLInputElement;
    span.textContent = '';
    span.append(input);
    input.focus();
    input.select();
    let done = false;
    const commit = (): void => {
      if (done) return;
      done = true;
      const name = input.value.trim() || o.name;
      try {
        this.ctx.store.transact(`Rename ${o.name} → ${name}`, (p) => {
          const t = p.objects.find((x) => x.id === o.id);
          if (t) t.name = name;
        });
      } catch (err) { toastError(err, 'Rename'); }
      this.ctx.refreshAll();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // don't trigger app shortcuts while editing
      if (e.key === 'Enter') {commit();this.focusRow(o.id);}
      if (e.key === 'Escape') { done = true; this.ctx.refreshAll();this.focusRow(o.id); }
    });
    input.addEventListener('blur', commit);
  }
}

/** Export helper unused warning guard. */
export const _objects = button;
