/**
 * PiVo Plate — application entry.
 * Builds the shell, wires the viewport + panels, owns file I/O, autosave,
 * shortcuts and the window.__pivoPlateTest diagnostics surface.
 */
import '@fontsource-variable/outfit';
import './ui/styles.css';
import './ui/suite.css';
import './ui/suite-app.css';
import logo from '../logo.svg?url';
import {resize,tabKeys,installDisclosureMenus,installDockToggle,positionPopup} from './ui/suite';
import * as THREE from 'three';
import type { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { Atlas, EditorSession, Mode, Plane, Project, Selection } from './core/types';
import type { EditorStore } from './core/editor';
import {
  EditorStore as Store, createProject, createSession, duplicateSelection, deleteSelection, reverseSelection,
  rotateSelection, scaleSelection, translateSelection, transformUVs,
  applyBrush, isObjectLocked, isObjectVisible, selectedCorners, validateProject,
} from './core/editor';
import { DEFAULT_OBJECT_ID } from './core/types';
import {
  resolveRecovery, decodeProject, downloadBytes, encodeProject, inspectAutosave, saveAutosave,
} from './io/project';
import { exportGLB, exportOBJ } from './io/export';
import { LIMITS as ARCHIVE_LIMITS } from './io/util';
import { Viewport, type FrameTelemetry } from './ui/viewport';
import { AtlasPanel, decodeImage } from './ui/atlasPanel';
import { ObjectsPanel } from './ui/objectsPanel';
import { PropertiesPanel } from './ui/propertiesPanel';
import { buildSampleScene, makeDemoAtlas } from './ui/demoAssets';
import { isModalOpen, mountModal, svgIcon, type Glyph, button, clearChildren, confirmModal, div, h, iconButton, ICONS, toast, toastError } from './ui/dom';

import { applyRootTheme, readTheme, persistTheme, type Theme, type PreferenceStorage } from './ui/theme';
import { menuGlyph } from './ui/icons';import { showAboutModal } from './ui/about';

/* ------------------------------------------------------------------ */
/* shell                                                              */
/* ------------------------------------------------------------------ */

function themeStorage():PreferenceStorage|null {try{return window.localStorage;}catch{return null;}}
let currentTheme:Theme=readTheme(themeStorage());
applyRootTheme(currentTheme);
const app = document.getElementById('app')!;
const themeToggle=iconButton('theme-toggle',currentTheme==='dark'?ICONS.sun:ICONS.moon,'Switch to light theme');
themeToggle.id='theme-toggle';
themeToggle.addEventListener('click',()=>setTheme(currentTheme==='dark'?'light':'dark'));

// header
const header = h('header', { id: 'app-header' });
const docName = h('div', { id: 'doc-name' },
  h('span', { class: 'dirty-dot clean', id: 'dirty-dot' }),
  h('span', { class: 'name', id: 'doc-name-text' }, 'Untitled'),
);
const menubar = h('nav', { id: 'menubar' });
let rendererInfoEl: HTMLElement;
header.append(
  div('logo-mark suite-brand',h('img',{src:logo,alt:''}),h('span',null,'PiVo Plate')),
  menubar,
  div('header-actions',
    iconButton('hdr-undo', ICONS.undo, 'Undo (Ctrl/Cmd+Z)'),
    iconButton('hdr-redo', ICONS.redo, 'Redo (Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Y)'),
    h('button',{type:'button',class:'btn suite-file-action hdr-save','aria-label':'Save project'},svgIcon(ICONS.save),h('span',{class:'suite-action-label'},'Save project')),
    h('button',{type:'button',class:'btn suite-file-action hdr-export','aria-label':'Export'},svgIcon(ICONS.download),h('span',{class:'suite-action-label'},'Export')),
    themeToggle,
  ),
);

// recovery banner
const recoverBanner = h('div', { id: 'recover-banner' });
recoverBanner.append(
  h('span', {class:'inline-icon'}, svgIcon(ICONS.warning), 'Autosaved session found.'),
  h('span', { class: 'grow' }),
);
{
  const restore = button('btn btn-primary', 'Restore autosave');
  const discard = button('btn', 'Discard');
  recoverBanner.append(restore, discard);
}

// workspace
const workspace = div('') as HTMLElement;
workspace.id = 'workspace';
const toolRail = h('nav', { id: 'tool-rail' });
const vpHost = div('') as HTMLElement;
vpHost.id = 'viewport-host';
vpHost.append(
  h('div', { class: 'vp-overlay', id: 'plane-hud' }),
  h('div', { class: 'vp-overlay', id: 'vp-corners' }),
  h('div', { class: 'vp-overlay', id: 'stroke-hint' }, 'Drag to stamp tiles · release to commit · Esc cancels'),
  h('div', { id: 'drop-hint' }, 'Drop PNG atlas'),
);
const glError = div('');
glError.id = 'gl-error';
glError.append(
  h('h2', null, 'WebGL unavailable'),
  h('p', null, 'PiVo Plate needs WebGL for the 3D viewport. Enable hardware acceleration or try another browser. The panels below still work, but the viewport is disabled.'),
);
vpHost.append(glError);

const sideToggle = button('suite-dock-toggle', 'Panels', 'Toggle panels');
sideToggle.id = 'side-toggle';

const sidebar = h('aside', { id: 'sidebar-right',class:'suite-dock','aria-label':'Panels' });
const sideTabs = h('nav', { id: 'side-tabs' });
const atlasPage = div('side-page') as HTMLElement;
const objectsPage = div('side-page') as HTMLElement;
const propsPage = div('side-page') as HTMLElement;
objectsPage.classList.add('suite-hierarchy','active');
const hierarchyResize=div('suite-resize');hierarchyResize.setAttribute('aria-label','Scene hierarchy height');
sidebar.append(objectsPage,hierarchyResize,sideTabs,atlasPage,propsPage);
resize(hierarchyResize,sidebar,'--pivo-hierarchy-height',160,100,400,'pivo-plate-hierarchy');

workspace.append(toolRail, vpHost, sideToggle, sidebar);

// status bar
const statusBar = h('footer', { id: 'status-bar' });
const stModeV = h('span', { class: 'v lime' }, 'draw');
const stPlaneV = h('span', { class: 'v blue' }, 'XZ');
const stSelV = h('span', { class: 'v' }, '0');
const stTilesV = h('span', { class: 'v' }, '0');
const stMsg = h('span', { id: 'status-msg',role:'status','aria-live':'polite' }, '');
const helpBtn = button('inline-icon', 'Shortcuts', 'Show shortcuts and usage help');
helpBtn.prepend(svgIcon(ICONS.keyboard,14));
helpBtn.id = 'status-help-btn';
statusBar.append(
  h('span', { class: 'status-cell' }, h('span', { class: 'k' }, 'mode'), stModeV),
  h('span', { class: 'status-cell' }, h('span', { class: 'k' }, 'plane'), stPlaneV),
  h('span', { class: 'status-cell' }, h('span', { class: 'k' }, 'sel'), stSelV),
  h('span', { class: 'status-cell' }, h('span', { class: 'k' }, 'tiles'), stTilesV),
  h('span', { class: 'status-cell' }, h('span', { class: 'k' }, 'renderer'), (rendererInfoEl = h('span', { class: 'v' }, '—'))),
  stMsg,
  helpBtn,
);

const toasts = div('');
toasts.id = 'toasts';

header.classList.add('suite-header');menubar.classList.add('suite-menus');header.querySelector('.header-actions')!.classList.add('suite-header-actions');
const saveState=h('span',{class:'suite-save-state',role:'status','aria-live':'polite'});
const documentStrip=div('suite-document-strip',docName,saveState,sideToggle);
sideToggle.setAttribute('aria-controls','sidebar-right');sideToggle.setAttribute('aria-expanded','false');
const contextToolbar=div('suite-context-toolbar');contextToolbar.id='suite-plate-context';
contextToolbar.append(vpHost.querySelector('#plane-hud')!);
app.append(header,documentStrip,contextToolbar,recoverBanner,workspace,statusBar,toasts);
header.querySelector('.hdr-save')!.addEventListener('click',()=>void saveDocument());
header.querySelector('.hdr-export')!.addEventListener('click',showExportDialog);
const systemPreference=matchMedia('(prefers-color-scheme: dark)');
systemPreference.addEventListener('change',()=>{try{if(!themeStorage()?.getItem('pivo-plate-theme'))setTheme(systemPreference.matches?'dark':'light',false);}catch{}});
function useSystemTheme(){try{window.localStorage.removeItem('pivo-plate-theme');}catch{}setTheme(systemPreference.matches?'dark':'light',false);}


/* ------------------------------------------------------------------ */
/* state                                                              */
/* ------------------------------------------------------------------ */

let store: EditorStore;
let session: EditorSession;
let viewport: Viewport;
let atlasPanel: AtlasPanel;
let objectsPanel: ObjectsPanel;
let propsPanel: PropertiesPanel;
let currentFileName = 'scene.pvp';
let cleanDocumentState='Sample document';
let recoverySnapshot='';
let savedMarker = ''; // project snapshot of last save
let clipboard: { tiles: { vertices: [number, number, number][]; uvs: [number, number][]; reversed: boolean; atlasId: string }[] } | null = null;
let autosaveTimer: number | null = null;
let autosaveDirty = false;
let recoveryAvailable = true;
let recoveryCheckComplete = false;
let recoveryPending = false;
let recoveryWriteQueue: Promise<void> = Promise.resolve();
let lastAutosaveRevision = -1;

const AUTOSAVE_DEBOUNCE_MS = 1200;

/* ------------------------------------------------------------------ */
/* boot                                                               */
/* ------------------------------------------------------------------ */

async function boot(): Promise<void> {
  try {
    await initApp();
  } catch (err) {
    console.error(err);
    const msg = document.createElement('div');
    msg.style.cssText = 'padding:30px;color:#f05a5a;font:13px monospace;white-space:pre-wrap';
    msg.textContent = `PiVo Plate failed to start:\n${err instanceof Error ? err.stack ?? err.message : String(err)}`;
    app.textContent = '';
    app.append(msg);
  }
}

async function initApp(): Promise<void> {
  const demoAtlas = makeDemoAtlas();
  const project = buildSampleScene(demoAtlas);
  store = new Store(project);
  session = createSession(project);
  session.brush.atlasId = demoAtlas.id;
  session.brush.region = { x: demoAtlas.margin, y: demoAtlas.margin, width: demoAtlas.tileWidth, height: demoAtlas.tileHeight };
  savedMarker = JSON.stringify(store.project);

  // Viewport needs renderer first for host measurement
  viewport = new Viewport(vpHost, {
    store,
    session,
    onStatus: (m) => setStatusMsg(m),
    onTransient: (m) => setStatusMsg(m),
    onTransformReadout: (t) => setStatusMsg(t),
    onError: (err, c) => toastError(err, c),
    onTelemetry:value=>updateFrameHud(value),
    onSessionDirty: () => refreshAll(),
  });

  viewport.setTheme(currentTheme);

  atlasPanel = new AtlasPanel(atlasPage, {
    store, session,
    refreshAll: refreshAll,
    applyToSelection:()=>opsApplyBrush(),
    canApplyToSelection:()=>canApplyBrush(),
    onImportAtlas: (atlas) => {
      try {
        store.transact(`Import atlas ${atlas.name}`, (p) => {
          p.atlases.push(atlas);
        });
        session.brush.atlasId = atlas.id;
        session.brush.region = { x: atlas.margin, y: atlas.margin, width: atlas.tileWidth, height: atlas.tileHeight };
        refreshAll();
        return true;
      } catch (err) { toastError(err, 'Atlas import'); return false; }
    },
  }, () => refreshAll());

  objectsPanel = new ObjectsPanel(objectsPage, {
    store, session, refreshAll,
    requestConfirm: (title, body, label, onConfirm, danger) => confirmModal(title, body, label, onConfirm, { danger }),
  });

  propsPanel = new PropertiesPanel(propsPage, {
    store, session, refreshAll, viewport: {
      setPlane: (p, lock) => viewport.setPlane(p, lock),
      setTransformTool: (t) => { viewport.setTransformTool(t); refreshAll(); },
      getTransformTool: () => viewport.getTransformTool() as 'select',
      setCameraKind: (k) => { viewport.setCameraKind(k); refreshAll(); },
      getCameraKind: () => viewport.getCameraKind(),
      setVertexMode: (on) => { viewport.setVertexMode(on); refreshAll(); },
      frameSelection: () => viewport.frameSelection(),
      setEraseTool:on=>viewport.setEraseTool(on),
      cancelGesture:()=>viewport.cancelStroke(),
    },
    requestConfirm: (title, body, label, onConfirm, danger) => confirmModal(title, body, label, onConfirm, { danger }),
  });

  propsPanel.selectionOp = op => ({ duplicate: opsDuplicate, delete: opsDelete, reverse: opsReverse, copy: opsCopy, paste: opsPaste })[op]();

  // properties panel uses injected core ops for numeric actions
  (window as unknown as { __pivoPlateSelOps?: unknown }).__pivoPlateSelOps = {
    translate: translateSelection,
    rotate: rotateSelection,
    scale: scaleSelection,
    transformUVs,
  };

  buildToolRail();
  buildMenus();
  buildSideTabs();
  buildPlaneHud();
  const compactConstruction=matchMedia('(max-width:560px)');const placeCrosshair=()=>{const hud=document.getElementById('plane-hud')!;if(compactConstruction.matches)document.querySelector('.suite-construction .suite-menu-popup')!.append(hud);else contextToolbar.append(hud);};compactConstruction.addEventListener('change',placeCrosshair);placeCrosshair();
  installDisclosureMenus();
  wireStatusHelp();
  wireKeyboard();
  wireDragDrop();
  wireAutosaveLifecycle();

  store.subscribe(() => scheduleAutosave());
  store.subscribe(() => refreshAll());

  // restore autosave prompt — never silently replace
  try {
    const record = await inspectAutosave();
    if (record.status !== 'empty') showRecoverBanner(record);
  } catch {
    recoveryAvailable = false;
    docName.append(h('span',{class:'storage-note',title:'Browser recovery is restricted here. Save a downloadable project backup.'},'No autosave'));
    toast('Browser recovery is unavailable in this context. Use File > Save for downloadable backups.', 'info');
  } finally {
    recoveryCheckComplete = true;
    if(autosaveDirty && !recoveryPending) scheduleAutosave();
  }

  setTheme(currentTheme);
  refreshAll();
  viewport.rebuildGrid();
  viewport.frameAll();
  showFirstRunHelp();
  installTestHooks();
}

/* ------------------------------------------------------------------ */
/* tool rail                                                          */
/* ------------------------------------------------------------------ */

function buildToolRail(): void {
  const g1 = div('rail-group');
  const draw = railBtn('draw', ICONS.brush, 'Draw tiles (D)', () => {viewport.setEraseTool(false);propsPanel.setMode('draw');}, 'D');
  const edit = railBtn('edit', ICONS.cursor, 'Edit selection (E / Tab)', () => propsPanel.setMode('edit'), 'E');
  const erase=railBtn('erase',ICONS.erase,'Erase faces (B) — left-drag; Shift+right-drag also erases',()=>{session.mode='draw';viewport.setEraseTool(true);refreshAll();},'B');
  g1.append(draw,erase,edit);

  const g2 = div('rail-group');
  for (const p of ['XY', 'XZ', 'YZ'] as Plane[]) {
    const b = railBtn(`plane-${p}`, ICONS.plane, `Plane ${p} (key ${({XY:'x',XZ:'z',YZ:'c'} as const)[p]})`, () => {
      viewport.setPlane(p, session.planeLocked);
      refreshAll();
    });
    b.dataset.plane = p;
    const t = b.querySelector('svg');
    if (t) t.style.transform = p === 'XY' ? 'rotate(90deg)' : p === 'YZ' ? 'rotateY(60deg)' : '';
    g2.append(b);
  }

  const g3 = div('rail-group');
  g3.append(
    railBtn('cam-persp', ICONS.camera, 'Perspective / Orthographic camera (P)', () => {
      viewport.setCameraKind(viewport.getCameraKind() === 'persp' ? 'ortho' : 'persp');
      refreshAll();
    }, 'P'),
  );
  const g4 = div('rail-group');
  g4.append(
    railBtn('act-frame', ICONS.target, 'Frame selection (F)', () => viewport.frameSelection(), 'F'),
    railBtn('act-grid', ICONS.grid, 'Reset grid/crosshair to origin (G)', () => {
      session.crosshair = [snap(0, session.grid), snap(0, session.grid), snap(0, session.grid)];
      viewport.rebuildGrid();
      refreshSessionUI();
    }, 'G'),
  );
  toolRail.prepend(g1);toolRail.append(g3,g4);
  // crosshair readout lives in the HUD
}

function railBtn(cls: string, icon: Glyph, title: string, onClick: () => void, kbdTag?: string): HTMLButtonElement {
  const b = iconButton(`rail-${cls}`, icon, title);
  b.classList.add('rail-btn');
  b.dataset.rail = cls;
  if (kbdTag) {
    const tag = h('span', { class: 'kbd-tag' }, kbdTag);
    b.append(tag);
  }
  b.addEventListener('click', onClick);
  return b;
}

function snap(v: number, grid: number): number { return Math.round(v / grid) * grid; }

/* ------------------------------------------------------------------ */
/* menubar                                                            */
/* ------------------------------------------------------------------ */

interface MenuDef { label: string; items: Array<{ label: string; sc?: string; action?: () => void; enabled?: () => boolean; sep?: boolean }> }

function buildMenus(): void {
  const defs: MenuDef[] = [
    {
      label: 'File',
      items: [
        { label: 'New (demo tileset)', sc: '', action: () => newDocument(true) },
        { label: 'New (empty)', action: () => newDocument(false) },
        { label: 'Sample Room…', action: () => loadSample() },
        { sep: true, label: '' },
        { label: 'Open .pvp…', sc: 'Ctrl+O', action: () => void openDocument() },
        { label: 'Save project', sc: 'Ctrl/Cmd+S', action: () => void saveDocument() },
        { label: 'Recovery…', action: () => void reviewRecovery() },
        { sep: true, label: '' },
        { label: 'Export…', action: showExportDialog },
        { sep: true, label: '' },
        { label: 'Import PNG atlas…', action: () => (atlasPage.querySelector('input[type=file]') as HTMLInputElement)?.click() },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', sc: 'Ctrl+Z', action: () => store.undo(), enabled: () => store.canUndo },
        { label: 'Redo', sc: 'Ctrl/Cmd+Shift+Z', action: () => store.redo(), enabled: () => store.canRedo },
        { sep: true, label: '' },
        { label: 'Duplicate', sc: 'Ctrl+D', action: () => opsDuplicate(), enabled: () => hasSel() },
        { label: 'Copy', sc: 'Ctrl+C', action: () => opsCopy(), enabled: () => hasSel() },
        { label: 'Paste', sc: 'Ctrl+V', action: () => opsPaste(), enabled: () => !!clipboard },
        { label: 'Delete', sc: 'Del', action: () => opsDelete(), enabled: () => hasSel() },
        { label: 'Reverse winding', sc: '', action: () => opsReverse(), enabled: () => hasSel() },
        { sep:true,label:'' },
        { label:'Apply Brush',action:()=>opsApplyBrush(),enabled:()=>canApplyBrush() },
      ],
    },
    {
      label: 'View',
      items: [
        {label:'Use system appearance',action:useSystemTheme},
        {label:'Toggle panels',action:()=>sideToggle.click()},
        {label:'Technical diagnostics',action:()=>app.classList.toggle('suite-diagnostics')},
        {label:'Light theme',action:()=>setTheme('light'),enabled:()=>currentTheme!=='light'},
        {label:'Dark theme',action:()=>setTheme('dark'),enabled:()=>currentTheme!=='dark'},
        {sep:true,label:''},
        { label: 'Perspective / Ortho camera', sc: 'P', action: () => { viewport.setCameraKind(viewport.getCameraKind() === 'persp' ? 'ortho' : 'persp'); refreshAll(); } },
        { label: 'Frame selection', sc: 'F', action: () => viewport.frameSelection() },
        { label: 'Frame scene', sc: 'Home', action: () => viewport.frameAll() },
        { sep: true, label: '' },
        { label: 'Plane XY', sc: 'X', action: () => { viewport.setPlane('XY', session.planeLocked); refreshAll(); } },
        { label: 'Plane XZ (ground)', sc: 'Z', action: () => { viewport.setPlane('XZ', session.planeLocked); refreshAll(); } },
        { label: 'Plane YZ', sc: 'C', action: () => { viewport.setPlane('YZ', session.planeLocked); refreshAll(); } },
        { label: 'Toggle plane lock', sc: 'L', action: () => { viewport.setPlane(session.plane, !session.planeLocked); refreshAll(); } },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Shortcuts & usage', sc: '?', action: () => showHelp() },
        { label: 'About PiVo Plate', action: () => showAbout() },
      ],
    },
  ];
  for (const def of defs) {
    const root = button('menu-root', def.label);
    root.dataset.input = '';root.setAttribute('aria-haspopup','true');root.setAttribute('aria-expanded','false');
    root.addEventListener('click', (e) => {
      e.stopPropagation();
      openMenu(def, root);
    });
    menubar.append(root);
  }
  window.addEventListener('pointerdown', () => closeMenus());
}

function openMenu(def: MenuDef, root: HTMLElement): void {
  const wasOpen = root.classList.contains('open');
  closeMenus();
  if (wasOpen) return;
  root.classList.add('open');root.setAttribute('aria-expanded','true');
  const popup = div('menu-popup');
  popup.addEventListener('pointerdown', e => e.stopPropagation());
  for (const item of def.items) {
    if (item.sep) { popup.append(div('menu-sep')); continue; }
    const enabled = item.enabled ? item.enabled() : true;
    const b = button('menu-item', '');
    b.append(svgIcon(menuGlyph(item.label),15),h('span',{class:'menu-label'},item.label));
    b.disabled = !enabled;
    if (item.sc) b.append(h('span', { class: 'sc' }, item.sc));
    b.addEventListener('click', () => {
      closeMenus();
      item.action?.();
    });
    popup.append(b);
  }
  document.body.append(popup);
  positionPopup(root,popup);
  activePopup = popup;
  popup.addEventListener('keydown',e=>{const items=[...popup.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeMenus();root.focus();}else if(['ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();const n=items.indexOf(document.activeElement as HTMLButtonElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(n+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}});
  popup.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
}
let activePopup: HTMLElement | null = null;
function closeMenus(): void {
  for (const r of menubar.querySelectorAll('.menu-root')) {r.classList.remove('open');r.setAttribute('aria-expanded','false');}
  activePopup?.remove();
  activePopup = null;
}

/* ------------------------------------------------------------------ */
/* side tabs + HUD                                                    */
/* ------------------------------------------------------------------ */

function buildSideTabs():void {
 const tabs:Array<[string,HTMLElement]>=[['Atlas',atlasPage],['Properties',propsPage]];
 sideTabs.classList.add('suite-tablist');sideTabs.setAttribute('role','tablist');sideTabs.setAttribute('aria-label','Context panels');
 const activate=(i:number)=>{tabs.forEach(([,page],n)=>{page.classList.toggle('active',n===i);const t=sideTabs.children[n] as HTMLElement;t.setAttribute('aria-selected',String(n===i));t.tabIndex=n===i?0:-1;});atlasPanel.refresh();};
 tabs.forEach(([label,page],i)=>{const t=button('side-tab',label);t.id='plate-panel-tab-'+i;t.setAttribute('role','tab');page.id='plate-panel-'+i;page.setAttribute('role','tabpanel');page.setAttribute('aria-labelledby',t.id);t.setAttribute('aria-controls',page.id);t.onclick=()=>activate(i);sideTabs.append(t);});
 tabKeys(sideTabs);activate(0);
 installDockToggle(sideToggle,sidebar);
}

function buildPlaneHud(): void {
  const hud = document.getElementById('plane-hud')!;
  hud.innerHTML = '';
  const chip = (label: string, id: string, clickable = false): HTMLElement => {
    const c = h(clickable ? 'button' : 'span', { class: 'chip' });
    c.append(h('span', { class: 'k' }, label), h('span', { class: 'v', id }, '—'));
    hud.append(c);
    return c;
  };
  chip('plane', 'hud-plane', true).addEventListener('click', () => {
    const order: Plane[] = ['XY', 'XZ', 'YZ'];
    const next = order[(order.indexOf(session.plane) + 1) % 3];
    viewport.setPlane(next, session.planeLocked);
    refreshAll();
  });
  chip('cross', 'hud-cross', true).addEventListener('click', () => {
    // cycle crosshair depth: snap to nearest integer multiple along normal
    const n = session.plane === 'XY' ? 2 : session.plane === 'XZ' ? 1 : 0;
    session.crosshair[n] = Math.round(session.crosshair[n] / session.grid) * session.grid + session.grid;
    viewport.rebuildGrid();
    viewport.syncBrushPreview();
    refreshSessionUI();
  });
  chip('lock', 'hud-lock', true).addEventListener('click', () => {
    viewport.setPlane(session.plane, !session.planeLocked);
    refreshAll();
  });
  chip('cam', 'hud-cam', true).addEventListener('click', () => {
    viewport.setCameraKind(viewport.getCameraKind() === 'persp' ? 'ortho' : 'persp');
    refreshAll();
  });

  const positionRow = h('div',{class:'crosshair-fields'});
  (['X','Y','Z'] as const).forEach((axis,i)=>{
    const field=h('input',{type:'number',step:'1','aria-label':`Crosshair ${axis}`,title:`Crosshair ${axis}`}) as HTMLInputElement;
    field.value='0'; field.id=`crosshair-${axis.toLowerCase()}`;
    field.addEventListener('change',()=>{ const value=Number(field.value); if(Number.isFinite(value)) {session.crosshair[i]=snap(value,session.grid);viewport.rebuildGrid();viewport.syncBrushPreview();refreshSessionUI();}});
    positionRow.append(h('label',null,axis,field));
  });
  hud.append(positionRow);
  const corners = document.getElementById('vp-corners')!;
  corners.innerHTML = '';
  corners.append(
    h('div', { class: 'chip', id: 'hud-undo' }, 'history —'),
    h('div', {class:'chip',id:'hud-fps',title:'Visible rendered frames measured over ~1 second; not a GPU benchmark'},'FPS measuring…'),
  );
  updateFrameHud(viewport.getFrameTelemetry());
}

function updateFrameHud(value:FrameTelemetry):void {
  const el=document.getElementById('hud-fps');if(!el)return;
  if(value.status==='measured'){el.textContent=`${value.sample.fps.toFixed(value.sample.fps<10?1:0)} FPS · ${value.sample.frameMs.toFixed(1)} ms`;el.title=`Measured ${value.sample.samples} rendered frame intervals over ${value.sample.windowMs.toFixed(0)} ms; includes CPU/RAF timing, not a hardware benchmark`;el.dataset.fps=String(value.sample.fps);}
  else{el.textContent=value.status==='paused'?'FPS paused':value.status==='unavailable'?'FPS unavailable':'FPS measuring…';delete el.dataset.fps;}
}

function wireStatusHelp(): void {
  helpBtn.addEventListener('click', () => showHelp());
}

/* ------------------------------------------------------------------ */
/* refresh                                                            */
/* ------------------------------------------------------------------ */

function setTheme(theme:Theme,persist=true):void {
  currentTheme=theme;applyRootTheme(theme);if(persist)persistTheme(theme,themeStorage());
  themeToggle.replaceChildren(svgIcon(theme==='dark'?ICONS.sun:ICONS.moon));
  const action=theme==='dark'?'Switch to light theme':'Switch to dark theme';
  themeToggle.title=action;themeToggle.setAttribute('aria-label',action);themeToggle.setAttribute('aria-pressed',String(theme==='light'));
  viewport?.setTheme(theme);atlasPanel?.refresh();
}

function refreshAll(): void {
  refreshSessionUI();
  viewport.syncAtlases(store.project);
  viewport.rebuildScene(store.project);
  viewport.syncSelection();
  viewport.syncTransformProxy();
  viewport.syncBrushPreview();
  atlasPanel.refresh();
  objectsPanel.refresh();
  propsPanel.refresh();
  refreshStatus();
}

function refreshSessionUI(): void {
  stModeV.textContent = session.mode;
  stPlaneV.replaceChildren(document.createTextNode(session.plane));
  if(session.planeLocked) stPlaneV.append(svgIcon(ICONS.lock,11));
  const selN = session.selection.tileIds.length + session.selection.vertices.length;
  stSelV.textContent = String(selN);
  // rail states
  for (const b of toolRail.querySelectorAll('[data-rail]')) {
    const el = b as HTMLButtonElement;
    const key = el.dataset.rail!;
    el.classList.toggle('active',(key==='erase'&&session.mode==='draw'&&viewport.getEraseTool())||(key==='draw'&&session.mode==='draw'&&!viewport.getEraseTool())||(key==='edit'&&session.mode==='edit')||key===`plane-${session.plane}`);
    if (key === 'cam-persp') el.classList.toggle('active-blue', viewport.getCameraKind() === 'ortho');
  }
  // HUD values
  const set = (id: string, v: string): void => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  set('hud-plane', session.plane);
  set('hud-cross', session.crosshair.map((c) => c.toFixed(2)).join(' '));
  (['x','y','z']).forEach((axis,i)=>{const f=document.getElementById(`crosshair-${axis}`) as HTMLInputElement|null;if(f&&document.activeElement!==f){f.value=String(session.crosshair[i]);f.step=String(session.grid);}});
  set('hud-lock', session.planeLocked ? 'LOCKED' : 'auto');
  set('hud-cam', viewport.getCameraKind());
  const hist = document.getElementById('hud-undo');
  if (hist) {
    hist.textContent = store.canUndo
      ? `history: ${store.historyLabel} · undo ${store.canUndo ? '✓' : '—'} redo ${store.canRedo ? '✓' : '—'}`
      : 'history: (clean)';
  }
}

function refreshStatus(): void {
  stTilesV.textContent = String(store.project.tiles.length);
  stModeV.textContent = session.mode;
  // undo/redo buttons
  (header.querySelector('.hdr-undo') as HTMLButtonElement).disabled = !store.canUndo;
  (header.querySelector('.hdr-redo') as HTMLButtonElement).disabled = !store.canRedo;
  // dirty
  const snapNow = JSON.stringify(store.project);
  const dirty = snapNow !== savedMarker || store.dirty;
  const dot = document.getElementById('dirty-dot');
  if (dot) dot.classList.toggle('clean', !dirty);
  const nameEl = document.getElementById('doc-name-text');
  if (nameEl) nameEl.textContent = `${currentFileName}${dirty ? ' •' : ''}`;
  saveState.textContent=(dirty?'Unsaved edits':cleanDocumentState)+' · '+(!recoveryAvailable?'Recovery unavailable':recoveryPending?'Recovery awaiting review':recoverySnapshot===snapNow?'Browser recovery stored':!recoverySnapshot&&!dirty?'No browser recovery':'Recovery pending');saveState.title=saveState.textContent??'';
  const info = viewport.getRendererInfo();
  if (rendererInfoEl && info) {
    rendererInfoEl.textContent = `${info.version} ${info.drawCalls}dc ${info.triangles}tri`;
  }
}

function hasSel(): boolean {
  return session.selection.tileIds.length > 0 || session.selection.vertices.length > 0;
}

function setStatusMsg(msg: string, error = false): void {
  stMsg.textContent = msg;
  stMsg.classList.toggle('error', error);
}

/* ------------------------------------------------------------------ */
/* selection ops                                                      */
/* ------------------------------------------------------------------ */

function selClone(): Selection {
  return {
    tileIds: [...session.selection.tileIds],
    vertices: session.selection.vertices.map((v) => ({ ...v })),
  };
}

function opsDuplicate(): void {
  try {
    const sel = selClone();
    let newIds: string[] = [];
    store.transact('Duplicate selection', (p) => {
      newIds = duplicateSelection(p, sel, [session.tileSize, 0, 0]);
    });
    session.selection = { tileIds: newIds, vertices: [] };
    toast(`Duplicated ${newIds.length} tile(s)`, 'success');
    refreshAll();
  } catch (err) { toastError(err, 'Duplicate'); }
}

function opsDelete(): void {
  try {
    const sel = selClone();
    store.transact('Delete selection', (p) => {
      deleteSelection(p, sel);
    });
    session.selection = { tileIds: [], vertices: [] };
    refreshAll();
  } catch (err) { toastError(err, 'Delete'); }
}

function opsReverse(): void {
  try {
    store.transact('Reverse winding', (p) => {
      reverseSelection(p, selClone());
    });
    refreshAll();
  } catch (err) { toastError(err, 'Reverse'); }
}

function opsCopy(): void {
  const sel = selClone();
  const tiles = store.project.tiles.filter((t) => sel.tileIds.includes(t.id));
  clipboard = {
    tiles: tiles.map((t) => ({
      vertices: t.vertices.map((v) => [...v] as [number, number, number]),
      uvs: t.uvs.map((u) => [...u] as [number, number]),
      reversed: t.reversed,
      atlasId: t.atlasId,
    })),
  };
  setStatusMsg(`Copied ${tiles.length} tile(s)`);
}

function opsPaste(): void {
  if (!clipboard) return;
  try {
    const c = session.crosshair;
    const atlasIds = new Set(store.project.atlases.map((a) => a.id));
    let count = 0;
    store.transact('Paste tiles', (p) => {
      const active = session.activeObjectId || p.objects[0]?.id || DEFAULT_OBJECT_ID;
      if (isObjectLocked(p, active)) throw new Error('Active object is locked');
      const points = clipboard!.tiles.flatMap(t => t.vertices);
      const cx = points.reduce((n,v)=>n+v[0],0)/points.length;
      const cy = points.reduce((n,v)=>n+v[1],0)/points.length;
      const cz = points.reduce((n,v)=>n+v[2],0)/points.length;
      for (const t of clipboard!.tiles) {
        if (!atlasIds.has(t.atlasId)) continue;
        // centroid offset so paste lands at crosshair
        // Shared clipboard center preserves spacing between copied tiles.
        p.tiles.push({
          id: `tile-${Math.random().toString(36).slice(2, 10)}`,
          objectId: active,
          atlasId: t.atlasId,
          vertices: t.vertices.map((v) => [v[0] - cx + c[0], v[1] - cy + c[1], v[2] - cz + c[2]]) as [import('./core/types').Vec3, import('./core/types').Vec3, import('./core/types').Vec3, import('./core/types').Vec3],
          uvs: t.uvs.map((u) => [...u] as [number, number]) as [import('./core/types').Vec2, import('./core/types').Vec2, import('./core/types').Vec2, import('./core/types').Vec2],
          reversed: t.reversed,
        });
        count++;
      }
    });
    setStatusMsg(`Pasted ${count} tile(s) at crosshair`);
    refreshAll();
  } catch (err) { toastError(err, 'Paste'); }
}

function canApplyBrush(): boolean {
  const ids=new Set(session.selection.tileIds);
  return !!store.project.atlases.find(a=>a.id===session.brush.atlasId)
    && store.project.tiles.some(t=>ids.has(t.id)&&!isObjectLocked(store.project,t.objectId));
}

function opsApplyBrush(): void {
  if(isModalOpen()||!canApplyBrush()) return;
  try {
    const count=store.project.tiles.filter(t=>session.selection.tileIds.includes(t.id)&&!isObjectLocked(store.project,t.objectId)).length;
    const brush=structuredClone(session.brush),selection=selClone();
    store.transact('Apply Brush',p=>applyBrush(p,selection,brush));
    toast(`Applied brush to ${count} selected face${count===1?'':'s'}`,'success');
    refreshAll();
  } catch(err) {toastError(err,'Apply Brush');}
}

/* ------------------------------------------------------------------ */
/* keyboard                                                           */
/* ------------------------------------------------------------------ */

function inEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function wireKeyboard(): void {
  window.addEventListener('pivo-plate-modal-open',()=>{ if(viewport.getRendererInfo()) viewport.cancelStroke(); });
  window.addEventListener('keydown', (e) => {
    if (isModalOpen()) return;
    if (inEditableTarget(e.target)) return; // never capture shortcuts in form controls
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); refreshAll(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo(); refreshAll(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void saveDocument(); return; }
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); void openDocument(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); opsDuplicate(); return; }
    if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); opsCopy(); return; }
    if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); opsPaste(); return; }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); session.selection = { tileIds: store.project.tiles.map((t) => t.id), vertices: [] }; refreshAll(); return; }
    if (e.key === 'Tab' && !(e.target instanceof HTMLElement && e.target.closest('button,summary,[role=tab],[role=treeitem]'))) { e.preventDefault(); propsPanel.setMode(session.mode === 'draw' ? 'edit' : 'draw'); return; }
    if (e.key === 'Escape') { viewport.cancelStroke(); return; }
    if(e.target instanceof HTMLElement && e.target.closest('button,summary,[role=tab],[role=treeitem]'))return;
    switch (e.key.toLowerCase()) {
      case 'd': viewport.setEraseTool(false);propsPanel.setMode('draw');return;
      case 'b': session.mode='draw';viewport.setEraseTool(true);refreshAll();return;
      case 'e': propsPanel.setMode('edit'); return;
      case 'p': viewport.setCameraKind(viewport.getCameraKind() === 'persp' ? 'ortho' : 'persp'); refreshAll(); return;
      case 'f': viewport.frameSelection(); return;
      case 'x': viewport.setPlane('XY', session.planeLocked); refreshAll(); return;
      case 'z': viewport.setPlane('XZ', session.planeLocked); refreshAll(); return;
      case 'c': viewport.setPlane('YZ', session.planeLocked); refreshAll(); return;
      case 'l': viewport.setPlane(session.plane, !session.planeLocked); refreshAll(); return;
      case 'g': session.crosshair = [0, 0, 0]; viewport.rebuildGrid(); viewport.syncBrushPreview(); refreshSessionUI(); return;
      case 'delete':
      case 'backspace': opsDelete(); return;
      case '?': showHelp(); return;
      case 'home': viewport.frameAll(); return;
      default: return;
    }
  });
}

