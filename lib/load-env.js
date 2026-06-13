import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/** Подгружает .env.local в process.env (для локальной разработки). */
export function loadEnvLocal(rootDir = process.cwd()) {
  const envPath = resolve(rootDir, '.env.local');
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
