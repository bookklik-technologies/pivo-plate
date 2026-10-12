# Core & IO API

The renderer-independent engine lives in `src/core/editor.ts`; storage and exporters in `src/io/`. Shared types in `src/core/types.ts` are treated as fixed. Full contract: [CONTRACTS.md](/CONTRACTS).

## Core — `src/core/editor.ts`

```ts
import {
  createProject, createSession, validateProject,
  makeTile, brushUVs, validateBrushAgainstAtlas, applyBrush,
  planePoint, snap, tileCorners,
  selectedCorners, translateSelection, rotateSelection, scaleSelection,
  duplicateSelection, deleteSelection, reverseSelection,
  transformUVs, reparentObject, isObjectVisible, isObjectLocked,
  EditorStore,
} from './core/editor';
```

### Sessions & geometry

| Function | Purpose |
| --- | --- |
| `createProject(name?: string): Project` | Creates the default `object-main` with empty atlases/tiles |
| `createSession(project): EditorSession` | Session state; accepts no atlases using a blank brush `atlasId` |
| `snap(value, grid)` | Snap a scalar to the grid |
| `planePoint(point, plane, crosshair, grid)` | Floor-snaps the two in-plane values to the cell origin, fixes the perpendicular coordinate at the crosshair |
| `tileCorners(origin, plane, tileSize)` | World-space corners of a tile |

### Tiles, brushes & UVs

`makeTile(project, session, origin)` (tileSize controls world size; brush region controls UVs), `brushUVs(atlas, brush)`, `validateBrushAgainstAtlas(atlas, brush)`, `applyBrush(project, selection, brush)`, `transformUVs(project, selection, 'rotate' \| 'flipX' \| 'flipY', offset?)`, plus `UV_TOLERANCE = 1e-6`, `checkUvInRange`, `normalizeUv`.

### Selection & hierarchy

`selectedCorners` (deduplicated `{tile, corner}` list), `translateSelection`, `rotateSelection` (axis, radians, pivot), `scaleSelection` (factor, pivot), `duplicateSelection` → new ids, `deleteSelection` (corner-only deletions reject), `reverseSelection`, `reparentObject` (rejects cycles), `isObjectVisible`/`isObjectLocked` (ancestors included), `MAX_HIERARCHY_DEPTH` (128).

### Validation & history

- `validateProject(value: unknown): Project` — validates and deep-clones, throws readable errors.
- `class EditorStore` — `project`, `canUndo`, `canRedo`, `historyLabel`, `revision`, `dirty`, `subscribe(fn)`, `transact(label, fn)`, `undo()`, `redo()`, `replace(project)`, `markSaved()`. Atomic snapshot transactions with canonical raw-draft validation, rollback on exception or invalid result, no-op omission and bounded history. Constructor/replace validate before adoption; `transact` rejects Promise-returning callbacks and detaches committed state from retained drafts.

## IO — `src/io/project.ts`

```ts
import {
  encodeProject, decodeProject,       // .pvp ZIP (project.json + texture PNGs)
  saveAutosave, loadAutosave, clearAutosave,
  inspectAutosave, resolveRecovery,   // protected pending recovery
  downloadBytes, downloadText,
} from './io/project';
```

- `encodeProject(project): Promise<Uint8Array>` / `decodeProject(bytes): Promise<Project>`
- `saveAutosave(project)`, `loadAutosave(): Promise<Project \| null>`, `clearAutosave()`
- `inspectAutosave(): Promise<RecoveryRecord>` — atomically reserves the durable pending copy and returns empty/valid/invalid with raw backup text
- `resolveRecovery(expectedRaw, discard?)` — resolves only that protected copy and preserves newer current records

## IO — `src/io/export.ts`

```ts
import { exportGLB, exportOBJ, ExportError } from './io/export';

const glb = await exportGLB(project);  // self-contained textured GLB
const zip = await exportOBJ(project);  // ZIP: OBJ + MTL + textures
```

Exports do not change the source document and reject invalid geometry with useful errors.

## UI — `src/ui`

`Viewport` class (persp/ortho cameras, `FrameTelemetry`), `AtlasPanel`, `ObjectsPanel`, `PropertiesPanel`, theme/modal/dom helpers (`h`, `div`, `button`, `toast`, `iconButton`, `ICONS`), `demoAssets.ts` and the shared `suite.ts`. `src/main.ts` owns the shell, menu wiring, shortcuts and `window.__pivoPlateTest` diagnostics.

The UI calls `store.transact` for every mutation, computes the camera-selected plane with tie/hysteresis and freezes it for strokes, and cancels previews on pointercancel/Escape.
