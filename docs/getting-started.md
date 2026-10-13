# Installation & running

PiVo Plate is a framework-free TypeScript UI over a Three.js WebGL2 viewport, with a renderer-independent core.

## Requirements

- Node.js **20.19+** or **22.12+** (required by Vite 7; build validated on Node 24.14.1)
- A current desktop browser with **WebGL2**
- No backend, account or runtime CDN required

## Run the dev server

```sh
npm ci
npm run dev
```

Open the local address Vite prints.

## Production build

```sh
npm run typecheck
npm run build               # typecheck + production build in dist/
npm run build:standalone    # also writes dist/pivo-plate-standalone.html (all JS+CSS in one file)
npm run preview
```

Serve `dist` on any static HTTP(S) host. For predictable storage and downloads, use an ordinary HTTP(S) origin rather than a sandboxed embed or file URL.

## Run the test suite

```sh
npm test                # unit/archive/loader/integration tests
npx playwright install chromium
npm run test:browser    # end-to-end regression (starts its own Vite server on port 4176)
```

Additional focused regression suites:

```sh
npm run test:layout
npm run test:safety
npm run test:modeling
npm run test:png
npm run test:erase-hud
npm run test:theme
npm run test:font
```

The regression scripts launch headless Chromium with software WebGL flags and write reports/captures to `test-results/`. No external websites are contacted by the tests; the one-time browser download requires network access on your machine.

## Next steps

- Build your first project with the [Beginner tutorials](/tutorials/), including screenshots and downloadable checkpoints.
- Follow the [User guide](/guide) through the eight-step first workflow.
- Read [File formats](/formats) for `.pvp`, GLB and OBJ details.
- Drive the engine with the [Core & IO API](/api) (contract in [CONTRACTS.md](/CONTRACTS)).

## Release validation and updates

Production browser checks use `npm run test:release` against the built app at its deployment subpath. Unit tests are manually authorized. See [production readiness](production-readiness.md) for current evidence and limitations. Updates show a prompt and require recovery to be stored before reload. Download native project backups regularly; browser site data can be cleared by the browser or user.
