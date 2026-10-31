# PiVo plate: npm and headless SDK

## Installation and runtime

After the first manual publication:

```sh
npm install @bookklik/pivo-plate
```

Node.js 24 or newer. This is an ESM-only package with bundled public TypeScript declarations. CommonJS require and a CLI/--headless switch are not supported; headless means the programmatic SDK below. Use dynamic import from CommonJS if needed. Library consumers do not need Vite, TypeScript loaders, a browser or the editor source tree.

## Public entry points

| Import | API |
| --- | --- |
| `@bookklik/pivo-plate` | Combined portable core and IO |
| `@bookklik/pivo-plate/headless` | Alias of the combined API |
| `@bookklik/pivo-plate/core` | Data types, validation and editing |
| `@bookklik/pivo-plate/io` | Portable serialization/encoding/export |

Only documented entries are public. Source paths, lib chunks and editor internals are not exported. Generated declarations are included for each entry. Browser download/storage helpers are not exported by the SDK.

## Example

```js
import { createProject, decodeProject, encodeProject, exportGLB } from '@bookklik/pivo-plate/headless';
import { readFile, writeFile } from 'node:fs/promises';

const empty = createProject('Tiles');
await writeFile('empty.pvp', await encodeProject(empty));
const project = await decodeProject(new Uint8Array(await readFile('model.pvp')));
await writeFile('model.glb', await exportGLB(project));
```

## Supported headless behavior

Headless support includes project editing, bounded PNG validation, native .pvp save/open and OBJ/GLB model export. Fractional PNG alpha is inspected portably, including indexed transparency, 16-bit samples and Adam7 passes; GLB selects BLEND for fractional alpha and MASK for cutouts. exportGLB(project, alphaModes?) and exportOBJ(project, alphaModes?) accept an optional Map of atlas ID to 'opaque', 'cutout' or 'blend'; default inspection does not need canvas/DOM. Browser autosave, downloads, Vite workers and progress UI are deliberately excluded. Empty projects can be saved but model export needs visible geometry.

Calls do not open windows, start servers, contact remote services or access browser storage. You control filesystem access by reading/writing the returned bytes. Preserve native project files as editable backups. Codec/export validation errors reject invalid or unsupported data; do not ignore thrown errors or rejected promises.

The SDK uses the existing bounded project/PNG/codec validators. Headless calls execute in the caller's thread: Promise-returning APIs do not imply background workers. For untrusted batches, isolate work in your own Node worker/process with memory/time budgets and terminate the worker for cancellation. There is no built-in Node worker/progress adapter. Model capture, browser PWA/recovery, and UI interactions remain editor features, not implicit headless capabilities.

## Browser embedding and recovery options

These URL options apply to the full browser editor and standalone HTML, not the UI-free SDK:

| URL option | Header | Editor workspace | Browser recovery |
| --- | --- | --- | --- |
| No option | Visible | Mounted | Enabled |
| `?recovery=off` | Visible | Mounted | Disabled |
| `?embed=1` | Hidden | Mounted | Disabled |

For example, load `/pivo-plate/?embed=1` directly or as an iframe's `src`. Keep the iframe sized to the space allocated by the host. If the URL already has a query string, append `&embed=1` instead. This is visual embedding, distinct from importing the headless SDK.

Embedded mode hides only `.suite-header` and removes its layout space. Document/mode tabs, context toolbars, side panels, canvas, timeline where applicable, and status UI remain mounted. The hidden header is excluded from layout, accessibility navigation, and keyboard focus; its internal DOM is retained so existing editor command wiring stays intact. Native keyboard shortcuts, including Ctrl/Cmd+S for project downloads, continue to work. This option does not add a cross-origin postMessage/host-control bridge.

`?recovery=off` disables discovery, legacy migration, recovery prompts, background autosaves, and recovery reads/writes/deletions for that page session. It does not erase existing backups. The status strip shows **Browser recovery disabled**. Remove the option and reload to resume normal recovery. `recovery=false` and `recovery=0` are aliases; `embed=true` and `embed=on` enable embedded mode. Embedded mode always disables recovery, even with `recovery=on` in the same URL.

