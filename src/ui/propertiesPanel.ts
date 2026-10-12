/** Properties panel — mode, plane, grid/tileSize, selection transforms, UV ops. */
import { isObjectLocked } from '../core/editor';
import type { Mode, Plane } from '../core/types';
import { svgIcon, button, checkRow, div, h, iconButton, toastError } from './dom';
import { ICONS } from './dom';

export interface PropertiesPanelContext {
  store: import('../core/editor').EditorStore;
  session: import('../core/types').EditorSession;
  refreshAll: () => void;
  viewport: {
    setPlane(plane: Plane, lock: boolean): void;
    setTransformTool(t: 'select' | 'translate' | 'rotate' | 'scale'): void;
    getTransformTool(): string;
    setCameraKind(k: 'persp' | 'ortho'): void;
    getCameraKind(): 'persp' | 'ortho';
    setVertexMode(on: boolean): void;
    frameSelection(): void;
    setEraseTool(on:boolean):void;
    cancelGesture():void;
  };
  requestConfirm: (title: string, body: string, confirmLabel: string, onConfirm: () => void, danger?: boolean) => void;
}

type Sel = import('../core/types').Selection;

export class PropertiesPanel {
  private ctx: PropertiesPanelContext;
  private root: HTMLElement;
  private selInfo: HTMLElement;
  private selActions: HTMLElement;

