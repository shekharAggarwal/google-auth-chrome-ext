// Packages dist/ into release/google-auth-ext-<version>.zip (uses the system `zip` tool).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve('dist');
if (!existsSync(resolve(dist, 'manifest.json'))) throw new Error('Run `npm run build` first');
const { version } = JSON.parse(readFileSync(resolve(dist, 'manifest.json'), 'utf8'));

mkdirSync('release', { recursive: true });
const out = resolve('release', `google-auth-ext-${version}.zip`);
rmSync(out, { force: true });
execFileSync('zip', ['-r', '-X', out, '.', '-x', '*.DS_Store', '*.pem'], { cwd: dist, stdio: 'inherit' });
console.log(`\nCreated ${out}`);
