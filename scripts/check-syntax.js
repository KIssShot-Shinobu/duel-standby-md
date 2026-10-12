/**
 * Cek sintaks semua file .js di proyek (node --check).
 *   npm run check
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const ignore = new Set(['node_modules', 'sessions', 'database', 'tmp', '.git']);

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
let failed = 0;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status === 0) {
    console.log(`✅ ${path.relative(root, file)}`);
  } else {
    failed += 1;
    console.error(`❌ ${path.relative(root, file)}\n${result.stderr?.trim()}`);
  }
}

console.log(`\n${files.length - failed}/${files.length} file lolos pengecekan sintaks.`);
process.exit(failed ? 1 : 0);
