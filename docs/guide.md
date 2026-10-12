# User guide

New to the app? Start with the [Beginner tutorials](/tutorials/) for step-by-step projects, screenshots, and editable checkpoints.

PiVo Plate is a desktop-first tile-to-3D modeling editor. This is a functioning modeling MVP. The Shortcuts button in the app contains the complete active shortcut list.

## First workflow

1. **Start** — the original sample room opens by default. *File → New (demo tileset)* starts an empty scene with an atlas; *New (empty)* has no atlas.
2. **Pick a tile** — in the Atlas tab, wheel zooms the sheet, middle-drag pans, and dragging a rectangle chooses multiple cells.
3. **Choose a construction plane** — use Props or the viewport chips to pick **XZ ground / XY wall / YZ wall** and lock it. Crosshair XYZ inputs place the plane precisely.
4. **Draw** — left-click/drag draws a tile stroke. `B` enables left-drag erasing; `D` returns to drawing. Shift+right-drag also erases in Draw mode. Release commits one undo step; **Escape cancels**. Plain right-click erases one face; middle-drag orbits, plain right-drag pans, wheel zooms.
5. **Select** — `Tab` toggles Draw/Edit. Click to select a face; Shift adds; drag a box to select. Enable vertex mode to pick corners.
6. **Transform & texture** — Props offers gizmos, numeric transforms, reverse faces and UV rotate/flip/offset controls. Choose an atlas region, select faces, then use **Edit → Apply Brush** or the Atlas panel's Apply Brush button to reassign their texture/UVs in one undoable step.
7. **Organize** — *Scene → Group selected* organizes selected faces. Choose a parent, rename by double-clicking, and use eye/lock controls. **Grouping never changes world coordinates.**
8. **Save & export** — Ctrl/Cmd+S downloads a **`.pvp`** project. File → Open reloads it. GLB/OBJ exports are also in File. Browser recovery is optional and is not a substitute for downloadable backups.

## Editing tools

- **Draw mode** — tile strokes on construction planes with snapping; undoable drag erase (`B` + left-drag or Shift+right-drag) with cancellation on unsafe context changes; the HUD shows measured FPS/frame-time states (warming/paused/unavailable) and is not a GPU benchmark.
- **Edit mode** — face/corner selection, box selection, independent corner editing, numeric and gizmo move/rotate/scale, duplicate, delete, clipboard, reverse winding — all with atomic undo/redo and semantic dirty state.
- **Atlas** — pan/zoom, cell/rectangular region picking, tile metrics, brush rotation and flips, brush validation against the atlas, and undoable Apply Brush on existing faces.
- **Scene** — objects, selected-face grouping, reparenting, inherited visibility/locking, renaming and confirmed deletion.

## Cameras

Perspective and orthographic cameras are available. Navigation: middle-drag orbits, plain right-drag pans, wheel zooms.

## Themes & typography

- Light/dark appearance via the header sun/moon button or View menu, with safe local preference persistence and matching viewport overlays (see [THEMES.md](/THEMES)).
- Outfit variable font for main UI text; monospace is retained for technical values and HUD readouts (see [TYPOGRAPHY.md](/TYPOGRAPHY)).
- Lucide icons throughout toolbar, scene controls, menus, tabs and help — no icon CDN.