/* ------------------------------------------------------------------ */
/* file ops                                                           */
/* ------------------------------------------------------------------ */

function guardDirty(next: () => void): void {
  const dirty = JSON.stringify(store.project) !== savedMarker || store.dirty;
  if (!dirty) { next(); return; }
  confirmModal(
    'Unsaved changes',
    'The current document has unsaved changes. Continue and lose them?',
    'Discard changes',
    next,
    { danger: true },
  );
}

async function newDocument(withDemoScene: boolean): Promise<void> {
  guardDirty(() => {
    try {
      const atlas = makeDemoAtlas();
      const p = createProject('Untitled');
      if (withDemoScene) p.atlases.push(atlas);
      store.replace(p);
      Object.assign(session, createSession(p));
      store.markSaved();
      session.brush.atlasId = p.atlases[0]?.id ?? '';
      session.brush.region = { x: atlas.margin, y: atlas.margin, width: atlas.tileWidth, height: atlas.tileHeight };
      currentFileName = 'scene.pvp';
      savedMarker = JSON.stringify(store.project);cleanDocumentState='New project';
      viewport.frameAll();
      refreshAll();
      setStatusMsg(withDemoScene ? 'New document with demo tileset' : 'New empty document');
    } catch (err) { toastError(err, 'New document'); }
  });
}