Unsaved-change warnings remain active. PWA updates are blocked while unsaved documents have no recovery copy; download all current projects before updating. Theme, workspace, tutorial preferences, and PWA asset caching are separate features and are not disabled by the recovery flag. This is not a private/incognito or storage-free browsing mode.

The headless SDK already performs no browser recovery lookup or automatic persistence and needs neither URL option. To validate the browser modes after `npm run build`, use `npm run test:embed`; it exercises desktop and compact Chromium layouts, hidden-header spacing, native keyboard saving, and absence of recovery storage access. Set `PIVO_BROWSERS=chromium,firefox,webkit` to run the same checks in all three engines.

## Embed with a custom UI or no UI

The root and `/headless` entries export `createHeadlessEditor` and the `HeadlessEditor` TypeScript interface. Each instance owns an isolated project; it does not mount the editor, touch the DOM/storage, register service workers, start a server, or render a viewport. Use it in your host application's framework or a Node job, with the existing core operations and IO exporters.

```js
import { createHeadlessEditor, createProject } from '@bookklik/pivo-plate/headless';

const editor = createHeadlessEditor(createProject());
editor.transact(draft => {
  draft.name = 'Embedded project';
});
const project = editor.getProject();
```

- `getProject()` returns a detached snapshot, including Craft pixel buffers. Mutating it does not edit the instance.
- `transact(callback)` edits a private draft and validates before atomically adopting a detached copy. Throws, invalid documents, Promise/thenable callbacks, and reentrant mutations leave the previous project intact. Callbacks must be synchronous; await external work before opening a transaction. Late writes to a retained draft cannot change committed state.
- `replace(project)` validates and detaches a replacement before adopting it. The seed and replacement remain caller-owned.

Call your renderer or framework's state setter with `editor.getProject()` after a successful edit. Export that snapshot using this package's IO APIs. Persistence, rendering, subscriptions, undo/redo, and worker scheduling are explicit host responsibilities; the adapter does not silently persist changes or retain an undo history. Existing lower-level history/store APIs remain available separately. For React, create one instance per mounted editor rather than one on every render. For servers, create one instance per document/job, never a shared global editor for multiple tenants.

The adapter is headless application logic, not an iframe bridge, a DOM editor widget, an HTTP API, or a CLI flag. Large validation/export calls still run in the calling thread. For untrusted input, use worker/process isolation and external memory/time limits in addition to the built-in format budgets. Embedded browser hosts must bundle the ESM package and its production dependencies; the browser UI and its PWA/recovery code are not needed.

## Build and artifact validation

```sh
npm ci --ignore-scripts
npm run build:lib
npm run check:package
npm run check:consumer
npm run release:check
```

The browser build remains npm run build and writes dist/. The separate SDK build writes lib/; prepack rebuilds it automatically. Do not publish dist/ as the library. Runtime dependencies exclude browser-only fonts/icons/frameworks. Required dependency licenses/notices are included in the allowlisted tarball.

check:package inspects the exact npm pack inventory and public imports. check:consumer creates a real tarball, installs it outside the repo with production dependencies only, exercises basic portable operations, and strictly compiles/emits NodeNext consumer declarations with no DOM library. Its temporary directory is removed even on failure. These are package/consumer smoke checks, not the unit suite. release:check also checks dependencies and builds the browser app/docs. No listed check invokes npm test or browser suites; ask before running unit tests.

## Manual publication (one project at a time)

From this project's root:

```sh
npm run release:check
npm pack
npm publish --dry-run --access public
npm publish --access public
```

Only run the final command when you intend to publish. No workflow publishes automatically. Confirm npm login, package-name ownership and version availability first; registry E404 does not guarantee ownership. Before later releases, choose an unused semver version. prepublishOnly rejects any current npm audit vulnerability; prepack builds/checks the artifact and never runs unit tests. If publishing a previously created tarball rather than the project directory, run the release checks before packing: npm cannot rebuild a tarball for you. Configure provenance/trusted publishing according to your npm account if desired; no credentials are stored here.

The npm archive intentionally includes lib/, this document, README, LICENSE and the relevant third-party notices. Source, tests, tooling, app dist/ and standalone HTML are excluded. The root package has no dependency on another PiVo package: each can be published independently.
