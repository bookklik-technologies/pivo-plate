# Production readiness — 13 October 2026

This release hardens the existing local-first editor. Artwork stays on the device; app assets load from the hosting origin. Browser recovery is separate from downloaded native projects.

## Headerless browser embedding and recovery opt-out - 31 October 2026

Load the full editor with `?embed=1` to hide the suite header, reclaim its layout space, and disable browser recovery. Document/mode tabs, toolbars, panels, canvas, timeline where applicable, and status UI remain mounted. The header DOM stays available internally for existing command wiring but is not visible or focusable. Use `?recovery=off` when the header should remain visible. See [browser embedding options](npm.md#browser-embedding-and-recovery-options).

Disabled recovery performs no startup lookup, migration, automatic save, or recovery deletion; existing copies remain untouched. Embedded mode overrides an explicit recovery=on. Unsaved-change warnings stay active, and updates cannot reload unsaved documents without downloaded backups. Other browser preferences and PWA asset caching are unaffected. The headless SDK remains separate and never needs either URL flag.

With the user's unit-test authorization, 399 unit tests pass for this project. Application/PWA, standalone, documentation, portable SDK/declaration builds, isolated Node/NodeNext consumers, and shared-suite manifests also pass. The new `npm run test:embed` passes eight Chromium cases per project (24 across the suite): normal, recovery-disabled, direct embedded, and actual iframe-hosted modes at 1280x800 and 640x480. Checks cover header visibility and spacing, visible editor canvases, native saving via Ctrl+S, no page errors, and no recovery IndexedDB or legacy recovery-key access while disabled. Desktop and compact screenshots were inspected. Firefox/WebKit and the full legacy browser matrix were not rerun for this feature. Existing dependency-release blockers documented below remain unchanged.

## Hardening and embedding follow-up - 31 October 2026

Standalone packaging and browser readiness scripts now derive the unscoped application name from the scoped npm name. This restores the documented standalone filename (and Craft's legacy standalone.html alias), PWA fallback exclusions, and app-specific browser validation branches. Standalone packaging and shared-suite manifest checks pass; browser assertions were not executed.

The root/headless SDK now exposes an isolated `createHeadlessEditor` adapter for custom browser UIs and Node jobs. Seed documents, snapshots, and transaction drafts do not alias internal state. Mutations are synchronous, validated, atomic, and non-reentrant. See [embedding contracts and examples](npm.md#embed-with-a-custom-ui-or-no-ui). The adapter does not mount the editor or provide implicit persistence, rendering, workers, or undo history.

Native archive loading checks central/local ZIP directory consistency, rejects multipart/encrypted/unsupported entries and duplicate paths, and verifies the actual decoded size and CRC of every member, including project.json. The dependency audit also fails closed on unexpected report schemas.

All projects pin the build-tool dependencies glob 14.0.3 and minimatch 11.0.1, with regenerated lockfiles. The current npm audit reports zero moderate/high/critical findings, but still reports four low-severity findings from deepmerge 4.3.1 and its PWA-tooling chain. No patched deepmerge release was available from the registry during this work. check:dependencies and therefore release:check/prepublishOnly remain blocked by these low-severity findings. No exception was added and the release gate was not weakened. Resolve the upstream dependency or obtain an explicitly reviewed, time-bounded policy exception before release. Runtime-only dependency audits are separate from this development-tool release gate.

Validation for this follow-up uses application/PWA builds, documentation builds, portable library/declaration builds, package inventory checks, and isolated production-only Node/strict NodeNext consumer checks. The consumer checks exercise the embedding adapter without DOM globals. With explicit user permission on 31 October 2026, the full unit suite passed: 375 tests in 17 files, including the new hardening and embedding regressions. Historical browser counts below do not validate these changes; browser, standalone, worker, and real-device regressions remain release checks to complete. Nothing was committed, published, or deployed as part of this follow-up. The first unit run exposed three diagnostic-message regressions in the ZIP preflight; these were fixed by separating disallowed paths, duplicate entries, and excessive entry counts without relaxing archive validation. The targeted 38-test archive run and the subsequent full suite both passed.

## Release gate

This commit includes the readiness implementation and UI follow-ups. It has not been deployed; the source fingerprint below identifies the validated snapshot. For this implementation, explicit user permission authorized unit execution: all 354 tests passed. Future unit execution requires permission or manual workflow dispatch. Pushes to main automatically run the release workflow, which checks out one exact commit and runs builds, dependency checks and browser checks before publishing that same artifact. Unit validation runs only when the release workflow or Manual unit validation is manually dispatched. Push and pull-request workflows never execute unit tests.

## Recovery and compatibility

Recovery v2 uses IndexedDB with a unique ID per live browser session. Legacy data is copied durably before a Restore/Discard decision removes the original. Invalid recovery remains downloadable. Discard compares the selected record against the current stored record before deletion. Copies do not expire automatically; File → Recovery manages older sessions explicitly.

Native project format version 1 remains unchanged. Recovery writes are serialized, and feedback reflects the stored snapshot. Visibility changes request a best-effort flush; closing/crashing a browser cannot guarantee an asynchronous write finishes. Download an editable project backup regularly. Storage denial/quota errors must preserve editing and native downloads.

## Browser support and storage limits

Target browsers are current desktop Chrome, Edge, Firefox and Safari. Windows Chromium/Firefox/WebKit were exercised; actual Edge/Safari installations still require release smoke checks.

Plate caps compressed native archives at 96 MiB, total decompression at 128 MiB and archive entries at 4,096. PNG imports are capped at 32 MiB, 16,384 pixels per dimension and 16,777,216 pixels total. History has a 64-entry limit and an estimated 128 MiB budget. History keeps at least the newest complete undo transaction, so one unusually large transaction can exceed its nominal byte budget. IndexedDB quota is browser/origin-dependent and can be denied or cleared; there is no fixed recovery quota guarantee. Stored copies are never silently evicted. Use File → Recovery to download and explicitly discard obsolete copies. Use Save project to keep `.pvc`, `.pvo` or `.pvp` backups outside browser storage.

## Runtime and packaging

File operations use bounded worker jobs; cancellation terminates the job without replacing the document. Hosted assets are split from worker/export code. Standalone HTML embeds code, fonts, and workers, disables PWA registration, and supports file:// native downloads. Graphics failures retain native-file controls. WebGL recovery cancels unfinished gestures and rebuilds the viewport.

PWA updates wait for an explicit decision in each tab and a successful recovery flush. Editing is briefly locked during that flush and worker activation, so new edits cannot escape the stored snapshot. Accepting an update in another tab never forces this tab to reload. Active gestures, dialogs and exports defer updates. Application assets are cached; documentation is online-only. Standalone HTML and documentation routes are excluded from the app navigation fallback.

## Dependency policy (updated 27 October 2026)

The npm SDK release replaces the historical documentation-server exceptions with a zero-advisory gate. VitePress 1.6.4 uses an explicit nested Vite 6.4.5 override; fast-uri and serialize-javascript are pinned to patched transitive versions in the root overrides. Browser and documentation builds were checked with these resolutions. `npm run check:dependencies` rejects any reported advisory and runs npm without shell interpolation. See the [npm guide](npm.md) for package preparation and manual publication.

## Validation limits

Chromium represents Chrome/Edge engine coverage; Playwright WebKit is engine coverage, not certification on an actual macOS Safari installation. Current browser checks cover native round trips, malformed input, export signatures, compact layouts, menus, offline reload, deferred/accepted updates across tabs, invalid recovery backups, separate sessions, denied storage, quota exhaustion and aborted recovery writes. Craft/Plate also cover edits during saves and undo back to saved content; Ortho/Plate cover WebGL context loss/restoration with native backups available. Standalone native downloads were checked in all three engines. Full screen-reader conformance, native 200% browser zoom, hardware performance certification and full feature/export semantics remain release checks; historical tests are not current evidence.

The currently deployed public service worker and its precached assets were captured with SHA-256 hashes. An isolated bootstrap client verifies that the new worker stays waiting while the predecessor controls a live client, then activates after closure and preserves legacy recovery bytes plus native downloads. This passed in Chromium, Firefox and WebKit. It covers the exact deployed worker lifecycle; the entire historical editor UI and every previously installed release are not certified. No live deployment occurred.

The bootstrap is served under the existing docs navigation exclusion so it stays isolated from the editor. It waits for activation, then navigates to a precached icon to acquire a controlled client without starting the predecessor editor, even when the predecessor does not claim its first client. Changed workers must remain waiting until the controlled client closes; an uncontrolled observer waits for activation instead of relying on a fixed delay. Byte-identical workers exercise recovery and native downloads without expecting a replacement worker. The report records worker hashes, whether the worker changed, and the failing lifecycle stage plus browser errors when a check fails.

## Release and rollback

Automated pushes to main validate and deploy once; the separate readiness workflow runs on pull requests or manual dispatch, not again on main pushes. Browser jobs are pinned to Ubuntu 24.04 and default to Chromium headless-shell-only installation and execution (`PIVO_BROWSERS=chromium`). Enable `full_browser_validation` when manually dispatching readiness or release to include Firefox and WebKit. Manual browser validation does not authorize unit tests; release units require the separate `run_unit_tests` opt-in, or use Manual unit validation. Local browser scripts still default to all three engines when `PIVO_BROWSERS` is unset. npm package validation remains unchanged and browser-free.

1. Review and commit the changes, including lockfiles, shared manifests and this report.
2. Explicitly run unit validation or dispatch Manual unit validation at that commit. The working-tree pass below does not certify a later commit.
3. Run `npm run build`, `npm run docs:build`, `npm run build:standalone`, `npm run check:suite`, `npm run check:dependencies`, and `npm run test:release`, and `npm run test:standalone`. Browser checks require `npx playwright install chromium firefox webkit`.
4. Push the release commit to main to deploy automatically. To also run unit validation, explicitly dispatch the release workflow on main with `run_unit_tests` enabled. It validates the triggering SHA, captures the deployed predecessor with `npm run capture:predecessor`, runs `npm run test:upgrade`, and packages that same SHA. Deployment depends on all applicable validation passing. Predecessor capture reads public app assets; the browser tests use isolated local profiles.
5. Smoke-check the hosted app/docs, an installed PWA update, and an editable backup after release. To roll back, restore the known-good app commit and dispatch its release pipeline. Keep recovery v2 readable or download backups before returning to a build that only reads legacy storage; never delete databases during rollback.

## Repository findings

P1 denotes high severity (artwork/recovery risk); P2 denotes moderate severity (runtime, budget or contract reliability). Listed remediations are implemented and validated unless a limitation is stated above.

| Priority | Finding / reproduction | Remediation | Source |
|---|---|---|---|
| P1 | Startup edits mark an autosave revision before storage is ready; retry skips it | Pending-dirty revision retry; each session saves independently while old copies remain protected | src/main.ts; src/io/project.ts |
| P1 | A failed startup migration stays cached; retry cannot proceed | Rejected migration initialization resets; transaction emulator verifies storage restoration, quota and abort retries | src/io/project.ts; tests/ioProject.test.ts |
| P1 | Edits during worker save can leave a stale saved marker or recovery | Mark the captured download snapshot as saved and recover the current document; undo returns to clean | src/main.ts; src/core/editor.ts; tests/readiness.test.ts |
| P1 | Multiple tabs share the current recovery slot | v2 per-session copies and conditional explicit legacy resolution | src/io/project.ts; src/ui/suite-recovery.ts |
| P2 | Three theme tests assume dark default despite shared system-theme contract | Tests cover system light/dark, explicit overrides and denied storage | tests/theme.test.ts |
| P2 | History caps snapshots by count only | 128 MiB byte budget with cached snapshot costs and whole-transaction eviction | src/core/editor.ts |
| P2 | ZIP and export work blocks UI; worker alpha APIs differ across engines | Cancellable worker archive/export jobs; bounded main-page alpha probe preserves GLB BLEND/cutout behavior in WebKit | src/io/archive.ts; src/io/export.ts; src/io/alpha.ts |
| P2 | Graphics context restoration leaves viewport disabled | Cancel transient stroke; rebuild scene/grid and request drawing after restore | src/ui/viewport.ts |
| P1 | Accept an update in one tab while another has unsaved edits | Per-tab reload consent; editing lock during accepting-tab recovery and activation; file worker code retained before cache replacement | src/ui/suite-pwa.ts; src/ui/suite-worker.ts |

## Verification record

The verification commit is pending review/commit. The base commit identifies the audited starting point; the fingerprint identifies current source bytes. The SHA-256 fingerprint hashes sorted Git-tracked/nonignored source paths plus file bytes, excluding this report and its self-referential JSON record. Generated builds and browser artifacts are ignored. Run the manual release gate again for the final committed SHA.

```json
{
  "baseCommit": "9ec3f5f15500ebf48b3e77ded080a8ce870fb475",
  "verificationTarget": "Validated source snapshot identified by workingTreeSha256; validation preceded the commit containing this record.",
  "version": "0.1.1",
  "unitTests": {
    "passed": 354,
    "failed": 0,
    "authorization": "explicit user approval for this implementation",
    "scope": "Prior production-readiness implementation; units were not rerun for subsequent worker, header, menu/About or shortcut/backdrop follow-ups."
  },
  "browserResults": {
    "chromium": {
      "passed": 16,
      "failed": 0
    },
    "firefox": {
      "passed": 16,
      "failed": 0
    },
    "webkit": {
      "passed": 16,
      "failed": 0
    }
  },
  "standalone": "Native backup, About documentation URL, shortcut reference and common backdrop passed in Chromium, Firefox and WebKit",
  "independentOutputChecks": 4,
  "applicationBuild": "passed",
  "documentationBuild": "passed",
  "sharedCopies": "verified",
  "workingTreeSha256": "e88ebd9e5eaf2f73700313ea3bcd84fd144126b7791f1f4e57e8d31904e1fe96",
  "deployedWorkerUpgrade": {
    "passed": 3,
    "failed": 0,
    "origin": "https://bookklik-technologies.github.io/pivo-plate/",
    "serviceWorkerSha256": "9820ec6204573d2ac54c073e4aead92f635743eb9d042c28dd4bc53743848b7f"
  },
  "dependencies": {
    "blocking": 0,
    "buildOnlyAdvisories": 3,
    "exception": "VitePress nested development-server path; static documentation build only"
  },
  "verificationDate": "2026-10-13",
  "developmentWorkerChecks": {
    "passed": 3,
    "failed": 0,
    "coverage": "Vite dev autosave and native save/open in Chromium, Firefox and WebKit; Craft also checks identical error suppression."
  },
  "headerChecks": {
    "passed": 6,
    "failed": 0,
    "engines": [
      "chromium",
      "firefox",
      "webkit"
    ],
    "widths": [
      1100,
      500
    ],
    "coverage": "Docs placement and keyboard navigation; Outfit menu weight 400 and normal letter spacing; documentation link opens the hosted docs subpath.",
    "scope": "Earlier header check; header Docs placement superseded by the menu/About follow-up."
  },
  "sharedSuiteVersion": "1.3.0",
  "menuAboutChecks": {
    "passed": 12,
    "failed": 0,
    "coverage": "Shared menus, light/dark desktop/compact presentation, keyboard navigation/focus, documentation inside About; Ortho also covers missing graphics."
  },
  "shortcutBackdropChecks": {
    "passed": 15,
    "failed": 0,
    "coverage": "Shortcut layout, readable Ctrl/Cmd labels, compact/desktop light/dark layouts, fixed header/footer, scrolling, focus, unobstructed Close actions and common About/export/shortcut backdrops in Chromium, Firefox and WebKit; Craft also covers binding validation/apply/cancel/import/export/reset."
  }
}
```

Independent current-output inspection passed for PNG/GIF images through Pillow and for ZIP integrity, OBJ indices, glTF buffers and GLB/embedded textures through separate Python readers. This establishes file readability and structural integrity, not complete visual equivalence with every external editor.

`npm run test:browser` now runs the verified production matrix with current menu/export selectors. `test:browser:legacy` preserves the specialized historical runners; they are not a current release gate and their broader UI assertions need a separate refresh before relying on their results.

## Development-worker follow-up — 13 October 2026

Reproduction: run the Vite development server, make an edit and wait for recovery. The shared adapter started Vite's import-containing module code as a classic Blob worker, causing `Cannot use import statement outside a module`. Production and standalone bundles did not expose this failure. Development now starts a module worker from its original Vite URL; bundled workers retain their self-contained Blob path. Craft suppresses identical recovery notifications until a successful write or a different failure.

`npm run test:workers` covers development autosave and native save/open in Chromium, Firefox and WebKit and is included in automatic browser checks. Craft also verifies repeated identical recovery errors do not keep resetting the notification. All six app/engine development checks passed. Unit suites were not rerun for this follow-up; the unit totals above belong to the previously authorized readiness validation.

## Header follow-up — 13 October 2026

Plate appended its Docs link before constructing File/Edit/View/Help, giving it a different position from Craft and Ortho. Legacy menu rules also used font weight 500 and extra body letter spacing, compared with weight 400 and normal spacing in the suite. That earlier header placement is superseded by the menu/About follow-up below. At that stage Docs followed Help; menu typography matches the other editors through Plate's styling adapter. The Docs link has explicit keyboard focus and focused links no longer trigger the canvas Tab shortcut.

Six targeted browser checks passed at desktop/compact widths in Chromium, Firefox and WebKit, including Docs navigation to the hosted documentation subpath, menu dismissal/focus restoration and font loading. Application and standalone builds passed. Unit suites were not rerun for this UI change.

## Menu and About follow-up — 13 October 2026

File/Edit/View/Help now share popup styling, 288-pixel width, 32-pixel rows, font weights, shortcut hints and keyboard behavior. Shared File/View commands appear first; existing editor-specific commands remain in separate sections. Plate's decorative menu icons were removed to match the suite's plain-label presentation. Documentation has moved from the header into each About dialog, which shares title/body/footer styling and one Close action. Escape restores the triggering menu; Tab stays in the About actions. Source references: the vendored `suite.ts`/`suite.css` and each app's menu/About adapter.

All 39 app/browser/layout cases passed (Craft 12, Ortho 15, Plate 12) across Chromium, Firefox and WebKit, including light/dark and compact/desktop layouts. Ortho's additional checks cover About and native backups without graphics: probing before renderer children mount prevents an unavailable WebGL context from hiding the header. All nine standalone app/engine checks passed for native downloads and absolute documentation URLs. Builds and shared manifests pass; units were not rerun for this follow-up. `npm run test:menus` is included in automated browser validation.

## Shortcut and backdrop follow-up — 13 October 2026

Reproduction: open Help → Keyboard shortcuts in each editor. Ortho showed a static table, Craft opened raw editable chords, and Plate combined its own usage tables; titles, spacing, dismissal controls and modal scrims differed. Shared suite 1.3.0 now provides a 640-pixel reference dialog with a fixed header/footer, scrolling body, Document/Editor/Viewport sections, readable key labels, consistent Close action and focus restoration. Ctrl on Windows/Linux becomes Cmd on macOS; established editor-specific tool bindings remain unchanged. Craft retains current binding customization, validation, import/export, defaults and Apply/Cancel behind Customize bindings. All application modal backdrops use rgba(3,8,13,.6) without blur in light and dark appearances, including About and export. Modal overlays also sit above page notifications so compact Close actions cannot be covered by startup tips.

Source references: canonical/vendored `suite.css` and `suite.ts`; Craft `apps/editor/src/workspace-controls.ts`, Ortho `src/ui/dialogs.tsx`, and Plate `src/main.ts`. `scripts/browser-menus.mjs` verifies presentation, actual content bounds, keyboard focus, key notation and matching scrims. Its expanded matrix passes 84 cases overall (Craft 27, Ortho 30, Plate 27); the standalone runner passes nine app/engine cases including the new shortcut reference. Windows WebKit can report scrollWidth including the vertical scrollbar, so clipping is checked against descendant bounds rather than that metric. Application, documentation and standalone builds plus shared manifests pass. Units were not rerun; their recorded totals remain historical readiness evidence.