  constructor(root: HTMLElement, ctx: PropertiesPanelContext) {
    this.root = root;
    this.ctx = ctx;

    /* ---- mode ---- */
    const modeSeg = div('seg');
    for (const m of ['draw', 'edit'] as Mode[]) {
      const b = button(`mode-${m}`, m === 'draw' ? 'Draw' : 'Edit');
      b.addEventListener('click', () => this.setMode(m));
      modeSeg.append(b);
    }
    const modeSec = div('panel-sec', h('h4', null, 'Mode'), modeSeg,
      h('p', { class: 'hint' }, 'D draws tiles on the plane · Tab toggles modes · B enables drag erase; D draws; right-drag pans.'));

    /* ---- construction plane ---- */
    const planeSeg = div('seg blue');
    for (const p of ['XY', 'XZ', 'YZ'] as Plane[]) {
      const b = button(`plane-${p}`, p);
      b.title = `Construction plane ${p}${p === 'XY' ? ' (Z-up tiles face +Z)' : p === 'XZ' ? ' (ground, tiles face +Y)' : ' (tiles face +X)'}`;
      b.addEventListener('click', () => {
        this.ctx.viewport.setPlane(p, this.ctx.session.planeLocked);
      });
      planeSeg.append(b);
    }
    const lockCheck = checkRow('Lock plane (disable auto camera plane)', this.ctx.session.planeLocked, (v) => {
      this.ctx.viewport.setPlane(this.ctx.session.plane, v);
    });
    lockCheck.dataset.role = 'plane-lock';
    const planeSec = div('panel-sec', h('h4', null, 'Construction plane'), planeSeg, lockCheck,
      h('p', { class: 'hint' }, 'Plane follows the dominant camera axis with hysteresis; locked keeps your choice. Frozen during strokes.'));

    /* ---- grid ---- */
    const gridSec = div('panel-sec', h('h4', null, 'Grid & tile size'));
    const gridLabel = h('span', { class: 'slider-label' }, 'Grid snap');
    const gridVal = h('span', { class: 'slider-val' }) as HTMLElement;
    const gridInput = h('input', { type: 'range', min: '0.05', max: '2', step: '0.05' }) as HTMLInputElement;
    gridInput.value = String(this.ctx.session.grid);
    gridVal.textContent = String(this.ctx.session.grid);
    gridInput.addEventListener('input', () => {
      this.ctx.session.grid = Number(gridInput.value);
      gridVal.textContent = gridInput.value;
      this.ctx.session.grid = Number(gridInput.value);
      this.ctx.refreshAll();
    });
    gridInput.dataset.input = 'true';
    gridSec.append(h('label', { class: 'slider-row' }, gridLabel, gridInput, gridVal));

    const tsLabel = h('span', { class: 'slider-label' }, 'Tile size');
    const tsVal = h('span', { class: 'slider-val' }) as HTMLElement;
    const tsInput = h('input', { type: 'range', min: '0.25', max: '4', step: '0.25' }) as HTMLInputElement;
    tsInput.value = String(this.ctx.session.tileSize);
    tsVal.textContent = String(this.ctx.session.tileSize);
    tsInput.addEventListener('input', () => {
      this.ctx.session.tileSize = Number(tsInput.value);
      tsVal.textContent = tsInput.value;
      this.ctx.refreshAll();
    });
    tsInput.dataset.input = 'true';
    gridSec.append(h('label', { class: 'slider-row' }, tsLabel, tsInput, tsVal));

    /* ---- selection / edit tools ---- */
    const segFace = h('div', { class: 'rail-group suite-transform-tools', role: 'group', 'aria-label': 'Selection tools' });
    for (const [label, tool] of [['Select', 'select'], ['Move', 'translate'], ['Rotate', 'rotate'], ['Scale', 'scale']] as const) {
      const b = iconButton(`rail-btn tool-${tool}`, {select:ICONS.cursor,translate:ICONS.move,rotate:ICONS.rotate,scale:ICONS.scale}[tool], tool === 'select' ? 'Select (E / Tab)' : label);
      if (tool === 'select') b.append(h('span', { class: 'kbd-tag', 'aria-hidden': 'true' }, 'E'));
      b.addEventListener('click', () => {
        this.setMode('edit');
        this.ctx.viewport.setTransformTool(tool);
        this.refresh();
      });
      segFace.append(b);
    }
    const vertCheck = checkRow('Vertex mode (click corners to select)', false, (v) => {
      this.ctx.viewport.setVertexMode(v);
    });
    vertCheck.dataset.role = 'vertex-mode';
    const selSec = div('panel-sec',
      h('h4', null, 'Edit tools',
        div('actions',
          iconButton('act-frame', ICONS.target, 'Frame selection (F)'),
        )),
      segFace, vertCheck);

    selSec.querySelector('.act-frame')!.addEventListener('click',()=>this.ctx.viewport.frameSelection());

    /* ---- selection info + numeric actions ---- */
    this.selInfo = div('sel-list');
    this.selActions = div('panel-sec');
    this.selActions.append(h('h4', null, 'Selection actions'));
    const grid1 = div('prop-grid three');
    const numeric = (label: string, id: string, step = '0.25') => {
      const inp = h('input', { type: 'number', step, id }) as HTMLInputElement;
      inp.dataset.input = 'true';
      inp.value = id.startsWith('sc-') ? '1' : '0';
      grid1.append(h('label', null, label, inp));
      return inp;
    };
    this.trX = numeric('dX', 'tr-x');
    this.trY = numeric('dY', 'tr-y');
    this.trZ = numeric('dZ', 'tr-z');
    const applyMove = button('btn', 'Translate', 'Apply numeric translation to selection');
    applyMove.addEventListener('click', () => {
      const d: [number, number, number] = [Number(this.trX.value) || 0, Number(this.trY.value) || 0, Number(this.trZ.value) || 0];
      this.applyToSelection('Translate selection', (project, sel) => {
        void project;
        void sel;
        return d;
      }, 'move');
    });
    const rotAxis = h('select', null,
      h('option', { value: 'x' }, 'X axis'),
      h('option', { value: 'y' }, 'Y axis'),
      h('option', { value: 'z' }, 'Z axis'),
    ) as HTMLSelectElement;
    const rotDeg = numeric('Degrees', 'rot-deg', '15');
    const applyRot = button('btn', 'Rotate', 'Rotate selection around crosshair pivot');
    applyRot.addEventListener('click', () => {
      const axis = rotAxis.value as 'x' | 'y' | 'z';
      const rad = (Number(rotDeg.value) || 0) * Math.PI / 180;
      this.applyToSelection('Rotate selection', (project, sel) => {
        void project; void sel;
        return { axis, rad };
      }, 'rotate');
    });
    const scX = numeric('Scale X', 'sc-x');
    const scY = numeric('Scale Y', 'sc-y');
    const scZ = numeric('Scale Z', 'sc-z');
    const applyScale = button('btn', 'Scale', 'Scale selection about crosshair pivot');
    applyScale.addEventListener('click', () => {
      const f: [number, number, number] = [
        this.scX.value === '' ? 1 : Number(this.scX.value),
        this.scY.value === '' ? 1 : Number(this.scY.value),
        this.scZ.value === '' ? 1 : Number(this.scZ.value),
      ];
      this.applyToSelection('Scale selection', (project, sel) => {
        void project; void sel;
        return f;
      }, 'scale');
    });
    this.scX = scX; this.scY = scY; this.scZ = scZ;

    const moveFields = div('prop-grid three');
    [this.trX,this.trY,this.trZ].forEach(input=>moveFields.append(input.parentElement!));
    rotAxis.id='rot-axis';
    rotAxis.setAttribute('aria-label','Rotation axis');
    const rotateFields = div('prop-grid');
    rotateFields.append(h('label',null,'Axis',rotAxis),rotDeg.parentElement!);
    const scaleFields = div('prop-grid three');
    [scX,scY,scZ].forEach(input=>scaleFields.append(input.parentElement!));
    const block=(title:string, fields:HTMLElement, action:HTMLButtonElement)=>div('transform-block',
      h('h5',{class:'transform-title'},title), fields, div('transform-action',action));
    this.selActions.append(
      block('Translation',moveFields,applyMove),
      block('Rotation',rotateFields,applyRot),
      block('Scale',scaleFields,applyScale),
      h('p',{class:'hint'},'Rotation and scale use the crosshair as their pivot.'));

    /* ---- UV ops ---- */
    const uvSec = div('panel-sec uv-operations-panel', h('h4', null, 'UV operations'));
    const uvRow = h('div', { class: 'control-action-grid uv-action-grid', role: 'group', 'aria-label': 'UV actions' });
    for (const [label, op] of [['Rotate UV', 'rotate'], ['Flip U', 'flipX'], ['Flip V', 'flipY']] as const) {
      const b = button(`uv-${op}${op === 'flipY' ? ' flip-vertical' : ''}`, label);
      b.prepend(svgIcon(op === 'rotate' ? ICONS.rotate : ICONS.flip, 14));
      b.addEventListener('click', () => this.uvOp(op));
      uvRow.append(b);
    }
    const uvOffX = h('input', { type: 'number', step: '0.125', placeholder: 'U offset', 'aria-label': 'UV U offset' }) as HTMLInputElement;
    const uvOffY = h('input', { type: 'number', step: '0.125', placeholder: 'V offset', 'aria-label': 'UV V offset' }) as HTMLInputElement;
    uvOffX.dataset.input = 'true'; uvOffY.dataset.input = 'true';
    const uvMove = button('btn', 'Offset UVs', 'Translate UVs of selected tiles by U/V');
    uvMove.addEventListener('click', () => {
      this.uvOp('translate', [Number(uvOffX.value) || 0, Number(uvOffY.value) || 0]);
    });
    const uvGrid = div('prop-grid');
    uvGrid.append(h('label', null, 'U offset', uvOffX), h('label', null, 'V offset', uvOffY));
    uvSec.append(uvRow, div('uv-offset-block', uvGrid, div('transform-action', uvMove)));

    /* ---- selection ops row ---- */
    const selOps = div('panel-sec', h('h4', null, 'Selection ops'));
    const opsRow = div('selection-ops-grid');
    for (const [label, op, title] of [
      ['Duplicate', 'duplicate', 'Duplicate selection offset by one tile'],
      ['Delete', 'delete', 'Delete selected tiles'],
      ['Reverse', 'reverse', 'Reverse tile winding'],
      ['Copy', 'copy', 'Copy selected tiles'],
      ['Paste', 'paste', 'Paste tiles at crosshair'],
    ] as const) {
      const b = button(`selop-${op}`, label, title);
      b.addEventListener('click', () => this.selectionOp(op));
      opsRow.append(b);
    }
    selOps.append(opsRow);

    const context=document.getElementById('suite-plate-context')!;
    modeSec.classList.add('suite-mode');planeSec.classList.add('suite-plane');
    const construction=h('details',{class:'suite-menu suite-construction'},h('summary',null,'Construction settings'),div('suite-menu-popup',gridSec,lockCheck));
    context.prepend(modeSec,planeSec,construction);
    const compact=matchMedia('(max-width:560px)');const placePlane=()=>{if(compact.matches)construction.lastElementChild!.prepend(planeSeg);else planeSec.prepend(planeSeg);};compact.addEventListener('change',placePlane);placePlane();
    document.getElementById('tool-rail')!.append(segFace);
    this.root.append(this.selInfo,this.selActions,selSec,selOps,uvSec);
    for(const hint of this.root.querySelectorAll('p.hint')){const details=h('details',{class:'suite-instructions'},h('summary',null,'Usage help'));hint.replaceWith(details);details.append(hint);}

  }

