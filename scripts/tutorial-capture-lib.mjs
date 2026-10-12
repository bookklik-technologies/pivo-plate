import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Documentation asset capture only: this does not invoke any test suite.
export async function startCapture(rootUrl, port) {
  const root = fileURLToPath(rootUrl);
  const out = join(root, 'docs/public/tutorials');
  await mkdir(out, { recursive: true });
  const hostCache = join(homedir(), 'AppData/Local/ms-playwright');
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(hostCache)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = hostCache;
  }
  const server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      let log = '';
      const timeout = setTimeout(() => reject(new Error(`Vite did not start: ${log}`)), 20000);
      server.stdout.on('data', chunk => { log += chunk; if (log.includes(`:${port}/`)) { clearTimeout(timeout); resolve(); } });
      server.stderr.on('data', chunk => { log += chunk; });
      server.once('error', error => { clearTimeout(timeout); reject(error); });
      server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Vite exited (${code}): ${log}`)); });
    });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'en-US', colorScheme: 'dark', acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('dialog', dialog => dialog.accept());
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    const images = [];
    const downloads = [];
    async function settle() {
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    }
    async function shot(name, locator) {
      while (!locator && await page.getByRole('button', { name: 'Dismiss', exact: true }).count()) {
        await page.getByRole('button', { name: 'Dismiss', exact: true }).first().click();
      }
      await settle();
      await page.mouse.move(700, 25);
      const path = join(out, `${name}.png`);
      await (locator ?? page).screenshot({ path, animations: 'disabled' });
      images.push(`${name}.png`);
      console.log(`Captured ${name}`);
    }
    async function download(name, action) {
      const [item] = await Promise.all([page.waitForEvent('download'), action()]);
      await item.saveAs(join(out, name));
      downloads.push(name);
      console.log(`Downloaded ${name}`);
    }
    async function report(details) {
      if (images.length !== 12) throw new Error(`Expected twelve screenshots, captured ${images.length}`);
      if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
      await rm(join(out, 'capture-error.png'), { force: true });
      await writeFile(join(out, 'capture-record.json'), JSON.stringify({ browser: await browser.version(), viewport: '1440x900', images, downloads, errors, ...details }, null, 2) + '\n');
    }
    return { page, out, shot, download, settle, report, close: async () => { await browser.close(); server.kill(); } };
  } catch (error) {
    await browser?.close();
    server.kill();
    throw error;
  }
}
