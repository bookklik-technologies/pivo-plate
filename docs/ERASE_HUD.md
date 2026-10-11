# Undoable drag erase and measured FPS HUD

## Gestures

- B or the Lucide Eraser rail button enables erase in Draw mode; left-drag previews deleted faces.
- D or the Draw button returns to drawing.
- Shift+right-drag in Draw mode performs a temporary erase stroke.
- Plain right-drag still pans. Plain right-click still erases one face as before.
- Escape or pointer cancellation discards a pending stroke. Mode/camera/framing changes, document/history changes, modal opening, hidden-page/focus loss also cancel safely.

Every erase stroke accumulates unique targeted face IDs without modifying the document. The viewport/picking batch temporarily omits them to show the preview. On release, one labeled transaction deletes the editable targets and one undo restores the whole stroke. Locks are checked during picking and again at commit; hidden faces are not picked. Empty strokes are omitted by the transaction's no-op policy. Deleted IDs are removed from selection; canceled previews restore the original render batch.

Screen-space interpolation samples roughly every 3 CSS pixels, capped at 512 samples per pointer event to bound work. This prevents the tested sparse-pointer gaps but is not a mathematical continuous-surface guarantee for subpixel/thin geometry or arbitrarily large jumps. Preview rebuilds occur only when the target set changes. History remains correctness-first snapshot-based; very large scenes still require performance qualification.

Shift+RMB pointerdown is handled in capture phase before OrbitControls, so an erase gesture cannot latch a camera pan. Pointer capture keeps left/modified-right gestures coherent across canvas boundaries. Ordinary camera gestures remain unchanged.

## FPS HUD

The empty chip now displays a measured visible rendered-frame rate and mean interval. FrameMeter uses actual requestAnimationFrame timestamps over windows of about 1 second, counts distinct intervals and derives FPS = intervals × 1000 / elapsed milliseconds. No fixed 60 FPS or fabricated timer value is displayed.

The first window says FPS measuring. Hidden pages say FPS paused and reset the window; resumed pages warm up again rather than including the hidden time gap. WebGL initialization/context loss says FPS unavailable. Low rates retain one decimal. Updates are throttled to measurement windows rather than rebuilding editor panels on every frame.

This is RAF/visible rendering telemetry including scheduling and CPU work, not a GPU timer, physical-device benchmark, or frame-rate guarantee. The renderer still runs continuously while visible; demand-only rendering is separate work. Listener/subscription cleanup is included in viewport disposal.

## Verification

- 339 automated tests pass across 12 files, including nine frame-meter checks and official Eraser icon mapping.
- 21 new browser checks cover tool toggles, one-step erase preview/commit, undo/redo, sparse events, cancel, ancestors' locks, hidden geometry, plain pan/click compatibility, mode/history/modal/focus cancellation, stable live GPU geometry across repeated canceled previews, actual measured FPS, visibility reset and unavailable WebGL.
- Existing 33 workflow, 15 safety, 10 modeling, 10 PNG and 21 layout checks pass.
- Strict typecheck and production/standalone builds pass.

Run npm run test:erase-hud; its Vite server uses strict port 4184 and its browser/server are closed afterward. Results are copied to docs/erase-hud-report.json when packaging.

## Scope

This resolves audit A12's unreachable drag-erase path and empty HUD. The full 3D modeling feature set, touch/pen authoring, adjustable erase radius, direct UV authoring, animation, linked instances, cross-browser QA and broader performance optimization remain separate milestones. Project geometry/PNG formats are unchanged.