async function loadSample(): Promise<void> {
  guardDirty(() => {
    const atlas = makeDemoAtlas();
    const p = buildSampleScene(atlas);
    store.replace(p);
    Object.assign(session, createSession(p));
    store.markSaved();
    session.brush.atlasId = atlas.id;
    currentFileName = 'sample-room.pvp';cleanDocumentState='Sample document';
    savedMarker = JSON.stringify(store.project);
    viewport.frameAll();
    refreshAll();
    setStatusMsg('Loaded sample room');
  });
}

function fileInput(): HTMLInputElement {
  let el = document.getElementById('file-input') as HTMLInputElement | null;
  if (!el) {
    el = h('input', { type: 'file', accept: '.pvp', style: 'display:none' }) as HTMLInputElement;
    el.id = 'file-input';
    document.body.append(el);
    el.addEventListener('change', () => {
      const f = el!.files?.[0];
      el!.value = '';
      if (f) void readProjectFile(f);
    });
  }
  return el;
}

async function openDocument(): Promise<void> {
  fileInput().click();
}

async function readProjectFile(f: File): Promise<void> {
  try {
    if(f.size>ARCHIVE_LIMITS.maxCompressed)throw new Error('Project file exceeds compressed input budget');
    const buf = new Uint8Array(await f.arrayBuffer());
    const p = await decodeProject(buf); // throws readable errors
    for (const atlas of p.atlases) {
      const image = await decodeImage(atlas.dataUrl);
      if (image.naturalWidth !== atlas.width || image.naturalHeight !== atlas.height) throw new Error(`Texture dimensions do not match metadata for ${atlas.name}`);
    }
    guardDirty(() => {
      store.replace(p);
      Object.assign(session, createSession(p));
      store.markSaved();
      session.brush.atlasId = p.atlases[0]?.id ?? '';
      currentFileName = f.name.endsWith('.pvp') ? f.name : `${f.name}.pvp`;
      savedMarker = JSON.stringify(store.project);cleanDocumentState='Project opened';
      viewport.frameAll();
      refreshAll();
      toast(`Opened ${f.name}`, 'success');
    });
  } catch (err) {
    confirmModal('Could not open file', `${f.name}: ${err instanceof Error ? err.message : String(err)}`, 'OK', () => {});
  }
}

