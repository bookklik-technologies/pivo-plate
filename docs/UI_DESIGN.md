# Desktop UI refinement

The interface stays a desktop modeling workspace: the 3D scene remains the primary surface, with a fixed tool rail, right inspector and concise status bar. The original graphite palette and locally bundled Lucide icons are retained.

## Sizing system

- Spacing tokens: 4, 8, 12, 16 and 24 pixels.
- Standard buttons, number fields and selects: 32-pixel height.
- Tool rail targets: 36×36 pixels inside a 54-pixel rail.
- Header: 48 pixels; sidebar tabs: at least 42 pixels; status bar: 30 pixels.
- Sidebar: 344 pixels on wider desktop screens; 320 pixels below 1180-pixel width.
- Panel gutters: 16 pixels. Section dividers and 20-pixel section rhythm clarify groups.
- Icon-only scene controls: 28-pixel targets; header icon buttons: 32 pixels.

## Organization

Translation, rotation and scale have separate titled groups. Each group places its fields next to its matching action. Rotation has a styled axis selector and degree field; scales start at 1 and translation values at 0. This makes defaults visible without changing their previous effective values.

Atlas tile width/height, margin and spacing use a two-column labeled grid. The atlas canvas adapts between 200 and 260 pixels high, preserving pixelated rendering and its interaction mapping. Grouping and parent controls in the scene panel have distinct spacing.

Menu labels have their own flex item, separate from icon and shortcut, so left alignment no longer depends on anonymous text layout. The document status moves to the header's right edge. Crosshair fields have their own HUD row; long history labels are visually truncated rather than overlapping controls.

## Narrow windows

Below 880 pixels the sidebar uses an explicit visible/hidden overlay. Its toggle sits outside the open panel so it does not cover tabs. Sidebar pages scroll independently, hidden panels do not create horizontal page overflow, and compact-window status text prioritizes editing information. The application uses dynamic viewport height and reduced-motion preferences are respected.

## Verification

The layout regression checks all three tabs at 1920×1080, 1440×900, 1366×768, 1024×768, 900×700, 760×640 and 600×700: 21 combinations. It checks horizontal containment, text clipping and button target sizes. Screenshots of desktop panels were inspected. The existing 192 automated tests and 33 editing/file/browser checks also pass after reorganization.

Run npm run test:layout for repeatable checks; the script starts Vite on port 4177 and uses the same local Chromium environment as the browser regressions. It writes test-results/layout-report.json and screenshots. This is desktop/narrow-window QA, not certification of mobile authoring or accessibility conformance.
