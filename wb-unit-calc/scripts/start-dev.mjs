import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const viteBin = resolve(root, 'node_modules/vite/bin/vite.js');
const config = resolve(here, '../vite.config.js');

if (!existsSync(viteBin)) {
  console.error('Сначала в корне проекта: npm install');
  process.exit(1);
}

const child = spawn(process.execPath, [viteBin, '--config', config, '--host', '127.0.0.1', '--port', '5174'], {
  cwd: resolve(here, '..'),
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => process.exit(code ?? 0));