async function saveDocument(): Promise<void> {
  try {
    const snapshot = validateProject(store.project);
    const bytes = await encodeProject(snapshot);
    downloadBytes(bytes, currentFileName, 'application/octet-stream');
    savedMarker = JSON.stringify(snapshot);cleanDocumentState='Project downloaded';
    if (JSON.stringify(store.project) === savedMarker) store.markSaved();
    if(recoveryAvailable && !recoveryPending) queueRecoveryWrite(snapshot);
    refreshAll();
    setStatusMsg(`Saved ${currentFileName}`);
    toast(`Saved ${currentFileName}`, 'success');
  } catch (err) {
    toastError(err, 'Save');
  }
}

function showExportDialog():void {
 const overlay=div('modal-overlay suite-export-overlay'),box=div('modal-box suite-export-dialog');
 const format=h('select',{'aria-label':'Export format'},h('option',{value:'glb'},'GLB — binary glTF'),h('option',{value:'obj'},'OBJ + MTL + textures — ZIP'));
 const description=h('p',{class:'modal-body'});
 const update=()=>{description.textContent=format.value==='glb'?'Export the scene geometry and embedded textures as one GLB file. Editing history, construction settings and browser recovery are excluded.':'Export geometry, material definitions and texture images in a ZIP. Unpack the files together before importing. Editing history and construction settings are excluded.';};format.onchange=update;update();
 box.append(h('header',null,h('h3',{class:'modal-title'},'Export artwork')),div('suite-export-body',h('label',{class:'suite-export-format'},'Format',format),description));
 const footer=div('modal-actions suite-dialog-footer'),cancel=button('btn','Cancel'),run=button('btn btn-primary','Export');footer.append(cancel,run);box.append(footer);overlay.append(box);
 const close=mountModal(overlay,box,format);cancel.onclick=close;run.onclick=()=>{const kind=format.value as 'glb'|'obj';close();void exportModel(kind);};
}
async function reviewRecovery():Promise<void> {
 if(recoveryPending){recoverBanner.scrollIntoView();recoverBanner.querySelector<HTMLButtonElement>('button')?.focus();return;}
 try{await recoveryWriteQueue;const record=await inspectAutosave();if(record.status==='empty'){toast('No browser recovery copy is stored. Save project downloads an editable .pvp backup.','info');return;}showRecoverBanner(record);refreshStatus();recoverBanner.querySelector<HTMLButtonElement>('button')?.focus();}catch(err){recoveryAvailable=false;refreshStatus();toastError(err,'Recovery');}
}

