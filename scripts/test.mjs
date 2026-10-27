import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const tests = readdirSync('build/tests').filter(name => name.endsWith('.test.js')).sort().map(name => `build/tests/${name}`);
if (!tests.length) throw new Error('No tests found');
const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
process.exit(result.status ?? 1);
