/**
 * Cek sintaks semua file .js di proyek (node --check).
 *
 *   npm run check               -> ringkas: hanya file bermasalah yang dicetak
 *   npm run check -- --verbose  -> tampilkan setiap file yang lolos
 *
 * Sebelumnya skrip ini mencetak satu baris per file (ratusan baris) sehingga
 * ringkasannya tenggelam — sekarang ringkasannya yang tampil di depan.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import print from '../lib/print.js';

const root = path.resolve(import.meta.dirname, '..');
const ignore = new Set(['node_modules', 'sessions', 'database', 'tmp', '.git']);
const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignore.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

const files = walk(root).sort();
const failures = [];

for (const file of files) {
  const relative = path.relative(root, file);
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status === 0) {
    if (verbose) print.success(relative);
    continue;
  }
  failures.push({ relative, detail: String(result.stderr || '').trim() });
}

/** Jumlah file per folder, untuk baris ringkasan. */
const perFolder = {};
for (const file of files) {
  const relative = path.relative(root, file);
  const folder = relative.includes(path.sep) ? relative.split(path.sep)[0] : '(root)';
  perFolder[folder] = (perFolder[folder] || 0) + 1;
}

console.log('');
if (!failures.length) {
  print.success(`${files.length} file .js lolos pengecekan sintaks`);
  print.kv(
    'Rincian',
    Object.entries(perFolder)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([folder, count]) => `${folder} ${count}`)
      .join(' • '),
  );
  process.exit(0);
}

print.error(`${failures.length} dari ${files.length} file gagal dicek:`);
for (const { relative, detail } of failures) {
  console.error(`  ❌ ${relative}`);
  if (detail) console.error(detail.split('\n').map((line) => `     ${line}`).join('\n'));
}
process.exit(1);