async function exportModel(kind: 'glb' | 'obj'): Promise<void> {
  try {
    const bytes = kind === 'glb' ? await exportGLB(store.project) : await exportOBJ(store.project);
    const base = currentFileName.replace(/\.pvp$/, '');
    downloadBytes(bytes, `${base}.${kind === 'glb' ? 'glb' : 'zip'}`, 'application/octet-stream');
    toast(`Exported ${base}.${kind === 'glb' ? 'glb' : 'zip'}`, 'success');
  } catch (err) {
    confirmModal(`${kind.toUpperCase()} export failed`, err instanceof Error ? err.message : String(err), 'OK', () => {});
  }
}

/* ------------------------------------------------------------------ */
/* drag & drop atlas                                                  */
/* ------------------------------------------------------------------ */

function wireDragDrop(): void {
  const host = vpHost;
  let depth = 0;
  host.addEventListener('dragenter', (e) => {
    e.preventDefault();
    depth++;
    document.getElementById('drop-hint')?.classList.add('show');
  });
  host.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) document.getElementById('drop-hint')?.classList.remove('show');
  });
  host.addEventListener('dragover', (e) => e.preventDefault());
  host.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    document.getElementById('drop-hint')?.classList.remove('show');
    const f = e.dataTransfer?.files?.[0];
    if (f && f.type.startsWith('image/')) void atlasPanel.importFile(f);
    else if (f) toast(`"${f.name}" is not an image atlas`, 'error');
  });
}

