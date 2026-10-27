import { build } from 'esbuild';
import { rollup } from 'rollup';
import { dts } from 'rollup-plugin-dts';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const outdir = path.join(root, 'lib');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (path.dirname(outdir) !== path.resolve(root)) throw new Error('Invalid library output directory');
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
const entries = Object.fromEntries(['index', 'core', 'io'].map(name => [name, path.join(root, 'sdk', name + '.ts')]));
const result = await build({
  absWorkingDir: root,
  entryPoints: entries,
  outdir,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  external: Object.keys(pkg.dependencies ?? {}),
  mainFields: ['module', 'main'],
  tsconfig: path.join(root, 'tsconfig.lib.json'),
  chunkNames: 'chunks/[name]-[hash]',
  legalComments: 'eof',
  metafile: true,
});
const forbidden = Object.keys(result.metafile.inputs).filter(file => file.split('/').some(part => ['ui', 'apps', 'test', 'tests'].includes(part)) || file.includes('node_modules/') && !file.includes('node_modules/gifenc/'));
if (forbidden.length) throw new Error('Non-portable library inputs: ' + forbidden.join(', '));
const declarations = await rollup({ input: entries, plugins: [dts({ tsconfig: path.join(root, 'tsconfig.lib.json') })] });
try {
  await declarations.write({ dir: outdir, format: 'es', entryFileNames: '[name].d.ts', chunkFileNames: 'types/[name]-[hash].d.ts' });
} finally {
  await declarations.close();
}
await writeFile(path.join(outdir, 'build.json'), JSON.stringify({ name: pkg.name, version: pkg.version, inputs: Object.keys(result.metafile.inputs) }, null, 2) + '\n');
console.log(pkg.name + ': portable ESM and declarations built');
