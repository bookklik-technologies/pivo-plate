/**
 * Atlas panel — 2D atlas editor with cell selection, brush preview,
 * atlas metrics editing, and local PNG import with decode validation.
 */
import { validatePngBytes, validatePngDataUrl, preflightPngDataUrl, checkProjectPngBudget, pngBytesDataUrl, PNG_LIMITS } from '../core/png';
import type { Atlas, AtlasRegion, Brush } from '../core/types';
import { uid } from '../core/editor';
import { svgIcon, ICONS, button, checkRow, div, divAttrs, h, toast, toastError } from './dom';

export interface AtlasPanelContext {
  store: import('../core/editor').EditorStore;
  session: import('../core/types').EditorSession;
  refreshAll: () => void;
  onImportAtlas: (atlas: Atlas) => boolean;
  applyToSelection: () => void;
  canApplyToSelection: () => boolean;
}

/** PNG data URL → HTMLImageElement, rejects before commit if undecodable. */
export function decodeImage(dataUrl: string): Promise<HTMLImageElement> {
  let expected:{width:number;height:number};
  try{expected=validatePngDataUrl(dataUrl);}catch(error){return Promise.reject(error);}
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if(img.naturalWidth!==expected.width||img.naturalHeight!==expected.height)reject(new Error('Browser image dimensions do not match validated PNG'));
      else resolve(img);
    };
    img.onerror = () => reject(new Error('Image failed to decode (corrupt or unsupported)'));
    img.src = dataUrl;
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsDataURL(file);
  });
}

export class AtlasPanel {
  private ctx: AtlasPanelContext;
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private img: HTMLImageElement | null = null;
  private imgFor = ''; // dataUrl currently loaded into img
  private atlasId = '';
  private view = { zoom: 1, panX: 0, panY: 0 };
  private drag: { mode: 'none' | 'pan' | 'rect'; x0: number; y0: number; x1: number; y1: number; shift: boolean } | null = null;
  private hoverCell: AtlasRegion | null = null;
  private metricsInputs: Record<string, HTMLInputElement> = {};
  private needsFit = true;
  private imageVersion = 0;
  private applyBtn: HTMLButtonElement;
  private resizeObserver: ResizeObserver;
  private onMetricsCommit = (): void => {};

