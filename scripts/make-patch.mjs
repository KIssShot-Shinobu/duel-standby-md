/**
 * Pembuat "patch file": satu berkas .mjs berisi versi terbaru beberapa file
 * yang bisa di-drop ke panel (via File Manager) lalu dijalankan:
 *
 *   node patch-vX.Y.Z.mjs
 *
 * Patch akan:
 *   1. mencadangkan file lama ke backup-patch-<waktu>/
 *   2. menulis versi baru (isi file disematkan base64, jadi tidak perlu upload banyak file)
 *   3. memverifikasi SHA-256 setiap file setelah ditulis
 *
 * Pemakaian:
 *   node scripts/make-patch.mjs patch-v1.1.1.mjs package.json config.js main.js lib/connection.js lib/session.js
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const [output, ...files] = process.argv.slice(2);

if (!output || !files.length) {
  console.error('Pemakaian: node scripts/make-patch.mjs <output.mjs> <file...>');
  process.exit(1);
}

const entries = files.map((rel) => {
  const absolute = path.join(ROOT, rel);
  if (!fs.existsSync(absolute)) throw new Error(`File tidak ditemukan: ${rel}`);
  const buffer = fs.readFileSync(absolute);
  return {
    path: rel,
    size: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    base64: buffer.toString('base64'),
  };
});

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const script = `#!/usr/bin/env node
/**
 * Patch otomatis rtxzy-md-clean v${version} (dibuat ${new Date().toISOString()}).
 * Jalankan dari dalam folder bot:  node ${path.basename(output)}
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const BACKUP = path.join(ROOT, \`backup-patch-\${STAMP}\`);
const FILES = ${JSON.stringify(entries, null, 2)};

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
let written = 0;
let backedUp = 0;
let skipped = 0;
const failed = [];

for (const file of FILES) {
  const target = path.join(ROOT, file.path);
  const buffer = Buffer.from(file.base64, 'base64');

  if (fs.existsSync(target)) {
    const current = fs.readFileSync(target);
    if (sha256(current) === file.sha256) {
      console.log(\`= \${file.path} sudah versi terbaru\`);
      skipped += 1;
      continue;
    }
    fs.mkdirSync(path.dirname(path.join(BACKUP, file.path)), { recursive: true });
    fs.writeFileSync(path.join(BACKUP, file.path), current);
    backedUp += 1;
  }

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buffer);
    const verify = fs.readFileSync(target);
    if (sha256(verify) !== file.sha256) throw new Error('hash tidak cocok setelah ditulis');
    written += 1;
    console.log(\`↑ \${file.path} (\${buffer.length} B) OK\`);
  } catch (err) {
    failed.push(\`\${file.path}: \${err.message}\`);
  }
}

console.log('');
console.log(\`selesai: \${written} ditulis, \${skipped} dilewati, \${backedUp} dicadangkan ke \${path.basename(BACKUP)}\`);
if (failed.length) {
  console.log('GAGAL:');
  for (const item of failed) console.log('  - ' + item);
  process.exitCode = 1;
} else {
  console.log('Sekarang restart bot (npm start) supaya perubahan dipakai.');
}
`;

fs.writeFileSync(path.join(ROOT, output), script, 'utf8');
console.log(`patch dibuat: ${output}`);
for (const entry of entries) console.log(`  ${entry.path} (${entry.size} B)`);
