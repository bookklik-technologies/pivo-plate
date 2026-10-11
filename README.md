# PiVo Plate v0.1

A local-first browser tile-to-3D modeling editor. This is a functioning modeling MVP, not a mockup or a complete v1 feature set.

## Delivered

- Framework-free TypeScript UI, Three.js WebGL2 viewport and renderer-independent core.
- Locally bundled Outfit variable font for main UI text; monospace retained for technical values and HUD readouts.
- Locally bundled Lucide icons throughout toolbar, scene controls, menus, tabs and help; no icon CDN.
- Light/dark appearance through the header sun/moon button or View menu, with safe local preference persistence and matching viewport overlays.
- Polished desktop spacing: 32px controls, 36px tool targets, 344px desktop sidebar, grouped transforms and two-column atlas metrics.
- Original procedural pixel-art atlas and 117-tile sample room; import your own local PNGs.
- Atlas pan/zoom, cell/rectangular region picking, tile metrics, brush rotation and flips.
- Undoable drag erase (B + left-drag or Shift+right-drag), preserved right-drag panning, measured FPS/frame-time HUD, crosshair depth and numeric XYZ controls, automatic or locked XY/XZ/YZ construction planes, perspective/orthographic cameras.
- Face/corner selection, box selection, numeric/gizmo move/rotate/scale, independent corner editing, basic UV operations and undoable existing-face Apply Brush through Edit or the Atlas panel.
- Clipboard, duplicate, delete, reverse winding, atomic undo/redo, semantic dirty state.
- Scene objects, selected-face grouping, reparenting, inherited visibility/locking, renaming and confirmed object deletion.
- .pvp ZIP projects with embedded PNG assets, downloadable save/open, IndexedDB autosave with protected pending recovery and guarded restoration.
- Shared atomic document validation, modal keyboard/focus isolation, rejected atlas-setting feedback and a 128-edge hierarchy-depth limit.
- Shared bounded PNG CRC/zlib/scanline validation and actual-dimension checks across import, projects, recovery and export.
- Self-contained textured GLB and OBJ/MTL/PNG ZIP exports, independently tested through standard Three.js loaders.
- Source, lockfile, behavior specification, automated tests and standalone build.

## Run locally

Node.js 20.19+ or 22.12+ is required by Vite 7; this build was validated on Node 24.14.1.

```sh
npm ci
npm run dev
```

Open the local address Vite prints. The app needs a current desktop browser with WebGL2. No backend, account or runtime CDN is required.

```sh
npm test
npm run typecheck
npm run build
npm run build:standalone
npm run preview
```

Serve dist on any static HTTP(S) host. The optional dist/pivo-plate-standalone.html includes all JavaScript and CSS in one file. For predictable storage and downloads, use an ordinary HTTP(S) origin rather than a sandboxed embed or file URL.

### Browser regression tests

```sh
npx playwright install chromium
npm run test:browser
npm run test:layout
npm run test:safety
npm run test:modeling
npm run test:png
npm run test:erase-hud
npm run test:theme
npm run test:font
```

The regression script starts its own Vite server on port 4176 and shuts it down afterward. It launches headless Chromium with software WebGL flags. Reports and captures are written to test-results. No external websites are contacted by the tests. The one-time browser download requires network access on your machine.

## First workflow