  private trX: HTMLInputElement;
  private trY: HTMLInputElement;
  private trZ: HTMLInputElement;
  private scX: HTMLInputElement;
  private scY: HTMLInputElement;
  private scZ: HTMLInputElement;

  /* clipboard lives app-level; main.ts registers handlers here */
  selectionOp: (op: 'duplicate' | 'delete' | 'reverse' | 'copy' | 'paste') => void = () => {};

  setMode(m: Mode): void {
    this.ctx.viewport.cancelGesture();
    if(m==='draw')this.ctx.viewport.setEraseTool(false);
    this.ctx.session.mode = m;
    if (m === 'draw') this.ctx.viewport.setTransformTool('select');
    this.ctx.refreshAll();
  }

  private applyToSelection<T>(
    label: string,
    compute: (project: import('../core/types').Project, sel: Sel) => T,
    kind: 'move' | 'rotate' | 'scale',
  ): void {
    const { store, session } = this.ctx;
    if (session.selection.tileIds.length === 0 && session.selection.vertices.length === 0) {
      this.ctx.refreshAll();
      return;
    }
    const pivot = [...session.crosshair] as import('../core/types').Vec3;
    try {
      store.transact(label, (project) => {
        // Core ops (translate/rotate/scale) act on selection.vertices (corner list).
        // Tile-level selection expands to all four corners of each selected tile;
        // vertices outside the tiles array are treated as stale and skipped.
        const alive = new Set(project.tiles.map((t) => t.id));
        const sel: Sel = {
          tileIds: [],
          vertices: [
            ...session.selection.vertices.filter((v) => alive.has(v.tileId)),
            ...session.selection.tileIds
              .filter((id) => alive.has(id))
              .flatMap((id) => [0, 1, 2, 3].map((corner) => ({ tileId: id, corner }))),
          ],
        };
        const val = compute(project, sel);
        const hooks = (window as unknown as { __pivoPlateSelOps?: Record<string, unknown> }).__pivoPlateSelOps;
        if (!hooks) throw new Error('Selection ops unavailable');
        if (kind === 'move') (hooks.translate as (p: import('../core/types').Project, s: Sel, d: [number, number, number]) => void)(project, sel, val as [number, number, number]);
        else if (kind === 'rotate') {
          const { axis, rad } = val as { axis: 'x' | 'y' | 'z'; rad: number };
          (hooks.rotate as (p: import('../core/types').Project, s: Sel, a: 'x' | 'y' | 'z', r: number, pv: [number, number, number]) => void)(project, sel, axis, rad, pivot);
        } else (hooks.scale as (p: import('../core/types').Project, s: Sel, f: [number, number, number], pv: [number, number, number]) => void)(project, sel, val as [number, number, number], pivot);
      });
      this.ctx.refreshAll();
    } catch (err) { toastError(err, label); }
  }

