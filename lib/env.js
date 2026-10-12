/**
 * Memuat file .env (kalau ada) sebelum config dibaca.
 * Memakai process.loadEnvFile() bawaan Node bila tersedia (Node >= 20.12),
 * kalau tidak ada dipakai parser sederhana. Environment yang sudah ada
 * TIDAK ditimpa (perilaku sama seperti flag --env-file milik Node).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');

export const envFilePath = ENV_FILE;
export const envLoaded = fs.existsSync(ENV_FILE);

if (envLoaded) {
  const before = new Map(Object.entries(process.env));
  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(ENV_FILE);
    } catch {
      /* diabaikan: file rusak tidak boleh membuat bot mati */
    }
  } else {
    try {
      const raw = fs.readFileSync(ENV_FILE, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
        if (!(key in process.env)) process.env[key] = value;
      }
    } catch {
      /* diabaikan */
    }
  }
  // Kembalikan nilai yang sudah ada sebelum loadEnvFile bila Node menimpanya.
  for (const [key, value] of before) if (value !== undefined) process.env[key] = value;
}

export function env(key, fallback = '') {
  const value = process.env[key];
  return value === undefined || value === null || value === '' ? fallback : value;
}

export function envNumber(key, fallback) {
  const value = Number(env(key, ''));
  return Number.isFinite(value) && env(key, '') !== '' ? value : fallback;
}

export function envList(key, fallback = []) {
  const value = env(key, '');
  if (!value) return fallback;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export default { env, envNumber, envList, envLoaded, envFilePath, ROOT };
