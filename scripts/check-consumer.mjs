import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
assert.ok(process.env.npm_execpath, 'Run through npm run check:consumer');
const prefix = pkg.name.replace(/[^a-zA-Z0-9._-]/g, '-') + '-consumer-';
const workspace = await mkdtemp(path.join(tmpdir(), prefix));
function run(args, cwd = workspace, executable = process.execPath) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', timeout: 180000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(args.join(' ') + '\n' + result.stdout + result.stderr);
  return result.stdout;
}
try {
  const packed = JSON.parse(run([process.env.npm_execpath, 'pack', '--ignore-scripts', '--json', '--pack-destination', workspace], root))[0];
  const installed = path.join(workspace, 'installed');
  await mkdir(installed);
  await writeFile(path.join(installed, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run([process.env.npm_execpath, 'install', '--ignore-scripts', '--omit=dev', '--no-package-lock', '--no-audit', '--no-fund', path.join(workspace, packed.filename)], installed);
  const source = await readFile(path.join(root, 'scripts/package-consumer.mjs'), 'utf8');
  await writeFile(path.join(installed, 'consumer.mjs'), source.replaceAll('__PACKAGE__', pkg.name));
  const versions = JSON.stringify({ node: process.version, tarball: packed.filename, integrity: packed.integrity });
  console.log(versions);
  process.stdout.write(run(['consumer.mjs'], installed));
  await writeFile(path.join(installed, 'consumer.mts'), [
    "import * as api from '" + pkg.name + "';",
    "import * as headless from '" + pkg.name + "/headless';",
    "import * as core from '" + pkg.name + "/core';",
    "import * as io from '" + pkg.name + "/io';",
    "export const project: api.Project = api.createProject();",
    "export const create: typeof core.createProject = headless.createProject;",
    "export const projectName: string = project.name;",
    "export const codecs: typeof io = io;",
  ].join('\n'));
  run([path.join(root, 'node_modules/typescript/bin/tsc'), '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--lib', 'ES2022', '--declaration', '--emitDeclarationOnly', '--outDir', 'types', 'consumer.mts'], installed);
  console.log(pkg.name + ': isolated production install, Node operations and strict NodeNext declaration emission passed');
} finally {
  const resolved = await realpath(workspace);
  const parent = await realpath(tmpdir());
  assert.equal(path.dirname(resolved), parent, 'Refusing to remove an unexpected directory');
  assert.ok(path.basename(resolved).startsWith(prefix));
  await rm(resolved, { recursive: true, force: true });
}