/* ------------------------------------------------------------------ */
/* autosave / recovery / unload                                       */
/* ------------------------------------------------------------------ */

function cancelAutosaveTimer(): void {
  if(autosaveTimer!==null) window.clearTimeout(autosaveTimer);
  autosaveTimer=null;
}

function queueRecoveryWrite(snapshot:Project): void {
  if(!recoveryAvailable || !recoveryCheckComplete || recoveryPending) return;
  // Serialize writes so a slower old request cannot overwrite a newer snapshot.
  const safe=validateProject(snapshot);
  recoveryWriteQueue=recoveryWriteQueue.catch(()=>{}).then(async()=>{
    if(!recoveryPending) {await saveAutosave(safe);recoverySnapshot=JSON.stringify(safe);refreshStatus();}
  }).catch(err=>{recoveryAvailable=false;refreshStatus();toastError(err,'Autosave');});
}

function scheduleAutosave(): void {
  if(store.revision===lastAutosaveRevision) return;
  lastAutosaveRevision=store.revision;
  autosaveDirty=true;
  cancelAutosaveTimer();
  if(!recoveryAvailable || !recoveryCheckComplete || recoveryPending) return;
  autosaveTimer=window.setTimeout(()=>{
    autosaveTimer=null;
    if(!autosaveDirty || recoveryPending) return;
    autosaveDirty=false;
    queueRecoveryWrite(store.project);
  },AUTOSAVE_DEBOUNCE_MS);
}