  constructor(root: HTMLElement, ctx: AtlasPanelContext, onMetricsCommit: () => void) {
    this.root = root;
    this.ctx = ctx;
    this.onMetricsCommit = onMetricsCommit;

    const importBtn = button('btn', 'Import PNG…', 'Load a local PNG tileset image');
    importBtn.prepend(svgIcon(ICONS.upload,14));
    const fileInput = h('input', { type: 'file', accept: 'image/png', style: 'display:none' }) as HTMLInputElement;
    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      fileInput.value = '';
      if (f) void this.importFile(f);
    });

    const secAtlas = div('panel-sec',
      h('h4', null, 'Atlas', div('actions', importBtn)),
      fileInput,
      h('div', { class: 'field-row' },
        h('select', { id: 'atlas-select', 'aria-label': 'Active atlas' }) as HTMLSelectElement,
      ),
    );
    const select = secAtlas.querySelector('select') as HTMLSelectElement;
    select.addEventListener('change', () => {
      this.ctx.session.brush.atlasId = select.value;
      this.refresh();
      this.ctx.refreshAll();
    });
    this.atlasSelect = select;

    const wrap = div('', );
    wrap.id = 'atlas-canvas-wrap';
    this.canvas = h('canvas', { id: 'atlas-canvas' }) as HTMLCanvasElement;
    wrap.append(this.canvas);
    this.g = this.canvas.getContext('2d')!;
    secAtlas.append(wrap);

    this.bindAtlasPointer(wrap);

    const metrics = div('panel-sec',
      h('h4', null, 'Tile metrics'),
      div('atlas-metrics-grid',
        this.metricRow('tileWidth', 'Tile width'),
        this.metricRow('tileHeight', 'Tile height'),
        this.metricRow('margin', 'Margin'),
        this.metricRow('spacing', 'Spacing'),
      ),
      h('p', { class: 'hint' }, 'Cells are the image area inside margin/spacing. Changing metrics reselects a valid brush.'),
    );
    for (const inp of Object.values(this.metricsInputs)) {
      inp.addEventListener('change', () => this.commitMetrics());
      inp.dataset.input = 'true';
    }

    const brushSec = div('panel-sec',
      h('h4', null, 'Brush'),
      div('brush-row',
        div('brush-preview-box', h('canvas', { width: '64', height: '64' }) as HTMLCanvasElement),
        div('',
          this.brushRegionLabel = h('div', { class: 'sel-list' }) as HTMLDivElement,
          h('p', { class: 'hint' }, 'Click a cell; drag for a rectangular region. Middle-drag pans, wheel zooms the sheet.'),
        ),
      ),
    );
    this.brushPreviewCanvas = brushSec.querySelector('canvas') as HTMLCanvasElement;

    const flipX = button('seg-fx', 'Flip X', 'Mirror the brush horizontally');
    const flipY = button('seg-fy flip-vertical', 'Flip Y', 'Mirror the brush vertically');
    flipX.prepend(svgIcon(ICONS.flip, 14));
    flipY.prepend(svgIcon(ICONS.flip, 14));
    const flipSec = div('panel-sec brush-transform-panel',
      h('h4', null, 'Brush transform'),
      h('span', { class: 'control-group-label' }, 'Rotation'),
      h('div', { class: 'brush-rotation-choices', role: 'group', 'aria-label': 'Brush rotation' },
        ...([0, 1, 2, 3] as const).map((r) => {
          const b = button(`seg-rot${r}`, `${r * 90}°`, `Rotate brush ${r * 90}°`);
          b.setAttribute('aria-label', `Rotate brush ${r * 90}°`);
          return b;
        }),
      ),
      h('span', { class: 'control-group-label' }, 'Mirror'),
      h('div', { class: 'control-action-grid brush-flip-controls', role: 'group', 'aria-label': 'Brush mirroring' }, flipX, flipY),
      h('p', { class: 'hint' }, 'Choose a quarter-turn or flip for the current tile brush.'),
    );
    // wire brush transform buttons
    flipSec.querySelectorAll('.seg-rot0,.seg-rot1,.seg-rot2,.seg-rot3').forEach((b, i) => {
      (b as HTMLButtonElement).addEventListener('click', () => {
        this.ctx.session.brush.rotation = i as Brush['rotation'];
        this.refresh();
      });
    });
    const fx = flipSec.querySelector('.seg-fx') as HTMLButtonElement;
    const fy = flipSec.querySelector('.seg-fy') as HTMLButtonElement;
    fx.addEventListener('click', () => {
      this.ctx.session.brush.flipX = !this.ctx.session.brush.flipX;
      this.refresh();
    });
    fy.addEventListener('click', () => {
      this.ctx.session.brush.flipY = !this.ctx.session.brush.flipY;
      this.refresh();
    });

    this.applyBtn=button('btn','Apply Brush','Apply this atlas region to selected editable faces');
    this.applyBtn.id='atlas-apply-brush';
    this.applyBtn.prepend(svgIcon(ICONS.brush,14));
    this.applyBtn.addEventListener('click',()=>this.ctx.applyToSelection());
    brushSec.append(h('div',{class:'brush-apply-action'},this.applyBtn));
    root.append(secAtlas, metrics, brushSec, flipSec);
    this.resizeObserver=new ResizeObserver(()=>{
      if(!this.img||!wrap.clientWidth||!wrap.clientHeight) return;
      this.fitIfNeeded();this.draw();
    });
    this.resizeObserver.observe(wrap);
  }

  private atlasSelect: HTMLSelectElement;
  private brushRegionLabel: HTMLDivElement;
  private brushPreviewCanvas: HTMLCanvasElement;

  private metricRow(key: string, label: string): HTMLElement {
    const input = h('input', { type: 'number', min: '1', step: '1' }) as HTMLInputElement;
    input.id = `atlas-${key}`;
    this.metricsInputs[key] = input;
    return h('label', { class: 'metric-field' }, h('span', null, label), input);
  }

  /* ------------------------------------------------------- import */

  async importFile(file: File): Promise<void> {
    try {
      if (file.type !== 'image/png' && !file.name.toLowerCase().endsWith('.png')) throw new Error('Only PNG tilesets are supported');
      if(file.size>PNG_LIMITS.maxBytes)throw new Error('PNG exceeds byte budget');
      const bytes=new Uint8Array(await file.arrayBuffer());
      const info=validatePngBytes(bytes);
      checkProjectPngBudget([...this.ctx.store.project.atlases.map(a=>preflightPngDataUrl(a.dataUrl,{width:a.width,height:a.height})),info],0);
      const dataUrl=pngBytesDataUrl(bytes);
      const img = await decodeImage(dataUrl); // validate before commit
      if (img.naturalWidth > 16384 || img.naturalHeight > 16384 || img.naturalWidth * img.naturalHeight > 16777216) throw new Error('PNG exceeds 16384-pixel dimension limit');
      const name = file.name.replace(/\.[^.]+$/, '');
      // Add atlas in one atomic transaction.
      const atlas: Atlas = {
        id: uid('atlas'), name, width: img.naturalWidth, height: img.naturalHeight,
        tileWidth: this.guessTileSize(img.naturalWidth), tileHeight: this.guessTileSize(img.naturalHeight),
        margin: 0, spacing: 0, dataUrl,
      };
      if(!this.ctx.onImportAtlas(atlas))return;
      toast(`Imported atlas "${name}" (${img.naturalWidth}×${img.naturalHeight})`, 'success');
    } catch (err) {
      toastError(err, 'Atlas import failed');
    }
  }

  private guessTileSize(w: number): number {
    for (const s of [8, 16, 24, 32, 48, 64, 128]) if (w % s === 0 && w / s >= 2) return s;
    return Math.min(16,w);
  }

  /* ------------------------------------------------------- refresh */

  refresh(): void {
    const project = this.ctx.store.project;
    const session = this.ctx.session;
    this.root.querySelectorAll<HTMLButtonElement>('.seg-rot0,.seg-rot1,.seg-rot2,.seg-rot3').forEach((b, i) => {
      const active = session.brush.rotation === i;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    for (const [selector, active] of [['.seg-fx', session.brush.flipX], ['.seg-fy', session.brush.flipY]] as const) {
      const b = this.root.querySelector<HTMLButtonElement>(selector)!;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    }
    this.applyBtn.disabled=!this.ctx.canApplyToSelection();
    const wrap = this.canvas.parentElement;
    const panelHidden = !wrap || wrap.clientWidth < 4;
    // keep brush atlas valid
    if (!project.atlases.some((a) => a.id === session.brush.atlasId)) {
      session.brush.atlasId = project.atlases[0]?.id ?? '';
    }
    // atlas dropdown
    this.atlasSelect.innerHTML = '';
    for (const a of project.atlases) {
      const opt = h('option', { value: a.id }, a.name) as HTMLOptionElement;
      this.atlasSelect.append(opt);
    }
    this.atlasSelect.value = session.brush.atlasId;
    this.atlasSelect.disabled = project.atlases.length === 0;

    const atlas = project.atlases.find((a) => a.id === session.brush.atlasId) ?? null;
    if (!atlas) {
      this.brushRegionLabel.textContent = 'No atlas — use Import PNG or File ▸ New with demo tileset.';
      this.img=null;this.imgFor='';this.atlasId='';this.needsFit=true;
      this.imageVersion++;this.draw();
      this.brushPreviewCanvas.getContext('2d')?.clearRect(0,0,this.brushPreviewCanvas.width,this.brushPreviewCanvas.height);
      return;
    }
    // metrics inputs
    for (const [k, inp] of Object.entries(this.metricsInputs)) {
      const v = (atlas as unknown as Record<string, number>)[k];
      if (document.activeElement !== inp) inp.value = String(v);
      inp.min = k === 'margin' || k === 'spacing' ? '0' : '1';
    }
    // load image if changed
    if (this.imgFor !== atlas.dataUrl || this.atlasId !== atlas.id) {
      this.atlasId = atlas.id;
      this.imgFor = atlas.dataUrl;
      this.view = { zoom: 1, panX: 0, panY: 0 };
      this.needsFit=true;this.img=null;
      const version=++this.imageVersion;
      const im = new Image();
      im.onload = () => {
        if(version!==this.imageVersion) return;
        this.img = im;
        const w2 = this.canvas.parentElement;
        if (!w2 || w2.clientWidth < 4) return; // panel hidden; drawn on next refresh when visible
        this.fitIfNeeded();
        this.draw();
        this.drawBrushPreview(atlas);
      };
      im.onerror = () => { if(version!==this.imageVersion)return;this.img=null;this.draw(); };
      im.src = atlas.dataUrl;
    }
    this.sanitizeBrush(atlas);
    if (panelHidden) return; // fit remains pending until the panel is measurable
    this.fitIfNeeded();
    this.draw();
    this.drawBrushPreview(atlas);
    const r = session.brush.region;
    this.brushRegionLabel.innerHTML = `region <b>${r.x},${r.y} ${r.width}×${r.height}</b> px<br>cell ${(r.width / Math.max(1, atlas.tileWidth)).toFixed(0)}×${(r.height / Math.max(1, atlas.tileHeight)).toFixed(0)} tiles`;
  }

  private sanitizeBrush(atlas: Atlas): void {
    const r = this.ctx.session.brush.region;
    r.x = Math.max(0, Math.min(atlas.width - 1, Math.round(r.x)));
    r.y = Math.max(0, Math.min(atlas.height - 1, Math.round(r.y)));
    r.width = Math.max(1, Math.min(atlas.width - r.x, Math.round(r.width)));
    r.height = Math.max(1, Math.min(atlas.height - r.y, Math.round(r.height)));
  }

  private commitMetrics(): void {
    const project = this.ctx.store.project;
    const atlas = project.atlases.find((a) => a.id === this.ctx.session.brush.atlasId);
    if (!atlas) return;
    const num = (k: string, def: number): number => {
      const v = Math.round(Number(this.metricsInputs[k].value));
      return Number.isFinite(v) ? v : def;
    };
    for(const input of Object.values(this.metricsInputs)) { input.removeAttribute('aria-invalid'); input.setCustomValidity(''); }
    const next = {
      tileWidth: Math.max(1, num('tileWidth', atlas.tileWidth)),
      tileHeight: Math.max(1, num('tileHeight', atlas.tileHeight)),
      margin: Math.max(0, num('margin', atlas.margin)),
      spacing: Math.max(0, num('spacing', atlas.spacing)),
    };
    try {
      this.ctx.store.transact(`Atlas metrics (${atlas.name})`, (p) => {
        const a = p.atlases.find((x) => x.id === atlas.id);
        if (!a) return;
        Object.assign(a, next);
      });
      this.onMetricsCommit();
    } catch (err) {
      const message=err instanceof Error?err.message:String(err);
      for(const [key,input] of Object.entries(this.metricsInputs)) {
        if(input.value !== String((atlas as unknown as Record<string,number>)[key])) input.setAttribute('aria-invalid','true');
        input.value=String((atlas as unknown as Record<string,number>)[key]);
      }
      toast(`Atlas metrics not changed: ${message}`, 'error');
      this.refresh();
    }
  }

  /* ------------------------------------------------------- canvas 2D */

  private fitIfNeeded(): void {
    const wrap=this.canvas.parentElement;
    if(this.needsFit&&this.img&&wrap&&wrap.clientWidth>0&&wrap.clientHeight>0) {
      this.fitView();this.needsFit=false;
    }
  }

  private fitView(): void {
    const wrap = this.canvas.parentElement!;
    const zw = wrap.clientWidth / Math.max(1, this.img?.naturalWidth ?? 1);
    const zh = wrap.clientHeight / Math.max(1, this.img?.naturalHeight ?? 1);
    this.view.zoom = Math.min(zw, zh);
    this.view.panX = 0; this.view.panY = 0;
  }

  private toImage(x: number, y: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const ix = (x - rect.left) / this.view.zoom - this.view.panX;
    const iy = (y - rect.top) / this.view.zoom - this.view.panY;
    return { x: ix, y: iy };
  }

  private cellAtImage(px: number, py: number, atlas: Atlas): AtlasRegion | null {
    const stepX = atlas.tileWidth + atlas.spacing;
    const stepY = atlas.tileHeight + atlas.spacing;
    const innerW = atlas.width - 2 * atlas.margin;
    const innerH = atlas.height - 2 * atlas.margin;
    if (px < atlas.margin || py < atlas.margin) return null;
    const fx = px - atlas.margin, fy = py - atlas.margin;
    if (fx > innerW || fy > innerH) return null;
    const col = Math.floor(fx / stepX), row = Math.floor(fy / stepY);
    const cx = fx - col * stepX, cy = fy - row * stepY;
    if (cx >= atlas.tileWidth || cy >= atlas.tileHeight) return null; // in spacing gap
    return {
      x: atlas.margin + col * stepX,
      y: atlas.margin + row * stepY,
      width: atlas.tileWidth,
      height: atlas.tileHeight,
    };
  }

  private bindAtlasPointer(wrap: HTMLElement): void {
    wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const nz = Math.max(0.05, Math.min(40, this.view.zoom * factor));
      const k = nz / this.view.zoom;
      this.view.panX = mx - (mx - this.view.panX) * k;
      this.view.panY = my - (my - this.view.panY) * k;
      this.view.zoom = nz;
      this.draw();
    }, { passive: false });

    wrap.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || e.button === 2 || e.altKey) {
        this.drag = { mode: 'pan', x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, shift: false };
      } else if (e.button === 0) {
        this.drag = { mode: 'rect', x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, shift: e.shiftKey };
        this.setBrushFromRect(false);
      }
      wrap.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    wrap.addEventListener('pointermove', (e) => {
      const atlas = this.currentAtlas();
      if (atlas && !this.drag) {
        const p = this.toImage(e.clientX, e.clientY);
        this.hoverCell = this.cellAtImage(p.x, p.y, atlas);
        this.draw();
      }
      if (!this.drag) return;
      this.drag.x1 = e.clientX; this.drag.y1 = e.clientY;
      if (this.drag.mode === 'pan') {
        this.view.panX += e.clientX - this.drag.x0;
        this.view.panY += e.clientY - this.drag.y0;
        this.drag.x0 = e.clientX; this.drag.y0 = e.clientY;
        this.draw();
      } else {
        this.draw();
        this.setBrushFromRect(false);
      }
    });
    const end = (e: PointerEvent): void => {
      if (!this.drag) return;
      const wasRect = this.drag.mode === 'rect';
      const pos = { x0: this.drag.x0, y0: this.drag.y0, x1: e.clientX, y1: e.clientY };
      this.drag = null;
      if (wasRect) {
        this.drag = { mode: 'rect', ...pos, shift: false };
        this.setBrushFromRect(true);
        this.drag = null;
      }
    };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);
  }

  getViewState(): {zoom:number;panX:number;panY:number;needsFit:boolean;imageReady:boolean} {return {...this.view,needsFit:this.needsFit,imageReady:!!this.img};}

  private currentAtlas(): Atlas | null {
    return this.ctx.store.project.atlases.find((a) => a.id === this.ctx.session.brush.atlasId) ?? null;
  }

  private setBrushFromRect(commit: boolean): void {
    const atlas = this.currentAtlas();
    if (!atlas) return;
    const a = this.toImage(Math.min(this.drag!.x0, this.drag!.x1), Math.min(this.drag!.y0, this.drag!.y1));
    const b = this.toImage(Math.max(this.drag!.x0, this.drag!.x1), Math.max(this.drag!.y0, this.drag!.y1));
    const r0 = this.cellAtImage(a.x, a.y, atlas);
    const r1 = this.cellAtImage(b.x - 0.01, b.y - 0.01, atlas);
    if (!r0 || !r1) return;
    const region: AtlasRegion = {
      x: Math.min(r0.x, r1.x),
      y: Math.min(r0.y, r1.y),
      width: Math.max(r0.x + r0.width, r1.x + r1.width) - Math.min(r0.x, r1.x),
      height: Math.max(r0.y + r0.height, r1.y + r1.height) - Math.min(r0.y, r1.y),
    };
    this.ctx.session.brush.region = region;
    this.drawBrushPreview(atlas);
    this.brushRegionLabel.innerHTML = `region <b>${region.x},${region.y} ${region.width}×${region.height}</b> px<br>cell ${(region.width / atlas.tileWidth).toFixed(0)}×${(region.height / atlas.tileHeight).toFixed(0)} tiles`;
    if (commit) { this.draw(); this.ctx.refreshAll(); }
  }

  private draw(): void {
    const wrap = this.canvas.parentElement!;
    const w = wrap.clientWidth, hh = wrap.clientHeight;
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (this.canvas.width !== w * dpr || this.canvas.height !== hh * dpr) {
      this.canvas.width = w * dpr; this.canvas.height = hh * dpr;
    }
    const light=document.documentElement.dataset.theme==='light';
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hh);
    const atlas = this.currentAtlas();
    if (!this.img || !atlas) {
      g.fillStyle=light?'#526173':'#8a97a6';
      g.font = '11px ui-monospace, monospace';
      g.fillText('no atlas image', 10, 20);
      return;
    }
    g.save();
    g.imageSmoothingEnabled = false;
    g.translate(this.view.panX, this.view.panY);
    g.scale(this.view.zoom, this.view.zoom);
    g.drawImage(this.img, 0, 0);
    g.restore();

    const t = (x: number, y: number): { x: number; y: number } => ({
      x: x * this.view.zoom + this.view.panX,
      y: y * this.view.zoom + this.view.panY,
    });
    // cell grid
    g.lineWidth = 1;
    g.strokeStyle=light?'rgba(55,110,19,.28)':'rgba(182,240,74,.25)';
    const stepX = atlas.tileWidth + atlas.spacing;
    const stepY = atlas.tileHeight + atlas.spacing;
    for (let x = atlas.margin; x <= atlas.width - atlas.tileWidth; x += stepX) {
      const a = t(x, 0), b = t(x, atlas.height);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    for (let y = atlas.margin; y <= atlas.height - atlas.tileHeight; y += stepY) {
      const a = t(0, y), b = t(atlas.width, y);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    // hover cell
    if (this.hoverCell && !this.drag) {
      const r = this.hoverCell;
      const a = t(r.x, r.y);
      g.strokeStyle=light?'#1468a0':'#4aa8f0';
      g.lineWidth = 1.5;
      g.strokeRect(a.x, a.y, r.width * this.view.zoom, r.height * this.view.zoom);
    }
    // brush region + drag rect (real pixel rectangle)
    let region: AtlasRegion | null = this.ctx.session.brush.region;
    if (this.drag?.mode === 'rect') {
      const a = this.toImage(Math.min(this.drag.x0, this.drag.x1), Math.min(this.drag.y0, this.drag.y1));
      const b = this.toImage(Math.max(this.drag.x0, this.drag.x1), Math.max(this.drag.y0, this.drag.y1));
      region = { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
    }
    if (region) {
      const a = t(region.x, region.y);
      g.strokeStyle=light?'#376e13':'#b6f04a';
      g.lineWidth = 2;
      g.strokeRect(a.x, a.y, region.width * this.view.zoom, region.height * this.view.zoom);
    }
  }

  private drawBrushPreview(atlas: Atlas): void {
    const c = this.brushPreviewCanvas;
    const g = c.getContext('2d');
    if (!g) return;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    if (!this.img) return;
    const r = this.ctx.session.brush.region;
    const scale = Math.min(c.width / r.width, c.height / r.height);
    const dw = r.width * scale, dh = r.height * scale;
    g.drawImage(this.img, r.x, r.y, r.width, r.height, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
    void atlas;
  }
}
