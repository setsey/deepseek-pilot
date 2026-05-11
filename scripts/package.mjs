import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = dirname(scriptDir);
const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
const distDir = join(rootDir, 'dist');
const outputFile = join(distDir, `${packageJson.name}-${packageJson.version}.vsix`);
const vsceBin = join(rootDir, 'node_modules', '@vscode', 'vsce', 'vsce');
const maxRetries = process.platform === 'win32' ? 10 : 0;

rmSync(distDir, { recursive: true, force: true, maxRetries });
mkdirSync(distDir, { recursive: true });

const result = spawnSync(process.execPath, [vsceBin, 'package', '-o', outputFile], {
  cwd: rootDir,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Created ${outputFile}`);