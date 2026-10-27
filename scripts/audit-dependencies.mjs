import { spawnSync } from 'node:child_process';

if (!process.env.npm_execpath) throw new Error('Run this check through npm run check:dependencies');
const result = spawnSync(process.execPath, [process.env.npm_execpath, 'audit', '--json'], { encoding: 'utf8' });
if (result.error) throw result.error;
let report;
try { report = JSON.parse(result.stdout); }
catch { throw new Error('Dependency audit unavailable: ' + result.stderr); }
if (report.error) throw new Error(JSON.stringify(report.error));
const vulnerabilities = Object.entries(report.vulnerabilities ?? {}).map(([name, value]) => ({ name, severity: value.severity, nodes: value.nodes }));
console.log(JSON.stringify({ counts: report.metadata?.vulnerabilities, blocking: vulnerabilities }, null, 2));
if (result.status !== 0 || vulnerabilities.length) process.exitCode = 1;
