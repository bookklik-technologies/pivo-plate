# Modeling audit remediation

Implemented the five requested modeling defects after the safety stabilization. This pass does not add PNG integrity validation, drag erase, topology editing, animation or other reference-parity families.

## A05 — Apply Brush UI

Edit > Apply Brush and the Atlas panel's Apply Brush button now apply the current atlas ID, selected pixel rectangle, rotation and flips to selected editable faces. The action is one undoable transaction and does not change vertex positions. Both entry points disable when there are no editable face selections or no atlas. Locked objects/ancestors are excluded by the core operation. Corner-only selection is not treated as a face brush target.

The menu and atlas action use the same command. Tested both entry points, undo/redo, imported-atlas reassignment, quarter-turn/flip mapping and inherited locking. Direct per-UV vertex authoring and eyedropper tools remain separate future work.

## A07 — Sidebar Frame selection

The previously unwired Props heading icon now calls the actual viewport frameSelection action supplied by its context. The existing tool-rail action remains unchanged. Regression verifies real camera position and orbit target against the selected face center, rather than inferring framing from draw-call counters.

## A08 — Hidden-tab atlas fitting

Image loading marks fitting as pending. Fit-to-view runs only when the correct loaded image and a visible measurable panel are available; subsequent normal tab changes preserve manual zoom/pan. A ResizeObserver redraws the canvas on size changes and satisfies pending fitting when the panel is revealed. A monotonically increasing image request version ignores obsolete image-load callbacks after rapid atlas switches. Removing all atlases clears stale canvas/brush imagery.

Regression imports a real PNG through the hidden file input while Scene is active, checks pending fitting, reveals Atlas, compares the fitted zoom with actual panel/image dimensions and samples a known blue region from canvas pixels. Manual zoom remains unchanged across ordinary tab switches.

## A11 — Plane tooltips

The rail explicitly maps XY to X, XZ to Z and YZ to C, matching actual keyboard handling and Help. Tests assert live tooltip titles and exercise all three keys with plane lock enabled so automatic camera-plane selection cannot mask the result.

## A06 — Nonplanar normals

src/core/geometry.ts now defines tileCornerNormals, used by the indexed viewport batch, OBJ exporter and GLB exporter. Triangulation remains 0,1,2 and 0,2,3. Corners 1 and 3 use the normals of their sole incident triangles; corners 0 and 2 use area-weighted averaging of both incident triangles. There is no smoothing/welding across different tiles. Reversed winding negates every normal. Fully collapsed preview geometry yields finite zero normals; interchange continues to reject degenerate triangles.

For the audited quad [[0,0,0],[1,0,0],[1,1,0],[0,1,1]], corner 3 is now approximately [0.57735,-0.57735,0.57735] rather than [0,0,1]. Ordinary indexed normals match Three.js computeVertexNormals on non-degenerate geometry; canceling/folded shared-face sums use a finite face fallback. Geometry positions, UVs, topology and project files are unchanged by normal calculation.

Tests cover planar, nonplanar, unequal-area, reversed, isolated-neighbor and collapsed geometry; inspect exported OBJ/GLB normals; independently parse OBJ; and independently load textured GLB in a real browser to compare its normal attributes with the actual viewport batch.

## Verification

- 250 automated unit/integrity/interchange/icon/safety tests pass across 10 files.
- 10 modeling-specific browser checks pass.
- 33 existing workflow and 15 safety browser checks pass.
- 21 layout combinations pass.
- Strict typecheck and production/standalone builds pass.

Run npm run test:modeling. It starts Vite on strict port 4182 and closes the local browser/server afterward. Structured results are copied to docs/modeling-report.json when packaging source.

## Remaining limits

The full planned feature set is still absent. PNG integrity and actual-dimension consistency were subsequently hardened; see PNG_VALIDATION.md. Drag erase and measured FPS were subsequently implemented; see ERASE_HUD.md. Other work including direct UV-corner editing, eyedropper behavior, broader model formats, linked instances, animation, rigging, authorable lighting and cross-browser qualification remain future work. Recovery remains best-effort within its documented limits. These successful regressions cover the five requested fixes, not every possible interaction.
