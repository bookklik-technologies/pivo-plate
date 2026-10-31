import { chromium, firefox, webkit } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve('dist');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const name = pkg.name.split('/').pop();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (request, response) => {
  try {
    if (new URL(request.url, 'http://localhost').pathname === '/embed-host.html') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><html><head><style>html,body{margin:0;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0;display:block}</style></head><body><iframe title="Embedded editor" src="/?embed=1&amp;recovery=on"></iframe></body></html>');
      return;
    }
    let file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (file !== root && !file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const results = [];
await mkdir('test-results/readiness/embed', { recursive: true });
try {
  for (const engine of (process.env.PIVO_BROWSERS ?? 'chromium').split(',')) {
    const browser = await { chromium, firefox, webkit }[engine].launch({ headless: true, ...(engine === 'chromium' ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {}) });
    try {
      for (const viewport of [{ width: 1280, height: 800 }, { width: 640, height: 480 }]) {
        for (const variant of [{ mode: 'normal', query: '', embedded: false, recovery: true }, { mode: 'recovery-off', query: '?recovery=off', embedded: false, recovery: false }, { mode: 'embedded', query: '?embed=1&recovery=on', embedded: true, recovery: false }, { mode: 'embedded-iframe', query: 'embed-host.html', embedded: true, recovery: false }]) {
          const context = await browser.newContext({ viewport, acceptDownloads: true });
          try {
            const page = await context.newPage();
            console.log(name, engine, variant.mode, viewport.width + 'x' + viewport.height);
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.addInitScript(() => {
              window.__pivoRecoveryAccess = [];
              const open = IDBFactory.prototype.open;
              IDBFactory.prototype.open = function(database, ...args) {
                if (String(database).startsWith('pivo-')) window.__pivoRecoveryAccess.push(`database:${database}`);
                return open.call(this, database, ...args);
              };
              for (const method of ['getItem', 'setItem', 'removeItem']) {
                const original = Storage.prototype[method];
                Storage.prototype[method] = function(key, ...args) {
                  if (String(key).includes('recovery')) window.__pivoRecoveryAccess.push(`${method}:${key}`);
                  return original.call(this, key, ...args);
                };
              }
            });
            await page.goto(url + variant.query, { waitUntil: 'networkidle' });
            const surface = variant.mode === 'embedded-iframe' ? page.frames().find(frame => frame.parentFrame() && frame.url().includes('embed=1')) : page;
            assert.ok(surface, 'Embedded iframe must load');
            const stateSelector = name === 'pivo-craft' ? '#save-state' : '.suite-save-state';
            await surface.waitForFunction(selector => document.querySelector(selector)?.textContent?.includes(' · '), stateSelector);
            assert.equal(await surface.locator('.suite-header').isVisible(), !variant.embedded);
            assert.equal(await surface.locator('.suite-document-strip').isVisible(), true);
            assert.ok(await surface.locator('canvas:visible').count() > 0, 'Editor canvas must remain visible');
            if (variant.embedded) {
              const strip = await surface.locator('.suite-document-strip').boundingBox();
              assert.ok(strip && strip.y <= 1, 'Hidden header must not leave a blank layout row');
            }
            if (!variant.recovery) assert.match(await surface.locator(stateSelector).innerText(), /Browser recovery disabled/);
            if (variant.mode === 'embedded-iframe') await surface.locator('.suite-document-strip').click({ position: { x: 1, y: 1 } });
            const downloading = page.waitForEvent('download');
            await page.keyboard.press('Control+s');
            const download = await downloading;
            assert.match(download.suggestedFilename(), /\.(pvc|pvo|pvp)$/);
            assert.ok((await readFile(await download.path())).length > 128);
            if (!variant.recovery) assert.deepEqual(await surface.evaluate(() => window.__pivoRecoveryAccess), [], 'Disabled recovery must not inspect, migrate, write, or delete backups');
            assert.deepEqual(errors, []);
            const capture = `${name}-${engine}-${variant.mode}-${viewport.width}x${viewport.height}.png`;
            await page.screenshot({ path: path.join('test-results/readiness/embed', capture) });
            results.push({ engine, mode: variant.mode, viewport, passed: true });
          } finally { await context.close(); }
        }
      }
    } finally { await browser.close(); }
  }
} finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
await writeFile('test-results/readiness/embed-report.json', JSON.stringify({ app: name, results }, null, 2) + '\n');
console.log(JSON.stringify({ app: name, results }, null, 2));
