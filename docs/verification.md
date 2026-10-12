# Verification

Actual verification results live in [docs/VALIDATION.md](/VALIDATION); targeted remediation records are in [SAFETY_FIXES.md](/SAFETY_FIXES) and [MODELING_FIXES.md](/MODELING_FIXES).

## Test layers

| Layer | Command | Notes |
| --- | --- | --- |
| Unit/archive/loader/integration | `npm test` | Includes independent Three.js loader acceptance of exports |
| Coverage | `npm run test:coverage` | — |
| End-to-end regression | `npm run test:browser` | Starts its own Vite server on port 4176, launches headless Chromium with software WebGL flags |
| Focused regressions | `test:layout`, `test:safety`, `test:modeling`, `test:png`, `test:erase-hud`, `test:theme`, `test:font` | Layout checks, safety/validation audit, modeling flows, PNG integrity, erase gestures + FPS HUD, theming, bundled font |

Reports and captures are written to `test-results/` (with `docs/*-report.json` copies). No external websites are contacted by the tests.

## Stability evidence

- A **10,000-tile smoke/stability check passed**; no 30-FPS hardware guarantee is made.
- GLB and OBJ/MTL/PNG ZIP exports are independently tested through standard Three.js loaders.
- Shared bounded PNG CRC/zlib/scanline validation and actual-dimension checks run across import, projects, recovery and export — see [PNG_VALIDATION.md](/PNG_VALIDATION).

## Platform

**Chromium is validated; Firefox/Safari need a manual QA pass.** Regression scripts run headless Chromium with software WebGL flags.

## Embedded contexts

The embedded preview may have different download or storage restrictions than a normal deployed app. The source app makes no runtime network requests.
