# Validation report — PiVo Plate v0.1

Validated 2026-10-09. This records actual execution, not feature-parity certification.

## Results

| Check | Result |
|---|---|
| TypeScript strict typecheck | Passed |
| Vite production build | Passed |
| Self-contained HTML build | Passed |
| Vitest unit/integrity/interoperability tests | 347 passed across 13 files |
| Chromium end-to-end workflow checks | 33 passed, no console errors |
| Targeted modal/recovery/validation browser checks | 15 passed, no console errors |
| Targeted modeling browser checks | 10 passed, no console errors |
| Targeted PNG integrity/budget browser checks | 10 passed, no unexpected errors (rejected uploads log expected errors) |
| Targeted erase/FPS browser checks | 21 passed, no unexpected errors |
| Targeted light/dark theme browser checks | 10 passed, no errors |
| Targeted Outfit typography browser checks | 6 passed, including exact size/weight hierarchy; no external font requests |
| Desktop/responsive panel layout checks | 21 combinations passed; no clipped or undersized controls |
| Independent GLTFLoader with real browser PNG decoding | Passed |
| Independent OBJLoader / MTLLoader structure tests | Passed |
| Published embedded preview render | v11 automated health passed: no console errors or failed requests; refined Outfit role sizes/weights manually confirmed |
| Published preview interactive camera and Props panel | Confirmed |

Environment: Node 24.14.1; Chromium 156.0.8078.4; Playwright 1.64.0. Browser tests use a 1440×900 viewport and software WebGL (ANGLE/SwiftShader), with a 760×640 narrow-layout check. These results do not imply Firefox/Safari qualification or a physical-GPU performance guarantee.

## Outfit typography update

Outfit Variable is now the shared main UI sans-serif. Both WOFF2 subsets are locally bundled/embedded, with OFL notices. Technical monospace fields/readouts stay unchanged. Six browser checks verify actual font-face loading across used weights, light/dark text containment, exact type-role sizes/weights, menu/Help behavior and absence of external font requests. Screenshots were inspected and all 21 layout combinations pass. See TYPOGRAPHY.md.

## Light/dark theme update

Light appearance is available from the header and View menu; dark remains the default. Chrome/native control palettes, atlas checkerboards/overlays, viewport background/grid/crosshair and selection colors follow the preference without changing model/texture/camera/history. Local preference read/write denial is nonfatal. Six preference tests and two icon mappings plus ten native browser checks pass, including ordinary-origin reload, light editing/undo, light modal safety and measured selected-text contrast. See THEMES.md for scope and qualification limits.

## Erase/FPS update

Drag erasing now previews without document mutation and commits one undoable transaction on release; hidden/locked faces are protected, cancellation restores geometry, and plain right-drag panning remains intact. The empty FPS chip now reports measured visible rendered-frame intervals with warming/paused/unavailable states. Nine frame-meter checks plus the Eraser icon mapping and 21 new browser checks pass. See ERASE_HUD.md for sampling bounds and non-benchmark caveats.

## PNG validation update

The shared PNG integrity/dimension policy now runs through all data paths. Seventy-nine dedicated tests and ten native-browser workflows cover legal formats/Adam7, corruption, missing/misordered data, zlib/Adler completion, palette/filter/scanline rules, metadata spoofing, decompression/resource caps and protected invalid recovery. Positive fixtures now contain matching actual dimensions. See PNG_VALIDATION.md for hard budgets, supported static formats and explicitly qualified limits.

## Modeling remediation update

The five requested modeling findings now have regressions: Apply Brush entry points, sidebar camera framing, deferred first-visible atlas fitting, explicit plane shortcut tooltips, and shared area-weighted per-corner normals across viewport/OBJ/GLB. See MODELING_FIXES.md. Eleven new automated geometry/interchange checks and ten targeted browser workflows pass alongside prior safety and editing suites.

## Safety remediation update

The P0 modal/recovery and P1 validation/loading findings now have targeted regressions. See SAFETY_FIXES.md for implementation scope, protective IndexedDB slot semantics, canonical transaction/codec invariants, the 128-edge hierarchy cap, and defects intentionally left open. Fifteen additional native-browser checks cover modal isolation, recovery preservation/confirmation, rollback, invalid backups and actual deep-file rejection. Forty-seven new core tests cover shared validation, atomic publication, async callback rejection, normalization and hierarchy limits.

## Lucide UI update

The official lucide 1.54.0 package supplies 38 named icon nodes through a shared SVG adapter. Handwritten toolbar paths and Unicode control symbols were replaced. Lucide icons are rendered locally in the toolbar, scene eye/lock/delete controls, menus, sidebar tabs, import/group actions, edit tools, help and dismiss controls. The original brand mark remains unchanged. SVGs are decorative with aria-hidden and currentColor; containing buttons retain their accessible names, tooltips, keyboard shortcuts and listeners.

