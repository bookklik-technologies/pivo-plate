import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

if (!process.env.npm_execpath) throw new Error('Run this check through npm run check:dependencies');
const result = spawnSync(process.execPath, [process.env.npm_execpath, 'audit', '--json'], { encoding: 'utf8' });
if (result.error) throw result.error;
let report;
try { report = JSON.parse(result.stdout); }
catch { throw new Error('Dependency audit unavailable: ' + result.stderr); }
if (report.error) throw new Error(JSON.stringify(report.error));
if (![0, 1].includes(result.status) || report.auditReportVersion !== 2 || !report.vulnerabilities || !report.metadata?.vulnerabilities) {
  throw new Error('Dependency audit unavailable: unexpected npm audit result');
}
const advisory = 'https://github.com/advisories/GHSA-gcqx-w48m-w2h4';
const expires = '2026-11-27T00:00:00Z';
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const exceptionPackages = new Map([
  ['deepmerge', { version: '4.3.1', via: null }],
  ['@rollup/plugin-node-resolve', { version: '16.0.3', via: 'deepmerge' }],
  ['workbox-build', { version: '7.4.1', via: '@rollup/plugin-node-resolve' }],
  ['vite-plugin-pwa', { version: '2.0.0', via: 'workbox-build' }],
]);
function isExcepted(name) {
  const expected = exceptionPackages.get(name);
  const value = report.vulnerabilities[name];
  const node = 'node_modules/' + name;
  if (Date.now() >= Date.parse(expires) || !expected || !value || value.severity !== 'low' ||
      value.nodes?.length !== 1 || value.nodes[0] !== node || lock.packages?.[node]?.version !== expected.version ||
      !Array.isArray(value.via) || value.via.length !== 1) return false;
  const cause = value.via[0];
  if (expected.via) return cause === expected.via && isExcepted(cause);
  return cause?.name === 'deepmerge' && cause.url === advisory && cause.severity === 'low' &&
    cause.range === '>=4.2.0 <=4.3.1';
}
const blocking = [];
const exceptions = [];
for (const [name, value] of Object.entries(report.vulnerabilities)) {
  const vulnerability = { name, severity: value.severity, nodes: value.nodes };
  if (isExcepted(name)) exceptions.push({ ...vulnerability, advisory, expires });
  else blocking.push(vulnerability);
}
console.log(JSON.stringify({ counts: report.metadata.vulnerabilities, blocking, exceptions }, null, 2));
if (blocking.length || (result.status !== 0 && !exceptions.length)) process.exitCode = 1;
