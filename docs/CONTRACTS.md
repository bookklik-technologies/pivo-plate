# Module contracts — PiVo Plate

Shared types live in src/core/types.ts. Treat these as fixed. No circular imports between core/io/ui. All geometry uses right-handed Y-up world coordinates and baked world-space tile vertices. Objects organize tiles; grouping/reparenting preserves coordinates (no object transform fields). Each tile has four independent corners; coincident corners on other tiles are not implicitly welded. Triangulation is [0,1,2,0,2,3], inverted for reversed tiles. UVs use bottom-left origin (image-region y is top-down). Atlas dataUrl is an embedded PNG data URL. Atlas margin and spacing describe selectable cells. Regions are actual pixel rectangles. Z-up XY tiles face +Z, XZ tiles face +Y, YZ tiles face +X.

Core module src/core/editor.ts exports:
- createProject(name?: string): Project; creates object-main, empty atlases/tiles.
- createSession(project: Project): EditorSession; accepts no atlases using blank brush atlasId.
- uid(prefix?: string): string.
- snap(value: number, grid: number): number.
- planePoint(point: Vec3, plane: Plane, crosshair: Vec3, grid: number): Vec3; floor-snaps the two in-plane values to the cell origin, fixes perpendicular coordinate at crosshair.
- makeTile(project: Project, session: EditorSession, origin: Vec3): Tile; tileSize controls world size; brush region controls UVs.
- brushUVs(atlas: Atlas, brush: Brush): [Vec2,Vec2,Vec2,Vec2].
- validateProject(value: unknown): Project; validates and deep clones, throws readable errors.
- isObjectVisible(project: Project, id: string): boolean; ancestors included.
- isObjectLocked(project: Project, id: string): boolean; ancestors included.
- selectedCorners(project: Project, selection: Selection): {tile: Tile;corner:number}[]; deduplicated.
- translateSelection(project: Project, selection: Selection, delta: Vec3): void.
- rotateSelection(project: Project, selection: Selection, axis: 'x'|'y'|'z', radians:number, pivot:Vec3): void.
- scaleSelection(project: Project, selection: Selection, factor:Vec3, pivot:Vec3): void.
- duplicateSelection(project:Project, selection:Selection, delta:Vec3): string[]; duplicates selected face tiles.
- deleteSelection(project:Project, selection:Selection): void; selected tiles deleted, corner-only deletions reject.
- reverseSelection(project:Project, selection:Selection): void.
- applyBrush(project:Project, selection:Selection, brush:Brush): void.
- transformUVs(project:Project, selection:Selection, operation:'rotate'|'flipX'|'flipY', offset?:Vec2): void; use selected tiles, optional UV translation.
- reparentObject(project:Project,id:string,parentId:string|null):void; reject cycles.
- class EditorStore: constructor(project:Project), project:Project, canUndo:boolean, canRedo:boolean, historyLabel:string, revision:number, subscribe(fn:()=>void):()=>void, transact(label:string,fn:(project:Project)=>void):void, undo():void, redo():void, replace(project:Project):void, markSaved(snapshot?:Project):void, dirty:boolean. Atomic snapshot transactions with canonical raw-draft validation, rollback on exception or invalid result, no-op omission, and bounded history. Constructor/replace validate before adoption. transact rejects Promise-returning callbacks and detaches committed state from retained drafts. Hierarchies are bounded to 128 ancestor edges; UVs use canonical 0..1 with 1e-6 tolerance. Atlas IDs are ZIP-safe, up to 128 characters.

IO module src/io/project.ts exports async encodeProject(project:Project):Promise&lt;Uint8Array> (ZIP .pvp with project.json + texture PNGs); async decodeProject(bytes:Uint8Array):Promise&lt;Project>; async saveAutosave(project:Project):Promise&lt;void>; async loadAutosave():Promise&lt;Project|null>; async clearAutosave():Promise&lt;void>; async inspectAutosave():Promise&lt;RecoveryRecord> atomically reserves the durable pending copy and returns empty/valid/invalid with raw backup text; async resolveRecovery(expectedRaw:string,discard?:boolean):Promise&lt;void> resolves only that protected copy and preserves newer current records; downloadBytes(bytes:Uint8Array,filename:string,mime?:string):void; downloadText(text:string,filename:string,mime?:string):void.
IO src/io/export.ts exports async exportGLB(project:Project):Promise&lt;Uint8Array>; async exportOBJ(project:Project):Promise&lt;Uint8Array> (ZIP OBJ+MTL+textures). Independent loader acceptance tests required. IO may import core editor for validation and visibility. Exports do not change source document. Reject invalid geometry with useful errors. Manual GLB encoding allowed for headless portability.

UI src/main.ts owns full editor. src/ui/styles.css owns CSS; src/ui/* optional helpers. Import core and IO by above names. Must work against contracts even before other modules exist. Three.js native ESM imports and addon paths three/addons/controls/OrbitControls.js and three/addons/controls/TransformControls.js. Use Three.js batching/geometry with tile/corner picking map. UI calls store.transact for every mutation. UI computes camera-selected plane with tie/hysteresis and freezes it for strokes. Pointercancel/Escape cancel and restore preview; commit strokes on pointerup. UI imports project exports and handle failures safely. Demo tileset generated with canvas, original, embedded in Atlas.

Erase tool/FPS additions: Viewport.setEraseTool and getEraseTool select a session-only Draw-mode erase action; left-drag or Shift+RMB captures a nonmutating target preview and one commit, with cancellation on unsafe context changes. FrameMeter supplies visible RAF interval windows; the HUD shows measured/warming/paused/unavailable states and is not a GPU benchmark.

No proprietary source/assets permitted. Use public docs only. Existing package.json and types belong to orchestrator. Agents only edit assigned modules/tests, never overwrite others' work.
