/**
 * PiVo Plate viewport — renderer, cameras, controls, batched tile
 * geometry with picking maps, draw/erase strokes and edit-mode transforms.
 * All project mutations go through the EditorStore via ctx.transact.
 */
import * as THREE from 'three';
import { tileCornerNormals } from '../core/geometry';
import { VIEWPORT_PALETTES, type Theme } from './theme';
import { FrameMeter, type FrameSample } from './frameMeter';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { Atlas, AtlasRegion, Brush, EditorSession, Plane, Project, Selection, Tile, Vec2, Vec3 } from '../core/types';
import {
  brushUVs, makeTile, planePoint, rotateSelection, scaleSelection, translateSelection,
  isObjectVisible, isObjectLocked, tileCorners,
} from '../core/editor';

export type CameraKind = 'persp' | 'ortho';
export type FrameTelemetry = {status:'measured';sample:FrameSample}|{status:'warming'|'paused'|'unavailable';sample:null};

export interface ViewportContext {
  store: import('../core/editor').EditorStore;
  session: EditorSession;
  onStatus: (msg: string) => void;
  onTransient: (msg: string) => void;
  onTransformReadout: (text: string) => void;
  onError: (err: unknown, context: string) => void;
  onTelemetry?: (telemetry:FrameTelemetry) => void;
  onSessionDirty: () => void; // viewport changed session state (crosshair/plane/selection)
}

const AXIS_VEC: Record<Plane, THREE.Vector3> = {
  XY: new THREE.Vector3(0, 0, 1),
  XZ: new THREE.Vector3(0, 1, 0),
  YZ: new THREE.Vector3(1, 0, 0),
};

const COL_TILE_SEL = 0xb6f04a; // acid lime
const COL_TILE_HOVER = 0x4aa8f0; // signal blue
const COL_CORNER_SEL = 0xb6f04a;
const COL_CORNER_IDLE = 0xe8edf2;

interface BatchInfo {
  mesh: THREE.Mesh;
  triTileIds: string[]; // tileId per triangle
}

interface StrokeState {
  stamped: Vec3[]; // origins already stamped this stroke
  previewMeshes: THREE.Mesh[];
  lastOrigin: Vec3 | null;
  eraseIds: Set<string>;
  kind: 'draw' | 'erase';
  lastScreen:{x:number;y:number}|null;
}

export class Viewport {
  private host: HTMLElement;
  private ctx: ViewportContext;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private perspCam: THREE.PerspectiveCamera;
  private orthoCam: THREE.OrthographicCamera;
  private camKind: CameraKind = 'persp';
  private orbit: OrbitControls;
  private transform: TransformControls | null = null;
  private transformHelper: THREE.Object3D | null = null;
  private proxy: THREE.Object3D;

  private batchRoot = new THREE.Group();
  private overlay = new THREE.Group();
  private gridObj: THREE.Object3D | null = null;
  private brushMesh: THREE.Mesh | null = null;
  private tileHighlight: THREE.LineSegments;
  private cornerPts: THREE.Points;
  private hoverHighlight: THREE.LineSegments;

  private batches = new Map<string, BatchInfo>();
  private textures = new Map<string, { tex: THREE.Texture; url: string }>();
  private atlasById = new Map<string, Atlas>();

  private raycaster = new THREE.Raycaster();
  private pointerNDC = new THREE.Vector2();

  private stroke: StrokeState | null = null;
  private boxSelect: { x0: number; y0: number; el: HTMLDivElement } | null = null;
  private boxAdditive = false;
  private hoveredTile: string | null = null;

  private dragTransform: {
    startPos: THREE.Vector3; startQuat: THREE.Quaternion; startScale: THREE.Vector3; label: string;
  } | null = null;
  private downPos: { x: number; y: number; button: number } | null = null;

  private tool: 'select'|'translate'|'rotate'|'scale' = 'select';
  private eraseTool=false;
  private palette:{background:number;grid:number;axis:number;hover:number;selection:number;cornerIdle:number}={...VIEWPORT_PALETTES.dark};
  private contextLost=false;
  private unsubscribeStore:(()=>void)|null=null;
  private readonly frameMeter=new FrameMeter();
  private telemetry:FrameTelemetry={status:'warming',sample:null};
  private readonly blurChange=()=>this.cancelStroke();
  private readonly visibilityChange=()=>{if(document.hidden)this.cancelStroke();this.frameMeter.reset();this.emitTelemetry({status:!this.renderer||this.contextLost?'unavailable':document.hidden?'paused':'warming',sample:null});};
  private disposed = false;
  private frameRequested = false;

