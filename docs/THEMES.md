# Light and dark appearance

## Controls

Use the sun/moon button in the header or View > Light theme / Dark theme. Dark remains the default. On an ordinary origin the choice is stored under pivo-plate-theme in localStorage and restored before the shell is built. Invalid/blocked preference reads fall back to dark; denied writes do not prevent switching for the current session. Embedded preview restrictions are respected rather than bypassed.

## Scope

Theme applies to the header, panels, menus, text, controls, native color-scheme, atlas transparency checkerboards, dialogs, warning/error colors, HUD, viewport background/grid/crosshair, hover outlines and selection markers. The light palette uses neutral whites/slate with readable darker green/blue accents. The existing dark theme remains available.

Model textures, lighting, geometry, UVs, camera, project serialization, dirty flags and undo history are not changed. This is an appearance preference, not a document transaction. Changing theme suppresses cross-theme button transitions briefly so controls do not flash through mismatched colors.

The viewport uses a shared theme palette; atlas source pixels are not recolored. Corner markers use per-vertex palette colors without a second base-color tint. Palette application recreates the grid and updates overlays without mutating document entities.

## Verification

- Six preference/palette tests and two official Lucide icon mappings were added; total 347 automated tests pass.
- Ten browser theme checks pass: dark default, light toggle, unchanged project/revision/dirty/camera, measured key-text contrast, all sidebar tabs/fields, light-mode editing/undo, modal styling/safety, reload persistence, View menu current option, denied storage, and screenshots of both appearances.
- Prior 33 workflow, 15 safety, 10 modeling, 10 PNG and 21 erase/HUD browser checks and 21 layout combinations pass.
- Screenshots were visually inspected, including transition-free switching back to dark.

Run npm run test:theme. It starts Vite on strict port 4185 and closes its browser/server after testing. Reports are copied into docs/theme-report.json during source packaging.

Contrast checks cover selected UI text/surfaces, not a complete accessibility certification or a guarantee of contrast against every possible user texture. Firefox/Safari and the full roadmap remain separate qualification work. The preference is not synchronized between tabs/accounts and has no server backend.