function showRecoverBanner(record:Awaited<ReturnType<typeof inspectAutosave>>): void {
  if(record.status==='empty') return;
  if(recoveryPending)return;
  recoveryPending=true;
  cancelAutosaveTimer();
  recoverBanner.classList.add('show');
  const buttons=recoverBanner.querySelectorAll('button');
  const restore=buttons[0],discard=buttons[1];
  const backup=button('btn','Download recovery backup');
  recoverBanner.append(backup);
  const label=recoverBanner.querySelector('.inline-icon')!;
  label.replaceChildren(svgIcon(ICONS.warning), document.createTextNode(record.status==='invalid'
    ? 'Recovery snapshot cannot be opened. Download a backup before discarding.'
    : 'Autosaved session found. Resolve recovery before autosave resumes.'));
  restore.disabled=record.status!=='valid';
  backup.onclick=()=>{
    const raw=record.raw??'';
    downloadBytes(new TextEncoder().encode(raw),'pivo-plate-recovery-backup.json','application/json');
  };
  let busy=false;
  let resolving=false;
  const resolved=():void=>{
    recoveryPending=false;refreshStatus();
    recoverBanner.classList.remove('show');
    backup.remove();
    if(store.dirty || JSON.stringify(store.project)!==savedMarker) {
      lastAutosaveRevision=-1;
      scheduleAutosave();
    } else {
      autosaveDirty=false;
      lastAutosaveRevision=store.revision;
      cancelAutosaveTimer();
    }
  };
  restore.onclick=()=>{
    if(busy || record.status!=='valid') return;
    busy=true; restore.disabled=true;
    void (async()=>{
      const p=validateProject(record.project);
      for(const atlas of p.atlases) {
        const image=await decodeImage(atlas.dataUrl);
        if(image.naturalWidth!==atlas.width||image.naturalHeight!==atlas.height) throw new Error(`Recovery texture dimensions do not match ${atlas.name}`);
      }
      // Check fresh work AFTER asynchronous decode, not at click time.
      guardDirty(()=>{
        try {
          store.replace(p);
          Object.assign(session,createSession(p));
          savedMarker='';
          currentFileName='recovered.pvp';
          resolving=true;
          viewport.frameAll(); refreshAll();
          recoveryWriteQueue=recoveryWriteQueue.catch(()=>{}).then(()=>resolveRecovery(record.raw,false)).then(()=>{
            resolved(); toast('Recovered autosaved document','success');
          }).catch(err=>toastError(err,'Recovery resolution')).finally(()=>{
            resolving=false;busy=false;restore.disabled=false;
          });
        } catch(err) {toastError(err,'Recovery');}
      });
    })().catch(err=>toastError(err,'Recovery')).finally(()=>{if(!resolving){busy=false;restore.disabled=false;}});
  };
  discard.onclick=()=>{
    if(busy) return;
    confirmModal('Discard recovery snapshot?',
      'This permanently removes the stored recovery copy. Download its backup first if you might need it. Current editing work is kept.',
      'Discard recovery',()=>{
        busy=true; discard.disabled=true;
        recoveryWriteQueue=recoveryWriteQueue.catch(()=>{}).then(()=>resolveRecovery(record.raw,true)).then(()=>{
          resolved(); setStatusMsg('Recovery discarded; autosave resumed');
        }).catch(err=>toastError(err,'Recovery discard')).finally(()=>{busy=false;discard.disabled=false;});
      },{danger:true});
  };
}

function wireAutosaveLifecycle(): void {
  window.addEventListener('beforeunload', (e) => {
    if (JSON.stringify(store.project) !== savedMarker || store.dirty) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
    return undefined;
  });
}

/* ------------------------------------------------------------------ */
/* help                                                               */
/* ------------------------------------------------------------------ */

function showFirstRunHelp(): void {
  try {
    if (window.localStorage.getItem('pivo-plate-seen-help')) return;
    window.localStorage.setItem('pivo-plate-seen-help', '1');
  } catch { /* Embedded previews may restrict storage. */ }
  toast('Start with a tile in the Atlas panel. Use middle-drag to orbit; Shortcuts explains every control.', 'success');
}

function showHelp(): void {
  const body = h('div', { class: 'modal-body' });
  body.innerHTML = `
  <div class="help-sec">Viewport</div>
  <table class="help-table">
    <tr><td>MMB drag</td><td>Orbit (also rotate camera around target)</td></tr>
    <tr><td>RMB drag</td><td>Pan</td></tr>
    <tr><td>Wheel</td><td>Zoom</td></tr>
    <tr><td><kbd>P</kbd></td><td>Perspective ↔ Orthographic camera</td></tr>
    <tr><td><kbd>F</kbd> / <kbd>Home</kbd></td><td>Frame selection / whole scene</td></tr>
    <tr><td><kbd>X</kbd> <kbd>Z</kbd> <kbd>C</kbd></td><td>Construction plane XY / XZ / YZ</td></tr>
    <tr><td><kbd>L</kbd></td><td>Lock plane (stops automatic camera plane)</td></tr>
  </table>
  <div class="help-sec">Draw mode</div>
  <table class="help-table">
    <tr><td>LMB drag</td><td>Stamp tiles along the stroke on the construction plane (one transaction)</td></tr>
    <tr><td>RMB click</td><td>Erase one face; RMB drag still pans</td></tr>
    <tr><td><kbd>B</kbd> + LMB drag / Shift+RMB drag</td><td>Erase stroke; release commits one undo step, Esc cancels</td></tr>
    <tr><td><kbd>D</kbd></td><td>Return to tile drawing</td></tr>
    <tr><td>Crosshair chip</td><td>Click to step the plane depth; grid snaps to it</td></tr>
  </table>
  <div class="help-sec">Edit mode</div>
  <table class="help-table">
    <tr><td>LMB click</td><td>Select tile (face mode) or corner (vertex mode)</td></tr>
    <tr><td>Shift+click / drag box</td><td>Additive / box selection</td></tr>
    <tr><td>Gizmo</td><td>Move / rotate / scale (commits around the crosshair pivot)</td></tr>
    <tr><td><kbd>Del</kbd></td><td>Delete selection</td></tr>
    <tr><td><kbd>Ctrl+D</kbd> / <kbd>Ctrl+C</kbd> / <kbd>Ctrl+V</kbd></td><td>Duplicate / copy / paste at crosshair</td></tr>
  </table>
  <div class="help-sec">Document</div>
  <table class="help-table">
    <tr><td><kbd>Ctrl+S</kbd></td><td>Download .pvp project (also keeps browser recovery)</td></tr>
    <tr><td><kbd>Ctrl+O</kbd></td><td>Open a .pvp file</td></tr>
    <tr><td><kbd>Ctrl/Cmd+Z</kbd> / <kbd>Ctrl/Cmd+Shift+Z</kbd> (Ctrl/Cmd+Y also works)</td><td>Undo / redo</td></tr>
    <tr><td><kbd>Tab</kbd></td><td>Toggle draw / edit mode</td></tr>
  </table>
  <p class="hint"><b>Atlas:</b> pick a cell or drag a rectangular region; real pixel region drives the brush UVs. Import your own PNG from the Atlas tab or drop it on the viewport.</p>
  <p class="hint"><b>Everything runs locally.</b> Documents are saved in your browser (IndexedDB); downloads go straight to disk. No network calls.</p>`;
  const overlay = div('modal-overlay');
  const box = div('modal-box');
  const actions = div('modal-actions');
  const gotIt = button('btn btn-primary', 'Got it');
  let closeHelp: () => void;
  actions.append(gotIt);
  box.append(h('h3', { class: 'modal-title' }, 'PiVo Plate — shortcuts & usage'));
  box.append(body);
  box.append(actions);
  overlay.append(box);
  closeHelp = mountModal(overlay,box,gotIt);
  gotIt.addEventListener('click',()=>closeHelp());
}