  private uvOp(op: 'rotate' | 'flipX' | 'flipY' | 'translate', offset?: [number, number]): void {
    const { store, session } = this.ctx;
    if (session.selection.tileIds.length === 0) return;
    const label = op === 'translate' ? 'UV translation' : `UV ${op}`;
    try {
      store.transact(label, (project) => {
        const hooks = (window as unknown as { __pivoPlateSelOps?: { transformUVs: unknown } }).__pivoPlateSelOps;
        if (!hooks) throw new Error('UV ops unavailable');
        const sel: Sel = { tileIds: [...session.selection.tileIds], vertices: [] };
        if (op === 'translate') {
          // UV translation: free UV movement, clamped to the 0..1 doc range so
          // documents stay valid (core validate rejects out-of-range UVs).
          if (!offset || !offset.every(Number.isFinite)) throw new Error('UV offset must be finite');
          for (const t of project.tiles) {
            if (!sel.tileIds.includes(t.id) || isObjectLocked(project,t.objectId)) continue;
            t.uvs = t.uvs.map(([u, v]): [number, number] => [
              Math.min(1, Math.max(0, u + offset[0])),
              Math.min(1, Math.max(0, v + offset[1])),
            ]) as typeof t.uvs;
          }
          return;
        }
        (hooks.transformUVs as (p: import('../core/types').Project, s: Sel, o: 'rotate' | 'flipX' | 'flipY', off?: [number, number]) => void)(
          project, sel, op, undefined,
        );
      });
      this.ctx.refreshAll();
    } catch (err) { toastError(err, label); }
  }