1. The original sample room opens by default. File > New (demo tileset) starts an empty scene with an atlas; New (empty) has no atlas.
2. Choose a tile in the Atlas tab. Wheel zooms the sheet; middle-drag pans; drag a rectangle to choose multiple cells.
3. Use Props or the viewport chips to choose XZ ground / XY wall / YZ wall and lock the plane. Crosshair XYZ inputs place the plane precisely.
4. Left-click/drag draws a tile stroke. B enables left-drag erasing; D returns to drawing. Shift+right-drag also erases in Draw mode. Release commits one undo step; Escape cancels. Plain right-click erases one face; middle-drag orbits, plain right-drag pans, wheel zooms.
5. Tab toggles Draw/Edit. Click to select a face; Shift adds; drag a box to select. Enable vertex mode to pick corners.
6. Props offers gizmos, numeric transforms, reverse faces and UV rotate/flip/offset controls. Choose an atlas region, select faces, then use Edit > Apply Brush or the Atlas panel's Apply Brush button to reassign their texture/UVs in one undoable step.
7. Scene > Group selected organizes selected faces. Choose a parent, rename by double-clicking, and use eye/lock controls. Grouping never changes world coordinates.
8. Ctrl/Cmd+S downloads a .pvp project. File > Open reloads it. GLB/OBJ exports are also in File. Browser recovery is optional and is not a substitute for downloadable backups.

The Shortcuts button contains the complete active shortcut list. Text controls retain ordinary editing shortcuts.

## Project layout

- src/core/types.ts — original document/session schema.
- src/core/editor.ts — geometry, UVs, selection, hierarchy, validation and history.
- src/io — ZIP project storage, IndexedDB, OBJ/glTF exporters, alpha inspection and integrity guards.
- src/ui — viewport, atlas/scene/properties panels and original demo assets.
- src/main.ts — shell, orchestration, file workflows, shortcuts and diagnostic hooks.
- tests — unit, archive, independent loader, integration and browser regressions.
- docs/VALIDATION.md — actual verification results and remaining coverage gaps.
- docs/SAFETY_FIXES.md — targeted safety/validation audit remediation.
- docs/MODELING_FIXES.md — brush, framing, atlas, tooltip and normal fixes.
- docs/PNG_VALIDATION.md — shared PNG integrity policy, actual-dimension checks, budgets and compatibility restrictions.
- docs/ERASE_HUD.md — erase gestures, cancellation and measured FPS policy.
- docs/THEMES.md — light/dark appearance and preference behavior.
- docs/TYPOGRAPHY.md — bundled Outfit font, coverage and technical-monospace policy.

## Important limits

This is a desktop-first v0.1 modeling editor. Painting, linked prefabs/instances, animation/timelines, rigging, advanced mesh cuts, imported third-party models, FBX/DAE and movie rendering are not implemented. Third-party native file formats are not supported. No cloud collaboration or mobile authoring is promised.

Object hierarchies are limited to 128 ancestor edges. UVs committed to a document use the 0..1 range (1e-6 drift tolerance); atlas IDs must be ZIP-safe. Invalid transactions and replacements are rejected without changing the current project.

Quads have four independent corners and two triangles; no implicit welding. Objects are organizational, with baked world coordinates, not local transform nodes. Export hierarchy is flattened. V1 project files reject future versions; automatic version migrations are not yet needed or implemented.

Undo snapshots are bounded to 64 and are O(document size). The viewport batches geometry by atlas but rebuilds on edits. A 10,000-tile smoke/stability check passed; no 30-FPS hardware guarantee is made. Chromium is validated; Firefox/Safari need a manual QA pass.

Static PNG input is capped at 32 MiB, 16384 pixels per dimension and 16,777,216 pixels total. APNG is rejected explicitly. Projects additionally cap aggregate PNG bytes at 64 MiB, pixels at 33,554,432, scanline output at 192 MiB and JSON manifests at 24 MiB. Every atlas must match actual validated IHDR dimensions; malformed chunks/CRCs/streams are rejected consistently. Project containers have 96 MB compressed / 128 MB decompressed safety caps. In-browser GLB export detects fractional alpha and uses BLEND; cutouts use MASK. Headless GLB exports use the documented MASK default unless a probe is supplied. OBJ transparency depends on the importing application's MTL/PNG support.

The embedded preview may have different download or storage restrictions than a normal deployed app. The source app makes no runtime network requests.

## Licensing

The PiVo Plate source is released under the MIT License — see LICENSE. Third-party dependency licenses remain applicable and are documented in THIRD_PARTY_NOTICES.md.
