import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.private, false, 'Package must be publishable');
assert.ok(process.env.npm_execpath, 'Run through npm run check:package');
const packed = spawnSync(process.execPath, [process.env.npm_execpath, 'pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: root, encoding: 'utf8' });
if (packed.error) throw packed.error;
assert.equal(packed.status, 0, packed.stderr);
const inventory = JSON.parse(packed.stdout)[0];
const files = new Set(inventory.files.map(file => file.path));
for (const name of ['LICENSE', 'README.md', 'docs/npm.md']) assert.ok(files.has(name), 'Missing ' + name);
for (const entry of Object.values(pkg.exports)) {
  if (typeof entry === 'string') { assert.ok(files.has(entry.replace(/^\.\//, ''))); continue; }
  for (const target of new Set(Object.values(entry))) {
    assert.ok(target.startsWith('./lib/') && !target.includes('..' + '/'), 'Invalid export target ' + target);
    assert.ok(files.has(target.slice(2)), 'Unpacked export target ' + target);
    await access(path.join(root, target));
  }
}
for (const name of files) {
  assert.ok(!name.split('/').some(part => ['src', 'sdk', 'scripts', 'test', 'tests', '.github', 'node_modules'].includes(part)), 'Unexpected internal file ' + name);
  if (name.endsWith('.js') || name.endsWith('.d.ts')) {
    const text = await readFile(path.join(root, name), 'utf8');
    assert.ok(!text.includes('import.meta.env') && !text.includes('?worker') && !text.includes('@pivo-craft/core'), 'Unresolved build contract in ' + name);
    for (const imported of ts.preProcessFile(text, true, true).importedFiles) {
      const specifier = imported.fileName;
      if (specifier.startsWith('.')) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier));
        assert.ok(files.has(target) || files.has(target.replace(/\.js$/, '.d.ts')), 'Missing internal import ' + target);
      } else {
        const dependency = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
        assert.ok(Object.hasOwn(pkg.dependencies ?? {}, dependency), 'Undeclared production dependency ' + dependency);
      }
    }
  }
}
const record = JSON.parse(await readFile(path.join(root, 'lib/build.json'), 'utf8'));
assert.equal(record.name, pkg.name);
assert.equal(record.version, pkg.version, 'Library build is stale');
for (const entry of ['index', 'core', 'io']) await import(pathToFileURL(path.join(root, 'lib', entry + '.js')));
console.log(pkg.name + ': ' + inventory.entryCount + ' deliberate package files, all exports/declarations/dependencies present');