  refresh(): void {
    const session = this.ctx.session;
    // mode seg
    for (const m of ['draw', 'edit'] as Mode[]) {
      const b = document.querySelector(`#suite-plate-context .mode-${m}`) as HTMLButtonElement;
      if (b) {b.classList.toggle('active',session.mode===m);b.setAttribute('aria-pressed',String(session.mode===m));}
    }
    // plane seg + lock checkbox
    for (const p of ['XY', 'XZ', 'YZ'] as Plane[]) {
      const b = document.querySelector(`#suite-plate-context .plane-${p}`) as HTMLButtonElement;
      if (b) {b.classList.toggle('active',session.plane===p);b.setAttribute('aria-pressed',String(session.plane===p));}
    }
    const lock = document.querySelector('[data-role="plane-lock"] input') as HTMLInputElement | null;
    if (lock) lock.checked = session.planeLocked;
    // tools
    const tool = this.ctx.viewport.getTransformTool();
    for (const t of ['select', 'translate', 'rotate', 'scale']) {
      const b = document.querySelector(`#tool-rail .tool-${t}`) as HTMLButtonElement;
      if (b) {
        const active = session.mode === 'edit' && tool === t;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      }
    }
    // selection info
    const nT = session.selection.tileIds.length;
    const nV = session.selection.vertices.length;
    this.selInfo.innerHTML = nT === 0 && nV === 0
      ? '<span style="color:var(--text-2)">nothing selected</span>'
      : `<b>${nT}</b> tile(s) · <b>${nV}</b> corner(s) selected`;
    // disable edit actions when nothing selected
    const has = nT > 0 || nV > 0;
    for (const b of this.selActions.querySelectorAll('button')) (b as HTMLButtonElement).disabled = !has;
  }
}

export const _propsIcons = ICONS;