  constructor(host: HTMLElement, ctx: ViewportContext) {
    this.host = host;
    this.ctx = ctx;

    // Renderer — may fail; host shows feedback via onError.
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.setClearColor(0x101418, 1);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    } catch (err) {
      this.renderer = null;
      this.emitTelemetry({status:'unavailable',sample:null});
      this.reportGLError(err);
      // Non-rendering fallback so UI still constructs.
      this.perspCam = new THREE.PerspectiveCamera();
      this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1);
      this.orbit = null as unknown as OrbitControls;
      this.proxy = new THREE.Object3D();
      this.tileHighlight = this.makeHighlightObj();
      this.cornerPts = this.makeCornerObj();
      this.hoverHighlight = this.makeHighlightObj();
      return;
    }
    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    el.tabIndex = 0;
    host.appendChild(el);
    el.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost=true;this.frameMeter.reset();this.emitTelemetry({status:'unavailable',sample:null});
      this.cancelStroke();this.reportGLError(new Error('WebGL context lost. Keep a project backup; the viewport will resume when graphics recover.'));
    });

    el.addEventListener('webglcontextrestored',()=>{this.contextLost=false;document.getElementById('gl-error')?.classList.remove('show');this.rebuildScene(this.ctx.store.project);this.rebuildGrid();this.resize();this.frameMeter.reset();this.requestFrame();});

    this.scene.background = new THREE.Color(0x101418);
    this.scene.add(this.batchRoot);
    this.overlay.renderOrder = 5;
    this.scene.add(this.overlay);

    const w = Math.max(host.clientWidth, 2), hh = Math.max(host.clientHeight, 2);
    this.perspCam = new THREE.PerspectiveCamera(50, w / hh, 0.05, 600);
    this.perspCam.position.set(9, 9, 9);
    this.orthoCam = new THREE.OrthographicCamera(-10, 10, 10, -10, -200, 400);
    this.orthoCam.position.set(9, 9, 9);
    this.orthoCam.lookAt(0, 0, 0);

    this.orbit = new OrbitControls(this.perspCam, el);
    this.orbit.target.set(0, 0, 0);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.screenSpacePanning = true;
    this.orbit.minDistance = 0.5;
    this.orbit.maxDistance = 300;
    // Modeling defaults: LMB = editor action, MMB orbit, RMB pan, wheel zoom.
    this.orbit.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    } as OrbitControls['mouseButtons'];

    this.proxy = new THREE.Object3D();
    this.scene.add(this.proxy);

    this.tileHighlight = this.makeHighlightObj();
    this.hoverHighlight = this.makeHighlightObj();
    this.cornerPts = this.makeCornerObj();
    this.overlay.add(this.tileHighlight, this.hoverHighlight, this.cornerPts);

    // Lights for subtle shading of Lambert batch material.
    this.scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x30363e, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 0.7);
    sun.position.set(6, 12, 4);
    this.scene.add(sun);

    this.setupTransformControls();
    this.bindPointer(el);
    this.orbit.addEventListener('change', () => {
      this.autoPlaneHysteresis();
      this.syncBrushPreview();
      this.requestFrame();
    });

    this.resize();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(host);
    this.ro = ro;
    document.addEventListener('visibilitychange',this.visibilityChange);
    window.addEventListener('blur',this.blurChange);
    let seenRevision=ctx.store.revision;
    this.unsubscribeStore=ctx.store.subscribe(()=>{if(ctx.store.revision===seenRevision)return;seenRevision=ctx.store.revision;if(this.stroke)this.cancelStroke();});
    this.startLoop();
  }

  get isBusy():boolean { return this.stroke!==null || this.contextLost; }

  private ro: ResizeObserver | null = null;

  /* ------------------------------------------------------------ setup */

  private reportGLError(err: unknown): void {
    const box = document.getElementById('gl-error');
    if (box) box.classList.add('show');
    this.ctx.onError(err, 'WebGL');
  }

  private makeHighlightObj(): THREE.LineSegments {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
    const m = new THREE.LineBasicMaterial({ color: COL_TILE_SEL, transparent: true, opacity: 0.95, depthTest: false });
    const l = new THREE.LineSegments(g, m);
    l.renderOrder = 10;
    l.visible = false;
    l.frustumCulled = false;
    return l;
  }

  private makeCornerObj(): THREE.Points {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 3), 3));
    const m = new THREE.PointsMaterial({
      color: COL_CORNER_SEL, size: 9, sizeAttenuation: false, depthTest: false,
      visible: true,
    });
    const p = new THREE.Points(g, m);
    p.renderOrder = 11;
    p.visible = false;
    p.frustumCulled = false;
    return p;
  }

  private setupTransformControls(): void {
    try {
      const tc = new TransformControls(this.perspCam, this.renderer!.domElement);
      tc.setTranslationSnap(this.ctx.session.grid);
      tc.setRotationSnap(THREE.MathUtils.degToRad(15));
      tc.setScaleSnap(0.25);
      tc.addEventListener('dragging-changed', (e) => {
        const dragging = (e as unknown as { value: boolean }).value;
        this.orbit.enabled = !dragging;
        if (dragging) this.beginTransformDrag();
        else this.commitTransformDrag();
        this.requestFrame();
      });
      tc.addEventListener('objectChange', () => {
        if (this.dragTransform) { this.updateTransformReadout(); this.renderTransformPreview(); }
      });
      this.transform = tc;
      this.transformHelper = tc.getHelper();
      this.transformHelper.visible = false;
      this.scene.add(this.transformHelper);
      this.transformHelper.traverse((o) => { o.renderOrder = 20; });
    } catch (err) {
      this.ctx.onError(err, 'TransformControls');
      this.transform = null;
    }
  }

  private bindPointer(el: HTMLElement): void {
    // Capture before OrbitControls so Shift+RMB erase never becomes a camera pan.
    el.addEventListener('pointerdown',e=>{if(e.button===2&&e.shiftKey&&this.ctx.session.mode==='draw'){e.preventDefault();e.stopImmediatePropagation();this.onPointerDown(e);}},true);
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    el.addEventListener('pointermove', (e) => this.onPointerMove(e));
    el.addEventListener('pointerup', (e) => this.onPointerUp(e));
    el.addEventListener('pointercancel', (e) => this.onPointerCancel(e));
    el.addEventListener('pointerleave', () => {
      if (this.hoveredTile) {
        this.hoveredTile = null;
        this.hoverHighlight.visible = false;
        this.requestFrame();
      }
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /* ---------------------------------------------------- render loop */

  private startLoop(): void {
    const tick = (timestamp:number): void => {
      if (this.disposed) return;
      requestAnimationFrame(tick);
      if(!this.renderer||this.contextLost||document.hidden)return;
      if (this.orbit) this.orbit.update();
      const cam = this.activeCamera();
      if (this.transform) this.transform.camera = cam;
      this.renderer.render(this.scene, cam);
      const sample=this.frameMeter.frame(timestamp);if(sample)this.emitTelemetry({status:'measured',sample});
      this.frameRequested = false;
    };
    requestAnimationFrame(tick);
  }

  private emitTelemetry(value:FrameTelemetry):void {this.telemetry=value;this.ctx.onTelemetry?.(this.getFrameTelemetry());}
  getFrameTelemetry():FrameTelemetry {return this.telemetry.status==='measured'?{status:'measured',sample:{...this.telemetry.sample}}:{...this.telemetry};}
  setEraseTool(on:boolean):void {this.cancelStroke();this.eraseTool=on;this.syncBrushPreview();this.ctx.onSessionDirty();}
  getEraseTool():boolean {return this.eraseTool;}

  setTheme(theme:Theme):void {
    this.palette={...VIEWPORT_PALETTES[theme]};
    this.scene.background=new THREE.Color(this.palette.background);
    this.renderer?.setClearColor(this.palette.background,1);
    (this.tileHighlight.material as THREE.LineBasicMaterial).color.setHex(this.palette.selection);
    (this.hoverHighlight.material as THREE.LineBasicMaterial).color.setHex(this.palette.hover);
    (this.cornerPts.material as THREE.PointsMaterial).color.setHex(0xffffff); // vertex colors carry the theme; avoid double tinting.
    if(this.renderer){this.rebuildGrid();this.syncSelection();}
    this.requestFrame();
  }
  getBackgroundColor():number {return this.palette.background;}

  private requestFrame(): void { this.frameRequested = true; }

  private activeCamera(): THREE.Camera {
    return this.camKind === 'persp' ? this.perspCam : this.orthoCam;
  }

  private resize(): void {
    if (!this.renderer) return;
    const w = Math.max(this.host.clientWidth, 2), h = Math.max(this.host.clientHeight, 2);
    this.renderer.setSize(w, h, false);
    this.perspCam.aspect = w / h;
    this.perspCam.updateProjectionMatrix();
    const dist = this.orthoCam.position.distanceTo(this.orbit.target);
    const halfH = dist * Math.tan(THREE.MathUtils.degToRad(this.perspCam.fov / 2));
    const halfW = halfH * (w / h);
    this.orthoCam.left = -halfW; this.orthoCam.right = halfW;
    this.orthoCam.top = halfH; this.orthoCam.bottom = -halfH;
    this.orthoCam.updateProjectionMatrix();
  }

  /* ------------------------------------------------ cameras / planes */

  setCameraKind(kind: CameraKind): void {
    if (!this.renderer) return;
    if (kind === this.camKind) return;
    this.cancelStroke();
    const from = this.activeCamera();
    const dir = new THREE.Vector3();
    from.getWorldDirection(dir);
    const target = this.orbit.target.clone();
    const dist = from.position.distanceTo(target);
    this.camKind = kind;
    const to = kind === 'persp' ? this.perspCam : this.orthoCam;
    to.position.copy(target.clone().add(dir.multiplyScalar(-dist)));
    to.lookAt(target);
    this.orbit.object = to as THREE.Camera;
    this.orbit.update();
    this.resize();
    this.autoPlaneHysteresis();
    this.syncBrushPreview();
    this.requestFrame();
  }

  getCameraKind(): CameraKind { return this.camKind; }

  getRendererInfo(): { kind: string; version: string; drawCalls: number; triangles: number; cameras: string; geometries: number; textures: number } | null {
    if (!this.renderer) return null;
    const info = this.renderer.info;
    return {
      kind: 'WebGL',
      version: this.renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1',
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      cameras: `${this.camKind} fov${this.camKind === 'persp' ? this.perspCam.fov : 'ortho'}`,
    };
  }

  /** Automatic plane from camera direction, with hysteresis against flips. */
  private autoPlaneHysteresis(): void {
    const s = this.ctx.session;
    if (s.planeLocked || this.stroke) return; // planeLocked override; frozen during strokes
    const dir = new THREE.Vector3();
    this.activeCamera().getWorldDirection(dir);
    const score = (p: Plane): number => {
      const n = AXIS_VEC[p];
      return Math.abs(dir.dot(n));
    };
    const cur = score(s.plane);
    let best: Plane | null = null;
    let bestScore = cur + 0.15; // hysteresis: challenger must clearly win
    for (const p of ['XY', 'XZ', 'YZ'] as Plane[]) {
      const sc = score(p);
      if (p !== s.plane && sc > bestScore) { bestScore = sc; best = p; }
    }
    if (best) {
      s.plane = best;
      this.ctx.onSessionDirty();
      this.rebuildGrid();
      this.syncBrushPreview();
      this.ctx.onStatus(`Plane ${best} (auto)`);
    }
  }

  setPlane(plane: Plane, lock: boolean): void {
    if (this.stroke || this.dragTransform) return;
    const s = this.ctx.session;
    s.plane = plane;
    s.planeLocked = lock;
    this.rebuildGrid();
    this.syncBrushPreview();
    this.ctx.onSessionDirty();
  }

  /** THREE.Plane for the session construction plane through the crosshair. */
  private sessionThreePlane(): THREE.Plane {
    const s = this.ctx.session;
    const n = AXIS_VEC[s.plane];
    return new THREE.Plane(n.clone(), -n.dot(new THREE.Vector3(...s.crosshair)));
  }

  /* ------------------------------------------------------ atlas sync */

  syncAtlases(project: Project): void {
    this.atlasById.clear();
    for (const a of project.atlases) this.atlasById.set(a.id, a);
    const seen = new Set<string>();
    for (const a of project.atlases) {
      seen.add(a.id);
      const existing = this.textures.get(a.id);
      if (!existing || existing.url !== a.dataUrl) {
        if (existing) { existing.tex.dispose(); this.textures.delete(a.id); }
        this.loadAtlasTexture(a);
      }
    }
    for (const [id, t] of this.textures) {
      if (!seen.has(id)) { t.tex.dispose(); this.textures.delete(id); }
    }
    for (const [id] of this.batches) {
      if (!seen.has(id)) this.disposeBatch(id);
    }
  }

  private loadAtlasTexture(atlas: Atlas): void {
    const img = new Image();
    img.onload = () => {
      if (this.disposed) return;
      const tex = new THREE.Texture(img);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = true; // PNG is top-down; flip its upload for bottom-left UVs.
      tex.needsUpdate = true;
      this.textures.set(atlas.id, { tex, url: atlas.dataUrl });
      // material may already exist from a batch that raced the image
      const batch = this.batches.get(atlas.id);
      if (batch) {
        const mat = batch.mesh.material as THREE.MeshLambertMaterial;
        mat.map = tex;
        mat.needsUpdate = true;
      }
      const bm = this.brushMesh;
      if (bm && (bm.material as THREE.MeshBasicMaterial).map == null) {
        (bm.material as THREE.MeshBasicMaterial).map = tex;
        (bm.material as THREE.MeshBasicMaterial).needsUpdate = true;
      }
      this.requestFrame();
    };
    img.onerror = () => this.ctx.onError(new Error(`Atlas "${atlas.name}" image failed to decode`), 'Atlas texture');
    img.src = atlas.dataUrl;
  }

  private disposeBatch(atlasId: string): void {
    const b = this.batches.get(atlasId);
    if (!b) return;
    this.batchRoot.remove(b.mesh);
    b.mesh.geometry.dispose();
    (b.mesh.material as THREE.Material).dispose();
    this.batches.delete(atlasId);
  }

  /* ------------------------------------------------ scene rebuild */

  /** Full rebuild of batched tile geometry from the project. */
  rebuildScene(project: Project): void {
    for (const [id] of this.batches) this.disposeBatch(id);
    const perAtlasTiles = new Map<string, Tile[]>();
    for (const t of project.tiles) {
      if (!isObjectVisible(project, t.objectId)) continue;
      let list = perAtlasTiles.get(t.atlasId);
      if (!list) perAtlasTiles.set(t.atlasId, (list = []));
      list.push(t);
    }
    for (const [atlasId, tiles] of perAtlasTiles) {
      const atlas = this.atlasById.get(atlasId);
      const count = tiles.length;
      const pos = new Float32Array(count * 4 * 3);
      const nor = new Float32Array(count * 4 * 3);
      const uv = new Float32Array(count * 4 * 2);
      const idx = new Uint32Array(count * 6);
      const triTileIds: string[] = new Array(count * 2);
      for (let i = 0; i < count; i++) {
        const t = tiles[i];
        const vp = i * 12, up = i * 8, ip = i * 6;
        for (let k = 0; k < 4; k++) {
          const v = t.vertices[k];
          pos[vp + k * 3] = v[0]; pos[vp + k * 3 + 1] = v[1]; pos[vp + k * 3 + 2] = v[2];
          const u = t.uvs[k];
          uv[up + k * 2] = u[0]; uv[up + k * 2 + 1] = u[1];
        }
        const normals = tileCornerNormals(t);
        for (let k = 0; k < 4; k++) {
          nor[vp + k * 3] = normals[k][0]; nor[vp + k * 3 + 1] = normals[k][1]; nor[vp + k * 3 + 2] = normals[k][2];
        }
        // Triangulation [0,1,2,0,2,3]; inverted for reversed tiles (same coverage).
        if (!t.reversed) {
          idx[ip] = i * 4; idx[ip + 1] = i * 4 + 1; idx[ip + 2] = i * 4 + 2;
          idx[ip + 3] = i * 4; idx[ip + 4] = i * 4 + 2; idx[ip + 5] = i * 4 + 3;
        } else {
          idx[ip] = i * 4; idx[ip + 1] = i * 4 + 2; idx[ip + 2] = i * 4 + 1;
          idx[ip + 3] = i * 4; idx[ip + 4] = i * 4 + 3; idx[ip + 5] = i * 4 + 2;
        }
        triTileIds[i * 2] = t.id;
        triTileIds[i * 2 + 1] = t.id;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      const known = this.atlasById.has(atlasId);
      const tex = this.textures.get(atlasId)?.tex ?? null;
      const mat = new THREE.MeshLambertMaterial({
        map: tex, side: THREE.DoubleSide, transparent: true, alphaTest: 0.01,
      });
      mat.needsUpdate = true;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.userData.atlasId = atlasId;
      mesh.userData.knownAtlas = known;
      this.batchRoot.add(mesh);
      this.batches.set(atlasId, { mesh, triTileIds });
    }
    this.requestFrame();
  }

  /* ------------------------------------------------------ grid/crosshair */

  rebuildGrid(): void {
    if (this.gridObj) {
      this.overlay.remove(this.gridObj);
      this.gridObj.traverse((o) => {
        const any = o as THREE.Mesh;
        if (any.geometry) any.geometry.dispose();
        if (any.material) (Array.isArray(any.material) ? any.material : [any.material]).forEach(m=>m.dispose());
      });
    }
    const s = this.ctx.session;
    const group = new THREE.Group();
    const N = 32; // grid extends ±N cells
    const step = s.grid;
    const ext = N * step;
    const pts: number[] = [];
    const addLine = (a: Vec3, b: Vec3): void => { pts.push(...a, ...b); };
    for (let i = -N; i <= N; i++) {
      const d = i * step;
      if (s.plane === 'XY') { addLine([d, -ext, 0], [d, ext, 0]); addLine([-ext, d, 0], [ext, d, 0]); }
      else if (s.plane === 'XZ') { addLine([d, 0, -ext], [d, 0, ext]); addLine([-ext, 0, d], [ext, 0, d]); }
      else { addLine([0, d, -ext], [0, d, ext]); addLine([0, -ext, d], [0, ext, d]); }
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const grid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color:this.palette.grid, transparent: true, opacity: 0.85 }));
    group.add(grid);

    // crosshair axes in accent colors (longer than the grid extent)
    const o = [...s.crosshair] as Vec3;
    const L = step * 6;
    const ax: Array<[Vec3, Vec3, number]> = s.plane === 'XY'
      ? [[[o[0] - L, o[1], o[2]], [o[0] + L, o[1], o[2]],this.palette.axis], [[o[0], o[1] - L, o[2]], [o[0], o[1] + L, o[2]],this.palette.axis]]
      : s.plane === 'XZ'
        ? [[[o[0] - L, o[1], o[2]], [o[0] + L, o[1], o[2]],this.palette.axis], [[o[0], o[1], o[2] - L], [o[0], o[1], o[2] + L],this.palette.axis]]
        : [[[o[0], o[1] - L, o[2]], [o[0], o[1] + L, o[2]],this.palette.axis], [[o[0], o[1], o[2] - L], [o[0], o[1], o[2] + L],this.palette.axis]];
    for (const [a, b, col] of ax) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b], 3));
      group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.9 })));
    }
    // construction-plane quad tint
    this.overlay.add(group);
    this.gridObj = group;
    this.requestFrame();
  }

  /* ---------------------------------------------------- brush preview */

  syncBrushPreview(): void {
    const s = this.ctx.session;
    const project = this.ctx.store.project;
    const atlas = project.atlases.find((a) => a.id === s.brush.atlasId) ?? null;
    if (!atlas || s.mode !== 'draw' || this.stroke || this.eraseTool) {
      if (this.brushMesh) { this.brushMesh.visible = false; }
      this.requestFrame();
      return;
    }
    const verts = this.brushVerts();
    const uvs = brushUVs(atlas, s.brush);
    if (!this.brushMesh) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(8), 2));
      const idx = new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1);
      geo.setIndex(idx);
      const mat = new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide,
      });
      this.brushMesh = new THREE.Mesh(geo, mat);
      this.brushMesh.renderOrder = 8;
      this.brushMesh.frustumCulled = false;
      this.overlay.add(this.brushMesh);
    }
    const geo = this.brushMesh.geometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).copyArray(new Float32Array(verts.flat()));
    (geo.getAttribute('uv') as THREE.BufferAttribute).copyArray(new Float32Array(uvs.flat()));
    geo.getAttribute('position').needsUpdate = true;
    geo.getAttribute('uv').needsUpdate = true;
    geo.computeVertexNormals();
    const mat = this.brushMesh.material as THREE.MeshBasicMaterial;
    const tex = this.textures.get(atlas.id)?.tex ?? null;
    if (mat.map !== tex) { mat.map = tex; mat.needsUpdate = true; }
    this.brushMesh.visible = true;
    this.requestFrame();
  }

  /** Corner positions of the brush quad at the current crosshair/plane. */
  private brushVerts(): Vec3[] {
    const s = this.ctx.session;
    const size = s.tileSize;
    const o = [...s.crosshair] as Vec3;
    if (s.plane === 'XY') {
      return [o, [o[0] + size, o[1], o[2]], [o[0] + size, o[1] + size, o[2]], [o[0], o[1] + size, o[2]]];
    }
    if (s.plane === 'XZ') {
      return [o, [o[0], o[1], o[2] + size], [o[0] + size, o[1], o[2] + size], [o[0] + size, o[1], o[2]]];
    }
    return tileCorners(o, s.plane, size);
  }

  /* ------------------------------------------------------- picking */

  private setPointer(e: PointerEvent): void {
    const rect = this.renderer!.domElement.getBoundingClientRect();
    this.pointerNDC.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointerNDC, this.activeCamera());
  }

  private pickTile(): { tileId: string; faceIndex: number } | null {
    const meshes = [...this.batches.values()].map((b) => b.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    for (const hit of hits) {
      if (hit.faceIndex === undefined || hit.faceIndex === null) continue;
      const mesh = hit.object as THREE.Mesh;
      const info = this.batches.get(mesh.userData.atlasId as string);
      if (!info) continue;
      const tileId = info.triTileIds[hit.faceIndex];
      const tile = this.ctx.store.project.tiles.find(t => t.id === tileId);
      if (tile && !isObjectLocked(this.ctx.store.project, tile.objectId)) return { tileId, faceIndex: hit.faceIndex };
    }
    return null;
  }

  /** Intersect pointer with construction plane, snap to grid via core. */
  private planeSnapPoint(): Vec3 | null {
    const s = this.ctx.session;
    const plane = this.sessionThreePlane();
    const pt = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(plane, pt);
    if (!hit) return null;
    const out = planePoint([pt.x, pt.y, pt.z], s.plane, s.crosshair, s.grid);
    return out;
  }

  /* -------------------------------------------------- selection sync */

  /** Refresh highlight markers from session.selection. */
  syncSelection(): void {
    const s = this.ctx.session;
    const project = this.ctx.store.project;
    const tiles = new Map(project.tiles.map((t) => [t.id, t]));
    // tile outlines
    const selTiles = s.selection.tileIds
      .map((id) => tiles.get(id))
      .filter((t): t is Tile => !!t && project.objects.some((o) => o.id === t.objectId));
    const lines: number[] = [];
    for (const t of selTiles) {
      const v = t.vertices;
      const edges: Array<[Vec3, Vec3]> = [[v[0], v[1]], [v[1], v[2]], [v[2], v[3]], [v[3], v[0]]];
      for (const [a, b] of edges) lines.push(...a, ...b);
    }
    this.setLines(this.tileHighlight, lines, selTiles.length > 0);

    const showCorners = s.mode === 'edit' && (s.selection.tileIds.length > 0 || s.selection.vertices.length > 0);
    const pts: number[] = [];
    const colors: number[] = [];
    const colSel = new THREE.Color(this.palette.selection);
    const colIdle = new THREE.Color(this.palette.cornerIdle);
    if (showCorners) {
      const selCorners = new Set(s.selection.vertices.map((c) => `${c.tileId}:${c.corner}`));
      const shown = new Set<string>();
      for (const t of selTiles) {
        for (let k = 0; k < 4; k++) {
          const key = `${t.id}:${k}`;
          if (shown.has(key)) continue;
          shown.add(key);
          const p = t.vertices[k];
          pts.push(...p);
          colors.push(colIdle.r, colIdle.g, colIdle.b);
        }
      }
      for (const c of s.selection.vertices) {
        const t = tiles.get(c.tileId);
        if (!t) continue;
        const v = t.vertices[Math.min(3, Math.max(0, c.corner))];
        pts.push(...v);
        colors.push(colSel.r, colSel.g, colSel.b);
      }
      // hard cap for pathological selections (keeps marker buffer sane)
      const MAX = 20000;
      if (pts.length > MAX * 3) {
        pts.length = MAX * 3;
        colors.length = MAX * 3;
      }
    }
    const posAttr = this.cornerPts.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.cornerPts.geometry.getAttribute('color');
    if (colAttr) this.cornerPts.geometry.deleteAttribute('color');
    this.cornerPts.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const posArr = posAttr.array as Float32Array;
    if (posArr.length >= pts.length) {
      posAttr.copyArray(new Float32Array(pts));
      posAttr.needsUpdate = true;
    } else {
      this.cornerPts.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    }
    this.cornerPts.geometry.setDrawRange(0, pts.length / 3);
    (this.cornerPts.material as THREE.PointsMaterial).vertexColors = true;
    this.cornerPts.visible = showCorners && pts.length > 0;
    this.requestFrame();
  }

  private setLines(obj: THREE.LineSegments, data: number[], visible: boolean): void {
    if (data.length === 0) {
      obj.geometry.setDrawRange(0, 0);
      obj.visible = false;
      return;
    }
    const attr = obj.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    if (arr.length < data.length) {
      obj.geometry.setAttribute('position', new THREE.Float32BufferAttribute(data, 3));
      obj.geometry.setDrawRange(0, data.length / 3);
    } else {
      attr.copyArray(new Float32Array(data));
      attr.needsUpdate = true;
      obj.geometry.setDrawRange(0, data.length / 3);
    }
    obj.visible = visible;
  }

  /** Move/rotate/scale gizmo proxy position from selection centroid. */
  syncTransformProxy(): void {
    const tc = this.transform;
    if (!tc) return;
    const s = this.ctx.session;
    const project = this.ctx.store.project;
    if (s.mode !== 'edit' || (s.selection.tileIds.length === 0 && s.selection.vertices.length === 0)) {
      tc.detach();
      if (this.transformHelper) this.transformHelper.visible = false;
      return;
    }
    if (this.tool === 'select') { tc.detach(); if(this.transformHelper) this.transformHelper.visible=false; return; }
    const centroid = this.selectionCentroid(project, s.selection);
    this.proxy.position.copy(centroid);
    this.proxy.quaternion.identity();
    this.proxy.scale.set(1, 1, 1);
    tc.attach(this.proxy);
    if (this.transformHelper) this.transformHelper.visible = true;
  }

  private selectionCentroid(project: Project, sel: Selection): THREE.Vector3 {
    const tiles = new Map(project.tiles.map((t) => [t.id, t]));
    const acc = new THREE.Vector3();
    let n = 0;
    for (const id of sel.tileIds) {
      const t = tiles.get(id);
      if (!t) continue;
      for (const v of t.vertices) { acc.x += v[0]; acc.y += v[1]; acc.z += v[2]; }
      n += 4;
    }
    for (const c of sel.vertices) {
      const t = tiles.get(c.tileId);
      if (!t) continue;
      const v = t.vertices[Math.min(3, Math.max(0, c.corner))];
      acc.x += v[0]; acc.y += v[1]; acc.z += v[2];
      n++;
    }
    if (n === 0) return new THREE.Vector3(...this.ctx.session.crosshair);
    return acc.divideScalar(n);
  }

  setTransformTool(tool: 'select' | 'translate' | 'rotate' | 'scale'): void {
    this.tool = tool;
    if (!this.transform) return;
    if (tool === 'select') {
      this.transform.detach();
      if (this.transformHelper) this.transformHelper.visible = false;
    } else {
      this.transform.setMode(tool);
      this.syncTransformProxy();
    }
  }

  getTransformTool(): string {
    return this.tool;
  }

  private beginTransformDrag(): void {
    const tc = this.transform;
    if (!tc) return;
    this.dragTransform = {
      startPos: this.proxy.position.clone(),
      startQuat: this.proxy.quaternion.clone(),
      startScale: this.proxy.scale.clone(),
      label: tc.mode === 'translate' ? 'Move selection' : tc.mode === 'rotate' ? 'Rotate selection' : 'Scale selection',
    };
  }

  private updateTransformReadout(): void {
    const d = this.dragTransform;
    if (!d) return;
    const dt = this.proxy.position.clone().sub(d.startPos);
    const q = this.proxy.quaternion.clone().multiply(d.startQuat.clone().invert());
    const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
    const sc = this.proxy.scale.clone().sub(d.startScale);
    this.ctx.onTransformReadout(
      `Δt (${dt.x.toFixed(2)}, ${dt.y.toFixed(2)}, ${dt.z.toFixed(2)})  Δr (${
        THREE.MathUtils.radToDeg(e.x).toFixed(0)}°, ${THREE.MathUtils.radToDeg(e.y).toFixed(0)}°, ${
        THREE.MathUtils.radToDeg(e.z).toFixed(0)}°)  Δs (${sc.x.toFixed(2)}, ${sc.y.toFixed(2)}, ${sc.z.toFixed(2)})`,
    );
  }

  private renderTransformPreview(): void {
    const d=this.dragTransform;
    if(!d) return;
    const project=this.ctx.store.project, sel=this.ctx.session.selection;
    const ids=new Set([...sel.tileIds,...sel.vertices.map(v=>v.tileId)]);
    const draft:Project={...project,tiles:project.tiles.map(t=>ids.has(t.id)?{...t,vertices:t.vertices.map(v=>[...v]) as Tile['vertices']}:t)};
    const delta=this.proxy.position.clone().sub(d.startPos);
    const e=new THREE.Euler().setFromQuaternion(this.proxy.quaternion.clone().multiply(d.startQuat.clone().invert()),'XYZ');
    const pivot=[...this.ctx.session.crosshair] as Vec3;
    if(delta.lengthSq()>1e-12) translateSelection(draft,sel,delta.toArray() as Vec3);
    if(Math.abs(e.x)>1e-5) rotateSelection(draft,sel,'x',e.x,pivot);
    if(Math.abs(e.y)>1e-5) rotateSelection(draft,sel,'y',e.y,pivot);
    if(Math.abs(e.z)>1e-5) rotateSelection(draft,sel,'z',e.z,pivot);
    if(this.transform?.mode==='scale') scaleSelection(draft,sel,this.proxy.scale.toArray() as Vec3,pivot);
    this.rebuildScene(draft);
  }

  private commitTransformDrag(): void {
    const d = this.dragTransform;
    this.dragTransform = null;
    if (!d) return;
    const tc = this.transform!;
    const s = this.ctx.session;
    const sel = s.selection;
    const moved = this.proxy.position.distanceTo(d.startPos) > 1e-6;
    const dq = this.proxy.quaternion.clone().multiply(d.startQuat.clone().invert());
    const e = new THREE.Euler().setFromQuaternion(dq, 'XYZ');
    const rotated = Math.abs(e.x) + Math.abs(e.y) + Math.abs(e.z) > 1e-5;
    const sc = this.proxy.scale;
    const scaled = Math.abs(sc.x - 1) + Math.abs(sc.y - 1) + Math.abs(sc.z - 1) > 1e-5;
    if (!moved && !rotated && !scaled) { this.syncTransformProxy(); return; }
    const pivot = [...this.ctx.session.crosshair] as Vec3;
    try {
      if (moved) {
        const dt = this.proxy.position.clone().sub(d.startPos);
        this.ctx.store.transact(d.label, (project) => {
          translateSelection(project, sel, [dt.x, dt.y, dt.z]);
        });
      }
      if (rotated) {
        this.ctx.store.transact('Rotate selection', (project) => {
          if (Math.abs(e.x) > 1e-5) rotateSelection(project, sel, 'x', e.x, pivot);
          if (Math.abs(e.y) > 1e-5) rotateSelection(project, sel, 'y', e.y, pivot);
          if (Math.abs(e.z) > 1e-5) rotateSelection(project, sel, 'z', e.z, pivot);
        });
      }
      if (scaled) {
        this.ctx.store.transact('Scale selection', (project) => {
          scaleSelection(project, sel, [sc.x, sc.y, sc.z], pivot);
        });
      }
    } catch (err) { this.ctx.onError(err, 'Transform'); }
    this.syncTransformProxy();
    this.syncSelection();
    this.ctx.onSessionDirty();
  }

  /* ------------------------------------------------------ strokes */

  private onPointerDown(e: PointerEvent): void {
    if (!this.renderer || this.disposed) return;
    (e.target as HTMLElement).focus?.();
    if (this.dragTransform || this.transform?.dragging) return;
    if(e.button===0||(e.button===2&&e.shiftKey&&this.ctx.session.mode==='draw')){try{this.renderer.domElement.setPointerCapture(e.pointerId);}catch{}}
    this.downPos = { x: e.clientX, y: e.clientY, button: e.button };
    const s = this.ctx.session;
    if(e.button===2&&e.shiftKey&&s.mode==='draw'){this.setPointer(e);this.beginStroke('erase');return;}
    if (e.button === 0 && (s.mode === 'draw' || s.mode === 'edit') && !e.altKey) {
      this.setPointer(e);
      if (s.mode === 'draw') {
        this.beginStroke(this.eraseTool?'erase':'draw');
      } else {
        // edit mode: either pick now (click) or wait for box select on drag
        this.editPotentialBox = { x: e.clientX, y: e.clientY, additive: e.shiftKey };
      }
    } else if (e.button === 2 && s.mode === 'draw') {
      // potential right-click erase (only if not dragged into a pan)
    } else if (e.button === 0 && s.mode === 'draw' && e.altKey) {
      // orbit fallback
    }
  }

  private editPotentialBox: { x: number; y: number; additive: boolean } | null = null;

  private beginStroke(kind: 'draw' | 'erase'): void {
    const s = this.ctx.session;
    if (s.mode !== 'draw' && !(kind === 'erase')) return;
    if (kind === 'draw' && isObjectLocked(this.ctx.store.project,s.activeObjectId)) { this.ctx.onStatus('Active object is locked — unlock it before drawing'); return; }
    if (kind === 'draw' && !this.ctx.store.project.atlases.some(a=>a.id===s.brush.atlasId)) { this.ctx.onStatus('Import a PNG tileset before drawing'); return; }
    this.autoPlaneHysteresis(); // settle plane before freezing
    this.orbit.enabled = false;
    this.stroke = { stamped: [], previewMeshes: [], lastOrigin: null, eraseIds: new Set(), kind, lastScreen:this.downPos?{x:this.downPos.x,y:this.downPos.y}:null };
    this.syncBrushPreview();
    if (kind === 'draw') {
      const p = this.planeSnapPoint();
      if (p) this.stampAt(p);
      this.ctx.onStatus('Drawing — drag to stamp, release to commit, Esc to cancel');
    } else {
      this.erasePick();
      this.renderErasePreview();
      this.ctx.onStatus('Erasing — drag to preview, release to commit, Esc to cancel');
    }
    const hint=document.getElementById('stroke-hint');
    if(hint){hint.textContent=kind==='erase'?'Drag to erase faces · release to commit · Esc cancels':'Drag to stamp tiles · release to commit · Esc cancels';hint.classList.add('show');}
  }

  /** Stamp a preview tile (visual only; committed on pointerup). */
  private stampAt(point: Vec3): void {
    const s = this.ctx.session;
    const stroke = this.stroke!;
    // interpolate from last origin to keep continuous strokes
    if (stroke.lastOrigin) {
      const from = stroke.lastOrigin;
      const dx = point[0] - from[0], dy = point[1] - from[1], dz = point[2] - from[2];
      const dist = Math.hypot(dx, dy, dz);
      const step = s.tileSize;
      const steps = Math.floor(dist / step - 1e-6);
      for (let i = 1; i <= steps; i++) {
        const t = (i * step) / dist;
        this.pushStamp(planePoint([from[0] + dx * t, from[1] + dy * t, from[2] + dz * t], s.plane, s.crosshair, s.grid));
      }
    }
    this.pushStamp(point);
    stroke.lastOrigin = point;
  }

  private pushStamp(origin: Vec3): void {
    const stroke = this.stroke!;
    const key = origin.join(',');
    if (stroke.stamped.some((o) => o.join(',') === key)) return;
    stroke.stamped.push(origin);
    const mesh = this.buildPreviewTileMesh(origin);
    if (mesh) {
      this.overlay.add(mesh);
      stroke.previewMeshes.push(mesh);
    }
  }

  private buildPreviewTileMesh(origin: Vec3): THREE.Mesh | null {
    const s = this.ctx.session;
    const project = this.ctx.store.project;
    const atlas = project.atlases.find((a) => a.id === s.brush.atlasId);
    if (!atlas) return null;
    const size = s.tileSize;
    const o = origin;
    let verts: Vec3[];
    if (s.plane === 'XY') verts = [o, [o[0] + size, o[1], o[2]], [o[0] + size, o[1] + size, o[2]], [o[0], o[1] + size, o[2]]];
    else if (s.plane === 'XZ') verts = [o, [o[0], o[1], o[2] + size], [o[0] + size, o[1], o[2] + size], [o[0] + size, o[1], o[2]]];
    else verts = [o, [o[0], o[1] + size, o[2]], [o[0], o[1] + size, o[2] + size], [o[0], o[1], o[2] + size]];
    const uvs = brushUVs(atlas, s.brush);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts.flat(), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.flat(), 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({
      map: this.textures.get(atlas.id)?.tex ?? null, side: THREE.DoubleSide,
      transparent: true, opacity: 0.75, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 6;
    return mesh;
  }

  private erasePick(): void {
    const hit=this.pickTile();
    if(hit && this.stroke) this.stroke.eraseIds.add(hit.tileId);
  }

  private eraseSegment(e:PointerEvent):void {
    const stroke=this.stroke!;
    const previousSize=stroke.eraseIds.size;
    const from=stroke.lastScreen??{x:e.clientX,y:e.clientY};
    const distance=Math.hypot(e.clientX-from.x,e.clientY-from.y);
    const steps=Math.min(512,Math.max(1,Math.ceil(distance/3)));
    for(let i=1;i<=steps;i++){
      this.setPointer({clientX:from.x+(e.clientX-from.x)*i/steps,clientY:from.y+(e.clientY-from.y)*i/steps} as PointerEvent);
      this.erasePick();
    }
    stroke.lastScreen={x:e.clientX,y:e.clientY};
    if(stroke.eraseIds.size!==previousSize)this.renderErasePreview();
  }

  private renderErasePreview():void {
    const ids=this.stroke?.eraseIds;if(!ids?.size)return;
    // Exclude preview faces from rendering AND future picking. No document or
    // history changes occur before release; hidden/locked layers stay untouched.
    this.rebuildScene({...this.ctx.store.project,tiles:this.ctx.store.project.tiles.filter(t=>!ids.has(t.id))});
    this.ctx.onStatus(`Erase preview: ${ids.size} face${ids.size===1?'':'s'} · Esc cancels`);
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.renderer || this.disposed) return;
    if (this.stroke) {
      e.preventDefault();
      this.setPointer(e);
      if (this.stroke.kind === 'draw') {
        const p = this.planeSnapPoint();
        if (p) this.stampAt(p);
      } else {
        this.eraseSegment(e);
      }
      return;
    }
    if (this.dragTransform || this.transform?.dragging) return;
    if (this.editPotentialBox && (e.buttons & 1) !== 0) {
      const dx = e.clientX - this.editPotentialBox.x, dy = e.clientY - this.editPotentialBox.y;
      if (Math.hypot(dx, dy) > 5 && !this.boxSelect) this.startBoxSelect(e);
    }
    if (this.boxSelect) {
      this.updateBoxSelect(e);
      return;
    }
    // hover feedback
    if (e.buttons === 0) {
      this.setPointer(e);
      const hit = this.pickTile();
      if ((hit?.tileId ?? null) !== this.hoveredTile) {
        this.hoveredTile = hit?.tileId ?? null;
        this.updateHoverHighlight();
      } else if (this.ctx.session.mode === 'draw') {
        const p = this.planeSnapPoint();
        if (p) {
          const s = this.ctx.session;
          if (p[0] !== s.crosshair[0] || p[1] !== s.crosshair[1] || p[2] !== s.crosshair[2]) {
            s.crosshair = p;
            this.rebuildGrid();
            this.syncBrushPreview();
          }
        }
      }
    }
  }

  private updateHoverHighlight(): void {
    const project = this.ctx.store.project;
    const t = this.hoveredTile ? project.tiles.find((x) => x.id === this.hoveredTile) : null;
    if (!t) { this.hoverHighlight.visible = false; this.requestFrame(); return; }
    const lines: number[] = [];
    const v = t.vertices;
    for (const [a, b] of [[v[0], v[1]], [v[1], v[2]], [v[2], v[3]], [v[3], v[0]]] as Array<[Vec3, Vec3]>) {
      lines.push(...a, ...b);
    }
    this.setLines(this.hoverHighlight, lines, true);
    (this.hoverHighlight.material as THREE.LineBasicMaterial).color.setHex(this.palette.hover);
    this.requestFrame();
  }

  /* -------------------------------------------------- box selection */

  private startBoxSelect(e: PointerEvent): void {
    const box = this.editPotentialBox;
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'box-select';
    this.host.appendChild(el);
    this.boxSelect = { x0: box.x, y0: box.y, el };
    this.boxAdditive = box.additive;
    this.orbit.enabled = false;
    // OrbitControls may have already latched a shift+LMB pan/rotate on this
    // gesture (it handled pointerdown before our threshold fired); reset it.
    const orbitInternal = this.orbit as unknown as { state?: number; _pointers: number[] };
    orbitInternal.state = 0; // _STATE.NONE
    try { orbitInternal._pointers.length = 0; } catch { /* older builds */ }
    this.updateBoxSelect(e);
  }

  private updateBoxSelect(e: PointerEvent): void {
    if (!this.boxSelect) return;
    const x0 = this.boxSelect.x0, y0 = this.boxSelect.y0;
    const x1 = e.clientX, y1 = e.clientY;
    const el = this.boxSelect.el;
    el.style.left = `${Math.min(x0, x1)}px`;
    el.style.top = `${Math.min(y0, y1)}px`;
    el.style.width = `${Math.abs(x1 - x0)}px`;
    el.style.height = `${Math.abs(y1 - y0)}px`;
  }

  private finishBoxSelect(e: PointerEvent): void {
    const bs = this.boxSelect;
    this.boxSelect = null;
    if (!bs) return;
    bs.el.remove();
    this.orbit.enabled = true;
    const s = this.ctx.session;
    const rect = this.renderer!.domElement.getBoundingClientRect();
    const rx0 = Math.min(bs.x0, e.clientX) - rect.left, rx1 = Math.max(bs.x0, e.clientX) - rect.left;
    const ry0 = Math.min(bs.y0, e.clientY) - rect.top, ry1 = Math.max(bs.y0, e.clientY) - rect.top;
    const inside = (x: number, y: number): boolean =>
      x >= rx0 && x <= rx1 && y >= ry0 && y <= ry1;
    const proj = new THREE.Vector3();
    const cam = this.activeCamera();
    const newTiles: string[] = [];
    const newVerts: Array<{ tileId: string; corner: number }> = [];
    const vertexMode = this.vertexMode;
    for (const t of this.ctx.store.project.tiles) {
      if (!isObjectVisible(this.ctx.store.project,t.objectId) || isObjectLocked(this.ctx.store.project,t.objectId)) continue;
      if (vertexMode) {
        for (let k = 0; k < 4; k++) {
          const v = t.vertices[k];
          proj.set(v[0], v[1], v[2]).project(cam as THREE.Camera);
          const sx = ((proj.x + 1) / 2) * rect.width, sy = ((1 - proj.y) / 2) * rect.height;
          if (inside(sx, sy)) newVerts.push({ tileId: t.id, corner: k });
        }
      } else {
        const c = [(t.vertices[0][0] + t.vertices[2][0]) / 2, (t.vertices[0][1] + t.vertices[2][1]) / 2, (t.vertices[0][2] + t.vertices[2][2]) / 2];
        proj.set(c[0], c[1], c[2]).project(cam as THREE.Camera);
        const sx = ((proj.x + 1) / 2) * rect.width, sy = ((1 - proj.y) / 2) * rect.height;
        if (inside(sx, sy)) newTiles.push(t.id);
      }
    }
    if (this.boxAdditive) {
      s.selection.tileIds = [...new Set([...s.selection.tileIds, ...newTiles])];
      s.selection.vertices = [...s.selection.vertices, ...newVerts.filter((v) => !s.selection.vertices.some((e2) => e2.tileId === v.tileId && e2.corner === v.corner))];
    } else {
      s.selection = { tileIds: newTiles, vertices: newVerts };
    }
    this.editPotentialBox = null;
    this.ctx.onSessionDirty();
    this.ctx.onStatus(`Box select: ${newTiles.length || newVerts.length} item(s)`);
  }

  /* ---------------------------------------------------- pointer up/cancel */

  private onPointerUp(e: PointerEvent): void {
    if (!this.renderer || this.disposed) return;
    if (!this.downPos && !this.stroke && !this.boxSelect) return;
    const s = this.ctx.session;
    const moved = this.downPos ? Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) > 5 : false;
    // box select completion
    if (this.boxSelect && e.button === 0) { this.finishBoxSelect(e); this.downPos = null; return; }
    // stroke commit
    if(this.stroke&&(e.button===0||this.stroke.kind==='erase'&&e.button===2)){this.commitStroke(); this.downPos = null; return; }
    this.downPos = null;
    // draw mode right click = erase intersected
    if (e.button === 2 && s.mode === 'draw' && !moved) {
      this.setPointer(e);
      const hit = this.pickTile();
      if (hit) {
        try {
          this.ctx.store.transact('Erase tile', (project) => {
            const i = project.tiles.findIndex((t) => t.id === hit.tileId);
            if (i >= 0) project.tiles.splice(i, 1);
          });
          this.ctx.onStatus('Tile erased');
        } catch (err) { this.ctx.onError(err, 'Erase'); }
      }
      return;
    }
    // edit mode left click pick
    if (e.button === 0 && s.mode === 'edit' && !moved && !e.altKey && !this.stroke && !this.boxSelect) {
      this.setPointer(e);
      this.editClickPick(e);
    }
  }

  private editClickPick(e: PointerEvent): void {
    const s = this.ctx.session;
    const additive = e.shiftKey;
    const hit = this.pickTile();
    const vertexMode = this.vertexMode;
    if (!hit) {
      if (!additive) { s.selection = { tileIds: [], vertices: [] }; this.ctx.onSessionDirty(); }
      return;
    }
    const project = this.ctx.store.project;
    const tile = project.tiles.find((t) => t.id === hit.tileId);
    if (!tile) return;
    if (vertexMode) {
      // nearest corner of the picked tile within a screen threshold
      const rect = this.renderer!.domElement.getBoundingClientRect();
      const cam = this.activeCamera();
      let best = -1, bestD = 18; // px threshold
      for (let k = 0; k < 4; k++) {
        const v = tile.vertices[k];
        const p = new THREE.Vector3(v[0], v[1], v[2]).project(cam as THREE.Camera);
        const sx = ((p.x + 1) / 2) * rect.width + rect.left, sy = ((1 - p.y) / 2) * rect.height + rect.top;
        const d = Math.hypot(sx - e.clientX, sy - e.clientY);
        if (d < bestD) { bestD = d; best = k; }
      }
      if (best >= 0) {
        this.applySelectionAdditive(additive, { tileIds: [], vertices: [{ tileId: tile.id, corner: best }] });
        this.ctx.onStatus(`Corner ${best} of ${tile.id}`);
        return;
      }
    }
    this.applySelectionAdditive(additive, { tileIds: [tile.id], vertices: [] });
    this.ctx.onStatus(`Tile ${tile.id}`);
  }

  private applySelectionAdditive(additive: boolean, add: Selection): void {
    const s = this.ctx.session;
    if (!additive) {
      s.selection = { tileIds: [...add.tileIds], vertices: [...add.vertices] };
    } else {
      // toggle tiles present in the click set; add new corner picks
      const tiles = new Set(s.selection.tileIds);
      for (const id of add.tileIds) {
        if (tiles.has(id)) tiles.delete(id); else tiles.add(id);
      }
      const verts = s.selection.vertices.filter((v) => !add.vertices.some((a) => a.tileId === v.tileId && a.corner === v.corner));
      for (const a of add.vertices) {
        if (!verts.some((v) => v.tileId === a.tileId && v.corner === a.corner)) verts.push(a);
      }
      s.selection = { tileIds: [...tiles], vertices: verts };
    }
    this.ctx.onSessionDirty();
  }

  private commitStroke(): void {
    const stroke = this.stroke;
    this.stroke = null;
    document.getElementById('stroke-hint')?.classList.remove('show');
    this.orbit.enabled = true;
    if (!stroke) { this.syncSelection(); return; }
    for (const m of stroke.previewMeshes) {
      this.overlay.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    try {
      if (stroke.kind === 'draw' && stroke.stamped.length > 0) {
        const origins = stroke.stamped;
        this.ctx.store.transact('Draw tiles', (project) => {
          const signatures = new Set(project.tiles.map(t => JSON.stringify(t.vertices)));
          for (const o of origins) {
            const signature = JSON.stringify(tileCorners(o,this.ctx.session.plane,this.ctx.session.tileSize));
            if (!signatures.has(signature)) { makeTile(project, this.ctx.session, o); signatures.add(signature); }
          }
        });
        this.ctx.onStatus(`Drew ${origins.length} tile${origins.length > 1 ? 's' : ''}`);
      } else if (stroke.kind === 'erase' && stroke.eraseIds.size > 0) {
        const ids = stroke.eraseIds;
        this.ctx.store.transact('Erase tiles', (project) => {
          project.tiles=project.tiles.filter(t=>!ids.has(t.id)||isObjectLocked(project,t.objectId));
        });
        this.ctx.onStatus(`Erased ${ids.size} tile${ids.size > 1 ? 's' : ''}`);
      }
    } catch (err) {
      this.ctx.onError(err, 'Stroke');
    }
    this.rebuildScene(this.ctx.store.project);
    const alive=new Set(this.ctx.store.project.tiles.map(t=>t.id));
    this.ctx.session.selection.tileIds=this.ctx.session.selection.tileIds.filter(id=>alive.has(id));
    this.ctx.session.selection.vertices=this.ctx.session.selection.vertices.filter(v=>alive.has(v.tileId));
    this.syncSelection();
    this.syncTransformProxy();
    this.syncBrushPreview();
    this.ctx.onSessionDirty();
  }

  /** Pointer cancelled (tablet/multitouch) — roll back previews, no history. */
  private onPointerCancel(_e: PointerEvent): void {
    this.cancelStroke();
  }

  cancelStroke(): void {
    if (!this.renderer) return;
    if (this.stroke) {
      for (const m of this.stroke.previewMeshes) {
        this.overlay.remove(m);
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      const erasing=this.stroke.kind==='erase';
      this.stroke = null;
      if(erasing)this.rebuildScene(this.ctx.store.project);
      document.getElementById('stroke-hint')?.classList.remove('show');
      this.ctx.onStatus('Stroke cancelled');
    }
    if (this.boxSelect) {
      this.boxSelect.el.remove();
      this.boxSelect = null;
      this.orbit.enabled = true;
    }
    this.editPotentialBox = null;
    this.downPos = null;
    if (this.dragTransform) {
      const d = this.dragTransform;
      this.dragTransform = null;
      this.proxy.position.copy(d.startPos);
      this.proxy.quaternion.copy(d.startQuat);
      this.proxy.scale.copy(d.startScale);
      if (this.transform) this.transform.dragging = false;
      this.syncTransformProxy();
      this.rebuildScene(this.ctx.store.project);
    }
    this.orbit.enabled = true;
    this.requestFrame();
  }

  private vertexMode = false;

  setVertexMode(on: boolean): void {
    this.vertexMode = on;
    this.syncSelection();
  }

  /* ------------------------------------------------------ framing */

  frameAll(): void {
    if (!this.renderer) return;
    this.cancelStroke();
    const project = this.ctx.store.project;
    this.frameBox(this.sceneBounds(project.tiles.map((t) => t.id)));
  }

  frameSelection(): void {
    if (!this.renderer) return;
    this.cancelStroke();
    const s = this.ctx.session;
    const ids = s.selection.tileIds.length > 0
      ? s.selection.tileIds
      : s.selection.vertices.map((v) => v.tileId);
    if (ids.length === 0) { this.frameAll(); return; }
    this.frameBox(this.sceneBounds(ids));
  }

  private sceneBounds(tileIds: string[]): THREE.Box3 | null {
    const project = this.ctx.store.project;
    const box = new THREE.Box3();
    let any = false;
    for (const id of tileIds) {
      const t = project.tiles.find((x) => x.id === id);
      if (!t) continue;
      for (const v of t.vertices) box.expandByPoint(new THREE.Vector3(...v));
      any = true;
    }
    return any ? box : null;
  }

  private frameBox(box: THREE.Box3 | null): void {
    if (!box || box.isEmpty()) {
      this.orbit.target.set(0, 0, 0);
      this.perspCam.position.set(9, 9, 9);
      this.orthoCam.position.set(9, 9, 9);
      this.orbit.update();
      this.resize();
      this.requestFrame();
      return;
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length() || 2;
    const dir = new THREE.Vector3();
    this.activeCamera().getWorldDirection(dir);
    const dist = size * 1.4;
    const pos = center.clone().add(dir.multiplyScalar(-dist));
    this.orbit.target.copy(center);
    this.perspCam.position.copy(pos);
    this.orthoCam.position.copy(pos);
    this.resize();
    this.orbit.update();
    this.requestFrame();
  }

  /* -------------------------------------------------------- cleanup */

  dispose(): void {
    this.cancelStroke();
    this.disposed = true;
    document.removeEventListener('visibilitychange',this.visibilityChange);
    window.removeEventListener('blur',this.blurChange);
    this.unsubscribeStore?.();
    this.ro?.disconnect();
    for (const [, t] of this.textures) t.tex.dispose();
    for (const [, b] of this.batches) {
      b.mesh.geometry.dispose();
      (b.mesh.material as THREE.Material).dispose();
    }
    this.transform?.dispose();
    this.orbit?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}