Added 40 automated icon-node/semantic mapping checks and two browser checks for SVG rendering, accessibility, menus and dynamic visibility controls. The build tree-shakes named imports; no Lucide CDN requests are made. Full Lucide ISC and upstream Feather MIT notices are included in the source and standalone HTML.

## Browser workflow coverage

Boot/original sample; locally rendered Lucide controls and accessible labels; dynamic visibility and menu icon interactions; camera projections; new documents with and without an atlas; stable session references after replacement; construction-plane lock and numeric crosshair; PNG import and non-square region selection; one-command tile drawing and continuous snapped strokes; undo/redo; Escape and pointercancel; face selection and numeric transforms; UV flip and reversed faces; one-corner editing; native move gizmo commit and canceled drag; multi-face clipboard spacing; box selection; right-click erasing; selected-face grouping and reparenting; ancestor locks; real GLB textures; fractional alpha export; project round trip; actual browser project download and dirty marker; safe invalid load; valid reload; asynchronous IndexedDB recovery; narrow layout; large-scene geometry lifecycle; and explicit storage-unavailable fallback.

The scripts create reports in test-results when run. Snapshots of the final structured reports are included beside this document as browser-report.json, stress-report.json, layout-report.json, safety-report.json, modeling-report.json, png-report.json, erase-hud-report.json and theme-report.json and font-report.json.

## Large-scene smoke measurement

A generated 100×100 ground plane (10,000 textured quads) rebuilt in approximately 331.9 ms in the theme regression run, which validates edits atomically and computes per-corner normals. Two earlier runs measured about 79.5 and 100.4 ms. The renderer used 7 draw calls and reported 40,004 submitted triangles (double-sided transparent rendering can submit both faces). After five edits and rebuilds, live renderer geometry count remained 5 and texture count remained 3.

This is a scene-load and resource-lifecycle smoke test, not an FPS benchmark. Camera/navigation FPS, latency on a reference physical GPU, sustained heap growth, and rigorous large-scene picking profiling have not been certified. The proposed roughly 30-FPS desktop goal remains an optimization/qualification target.

## Fixes made during integration

- Canonical validation accidentally returned undefined instead of embedded texture data; preserved data URLs and added full-document equality regression.
- Core selection transforms originally ignored selected faces; now expand and deduplicate all four corners.
- New/Open replaced the session object without updating panel references; session identity is now retained.
- New demo documents duplicated an atlas; new documents are now initialized independently.
- Save incorrectly cleared recovery storage without downloading; Save now produces a portable project file.
- Context menus closed on pointerdown before click; popup event propagation is isolated.
- Properties selection buttons were unbound; wired to their actual editor operations.
- Lock/visibility filtering now applies to rendering, picking, UV translation, paste and strokes.
- Clipboard offsets used a separate center per tile; use a shared center to preserve layouts.
- Rectangular UV rotations were geometrically rotating normalized rectangles into neighbors; rotate corner assignments instead.
- PNG upload orientation and glTF V coordinates now use the correct format-specific conversions.
- Stroke interpolation snaps every interpolated stamp; coincident geometry stamps are not duplicated.
- Canceled gizmo previews rebuild the original scene; face transforms and canceled drags have browser regression coverage.
- ZIP entry counts, paths and decompressed-size budgets are checked before decompression allocations.
- Export rejects zero-area triangles rather than inventing a normal.
- A malformed test PNG encoder was corrected; actual browser image decoding is now checked independently.
- Embedded preview storage denial is an expected capability limitation, shown as No autosave rather than a boot error. The application does not attempt to bypass the restriction.

## Remaining limitations and QA gaps

- The full planned feature set is not implemented yet. Deferred features are listed in README.
- Chromium-only automated coverage; Firefox/Safari and touch/pointer-device combinations still need testing.
- Native rotation/scale gizmo behavior is implemented using Three.js controls and core transform tests, but the end-to-end drag regression specifically covers translation and cancellation.
- Objects are organizational; exports flatten the scene. No native reference-project compatibility or third-party mesh import.
- V1 project format rejects unsupported versions; migrations for future schema versions are not implemented.
- Snapshot history and full scene rebuilds are correctness-first and O(document size).
- PNG validation now checks full bounded image/chunk/CRC/zlib/scanline integrity and actual dimensions across all data paths. It is not a formal security audit, complete ICC semantic validator or cryptographic authenticity guarantee; see PNG_VALIDATION.md.
- OBJ transparency interoperability depends on importing tools; GLB texture decoding is verified in a real browser.
- Sandboxed embedded previews may restrict storage/downloads. Use the standalone app on a normal origin for full local-file workflows.
- The main bundle is about 715 kB uncompressed (about 195 kB gzip), largely rendering/controls. Vite emits its advisory 500-kB chunk warning; this is not a build failure.

No test coverage percentage, cross-browser compatibility percentage, legal clearance, or complete reference-feature equivalence is claimed.