function showAbout(): void {
  showAboutModal();
}

/* ------------------------------------------------------------------ */
/* diagnostics — window.__pivoPlateTest                               */
/* ------------------------------------------------------------------ */

interface StrokeDiagnostic {eraseIds:Set<string>}
function installTestHooks(): void {
  const api = {
    /** Read-only project clone (validated). */
    getProject: (): Project => validateProject(store.project),
    getRevision: (): number => store.revision,
    isDirty: (): boolean => JSON.stringify(store.project) !== savedMarker || store.dirty,
    canUndo: (): boolean => store.canUndo,
    canRedo: (): boolean => store.canRedo,
    /** Direct store reference for orchestrator tests (use transact for mutations). */
    store: store as EditorStore,
    getSession: (): EditorSession => session,
    setMode: (m: Mode): void => propsPanel.setMode(m),
    setPlane: (p: Plane, lock = false): void => { viewport.setPlane(p, lock); refreshAll(); },
    setBrush: (atlasIndex: number, col: number, row: number, cols = 1, rows = 1): boolean => {
      const a = store.project.atlases[atlasIndex];
      if (!a) return false;
      session.brush.atlasId = a.id;
      const stepX = a.tileWidth + a.spacing, stepY = a.tileHeight + a.spacing;
      session.brush.region = {
        x: a.margin + col * stepX, y: a.margin + row * stepY,
        width: cols * a.tileWidth + (cols - 1) * a.spacing,
        height: rows * a.tileHeight + (rows - 1) * a.spacing,
      };
      atlasPanel.refresh();
      return true;
    },
    /** Import an atlas programmatically (data URL), validating decode first. */
    importAtlas: async (dataUrl: string, name = 'Imported', tileW = 16, tileH = 16): Promise<boolean> => {
      try {
        const img = await decodeImage(dataUrl);
        const atlas: Atlas = {
          id: `atlas-${Math.random().toString(36).slice(2, 8)}`, name,
          width: img.naturalWidth, height: img.naturalHeight,
          tileWidth: tileW, tileHeight: tileH, margin: 0, spacing: 0, dataUrl,
        };
        store.transact(`Import atlas ${name}`, (p) => { p.atlases.push(atlas); });
        session.brush.atlasId = atlas.id;
        refreshAll();
        return true;
      } catch (err) { toastError(err, 'Test import'); return false; }
    },
    getRendererInfo: () => viewport.getRendererInfo(),
    getTheme:()=>currentTheme,
    getViewportBackground:()=>viewport.getBackgroundColor(),
    getFrameTelemetry:()=>viewport.getFrameTelemetry(),
    setEraseTool:(on:boolean)=>{session.mode='draw';viewport.setEraseTool(on);refreshAll();},
    erasePendingCount:()=>((viewport as unknown as {stroke:StrokeDiagnostic|null}).stroke?.eraseIds.size??0),
    getAtlasView:()=>atlasPanel.getViewState(),
    getCameraState:()=>{const v=viewport as unknown as {activeCamera():THREE.Camera;orbit:{target:THREE.Vector3}};return {position:v.activeCamera().position.toArray(),target:v.orbit.target.toArray()};},
    getTileNormals:(id:string)=>{const v=viewport as unknown as {batches:Map<string,{mesh:THREE.Mesh;triTileIds:string[]}>};for(const batch of v.batches.values()){const triangle=batch.triTileIds.indexOf(id);if(triangle<0)continue;const attribute=batch.mesh.geometry.getAttribute('normal');const corner=triangle/2*4;return [0,1,2,3].map(i=>[attribute.getX(corner+i),attribute.getY(corner+i),attribute.getZ(corner+i)]);}return null;},
    getCameraKind: () => viewport.getCameraKind(),
    setCameraKind: (k: 'persp' | 'ortho') => { viewport.setCameraKind(k); refreshAll(); },
    tileCount: (): number => store.project.tiles.length,
    /** Screen-space center of a tile's vertices (for pixel picking tests). */
    tileScreenPos: (tileId: string): { x: number; y: number } | null => {
      const t = store.project.tiles.find((x) => x.id === tileId);
      if (!t || !vpHost.clientWidth) return null;
      const v = t.vertices.reduce((a,v)=>[a[0]+v[0]/4,a[1]+v[1]/4,a[2]+v[2]/4],[0,0,0]);
      const cam = (viewport as unknown as { activeCamera(): THREE.Camera }).activeCamera();
      const p = new THREE.Vector3(v[0], v[1], v[2]).project(cam);
      const rect = vpHost.querySelector('canvas')!.getBoundingClientRect();
      return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
    },
    projectPoint: (v: [number,number,number]) => {
      const cam=(viewport as unknown as {activeCamera():THREE.Camera}).activeCamera();
      const p=new THREE.Vector3(...v).project(cam);
      const rect=vpHost.querySelector('canvas')!.getBoundingClientRect();
      return {x:rect.left+(p.x+1)/2*rect.width,y:rect.top+(1-p.y)/2*rect.height};
    },
    getTransformState: () => {const v=viewport as unknown as {dragTransform:unknown;proxy:THREE.Object3D;transform:TransformControls|null};return {dragging:v.transform?.dragging,pending:!!v.dragTransform,position:v.proxy.position.toArray(),axis:v.transform?.axis};},
    gizmoPoint: (axis:string) => {
      const tc=(viewport as unknown as {transform:TransformControls|null}).transform;
      if(!tc) return null;
      const picker=(tc as unknown as {_gizmo:{picker:Record<string,THREE.Object3D>}})._gizmo.picker[tc.mode];
      picker.updateMatrixWorld(true);
      const mesh=picker.children.find(o=>o.name===axis) as THREE.Mesh|undefined;
      if(!mesh) return null;
      mesh.geometry.computeBoundingBox();
      const center=mesh.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
      const cam=(viewport as unknown as {activeCamera():THREE.Camera}).activeCamera();
      center.project(cam);
      const rect=vpHost.querySelector('canvas')!.getBoundingClientRect();
      return {x:rect.left+(center.x+1)/2*rect.width,y:rect.top+(1-center.y)/2*rect.height};
    },
    setVertexMode: (on:boolean)=>viewport.setVertexMode(on),
    frameAll: () => viewport.frameAll(),
    getSelection: (): Selection => ({ tileIds: [...session.selection.tileIds], vertices: session.selection.vertices.map((v) => ({ ...v })) }),
    newDocument: (demo: boolean) => newDocument(demo),
    openDemoAtlasDataUrl: (): string => store.project.atlases[0]?.dataUrl ?? '',
    stats: (): { atlases: number; objects: number; tiles: number } => ({
      atlases: store.project.atlases.length, objects: store.project.objects.length, tiles: store.project.tiles.length,
    }),
  };
  Object.defineProperty(window, '__pivoPlateTest', { value: Object.freeze(api), writable: false, configurable: false });
}

/* ------------------------------------------------------------------ */

void boot();
