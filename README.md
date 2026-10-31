# PiVo Plate

A local-first browser tile-to-3D modeling editor.

[Open app](https://bookklik-technologies.github.io/pivo-plate/) · [Documentation](https://bookklik-technologies.github.io/pivo-plate/docs/)

![PiVo Plate editor showing a tiled 3D room and texture atlas](docs/public/screenshots/app.png)

## npm and headless SDK

For the full visual editor without its suite header or recovery startup, load `?embed=1`. Use `?recovery=off` to keep the header but disable browser recovery. Existing backups are preserved; see [browser embedding options](docs/npm.md#browser-embedding-and-recovery-options).

Embed custom UIs or Node jobs with `createHeadlessEditor` from the root or `/headless` entry. It isolates documents and validates synchronous transactions; see [the embedding API](docs/npm.md#embed-with-a-custom-ui-or-no-ui).

ESM library for Node.js 24+, with generated TypeScript declarations. After publication, install with `npm install @bookklik/pivo-plate` and import from `@bookklik/pivo-plate/headless`, `@bookklik/pivo-plate/core` or `@bookklik/pivo-plate/io`. No CLI or browser is required for the documented portable operations.

See [SDK usage, supported operations and manual publishing](docs/npm.md). Build with `npm run build:lib`; validate an isolated production install with `npm run check:consumer`. These commands do not run the unit suite.

## Run locally

Use Node.js 24 and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Requires a current desktop browser with WebGL2. Projects stay in your browser; save downloaded project files as backups.

## Build and documentation

```sh
npm run build         # production app in dist/
npm run docs:dev      # local documentation server
npm run docs:build    # static docs in docs/.vitepress/dist/
npm run docs:preview  # preview docs after building
```

See the [tutorials](https://bookklik-technologies.github.io/pivo-plate/docs/tutorials/), [limitations](docs/limitations.md), and [verification](docs/verification.md) for usage, supported features, and recorded checks.

## License

Released under the [MIT License](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for dependency licenses.

## Production readiness

See [readiness findings and release procedure](docs/production-readiness.md) for the browser app and [npm release checks](docs/npm.md) for the SDK. Unit tests remain manual; package CI validates builds, dependencies and isolated consumers without executing unit suites.
