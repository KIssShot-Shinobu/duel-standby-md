#!/usr/bin/env node
/**
 * Generate patch-v1.3.4-buylimit.mjs
 *
 * Hanya berisi file yang ada di panel (tidak ada folder tests/ di sana).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'patch-v1.3.4-buylimit.mjs';
const files = [
  'config.js',
  'lib/buy-limit.js',
  'lib/database.js',
  'lib/messages.js',
  'plugins/buy-limit.js',
  'plugins/owner-user.js',
];

const FILES = files.map((f) => {
  const content = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
  return {
    path: f,
    size: Buffer.byteLength(content, 'utf8'),
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
    base64: Buffer.from(content, 'utf8').toString('base64'),
  };
});

const patchContent = `#!/usr/bin/env node
/**
 * Patch otomatis rtxzy-md-clean v1.3.4-buylimit (dibuat ${new Date().toISOString().replace(/[:.]/g, '-')}).
 * Jalankan dari dalam folder bot:  node ${OUT}
 *
 * Fitur baru: .buylimit - beli limit pakai saldo in-game
 *
 *  - .buylimit        lihat paket & harga
 *  - .buylimit 30     beli paket 30 limit
 *  - .buylimit 7      beli 7 limit (harga satuan)
 *
 *  Tiga langkah supaya tidak salah potong:
 *  1. quote() mengecek dulu (paket atau harga satuan, saldo cukup, belum kena
 *     batas harian/bulanan) tanpa mengubah apa pun.
 *  2. Kalau lolos, purchase() yang memotong saldo.
 *  3. Saldo dan bonus dijaga tidak pernah negatif walau ada data rusak.
 *
 *  Limit yang dibeli:
 *  - disimpan sebagai limitBonus, jadi PERMANEN (tidak hilang saat reset harian)
 *  - langsung terpakai seperti limit biasa (dikurangi tiap command berlimit)
 *  - ikut terhitung di kuota premium kalau pemiliknya premium
 *  - memakai adjustLimit() yang sama dengan bonus dari owner, jadi perilakunya
 *    identik dan angka limit yang dilaporkan tidak meleset
 *
 *  Harga bawaan:
 *  - 1 limit          = 250 saldo
 *  - paket 10 limit  = 2.000 saldo  (hemat 500)
 *  - paket 30 limit  = 5.000 saldo  (hemat 2.500)
 *  - paket 60 limit  = 9.000 saldo  (hemat 6.000)
 *  - jumlah bebas     = 1-60 limit
 *
 *  Batas (supaya saldo tidak habis dalam sekali jalan):
 *  - 60 limit per jendela 24 jam
 *  - 300 limit per bulan kalender
 *
 *  Bisa diubah lewat .env tanpa sentuh kode:
 *  BUY_LIMIT_ENABLED, BUY_LIMIT_PRICE, BUY_LIMIT_MIN, BUY_LIMIT_MAX,
 *  BUY_LIMIT_DAILY_CAP, BUY_LIMIT_MONTHLY_CAP
 *
 *  Catatan kecil: label di .profile diubah dari "+N bonus owner" jadi "+N bonus",
 *  karena limitBonus sekarang bisa berisi pembelian user, bukan cuma pemberian
 *  owner.
 *
 *  Data lama tidak perlu migrasi: field baru (buyDayAmount, buyDayKey,
 *  buyMonthAmount, buyMonthKey) otomatis terisi default untuk user yang sudah ada.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const BACKUP = path.join(ROOT, \`backup-patch-\${STAMP}\`);
const FILES = ${JSON.stringify(FILES, null, 2)};

function main() {
  console.log('\\u{1F6D2} Patch v1.3.4-buylimit');
  console.log('===============================');

  if (!fs.existsSync(BACKUP)) fs.mkdirSync(BACKUP, { recursive: true });

  for (const file of FILES) {
    const target = path.join(ROOT, file.path);
    if (!fs.existsSync(target)) continue;
    const current = fs.readFileSync(target, 'utf8');
    const currentHash = crypto.createHash('sha256').update(current).digest('hex');
    if (currentHash !== file.sha256) {
      fs.copyFileSync(target, path.join(BACKUP, file.path.replace(/\\//g, '_')));
      console.log(\`  \\u{1F4CB} Backup: \${file.path}\`);
    }
  }

  let applied = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of FILES) {
    const target = path.join(ROOT, file.path);
    const targetDir = path.dirname(target);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const newContent = Buffer.from(file.base64, 'base64').toString('utf8');
    const newHash = crypto.createHash('sha256').update(newContent).digest('hex');
    if (newHash !== file.sha256) {
      console.error(\`  \\u{274C} Hash mismatch: \${file.path} (expected \${file.sha256}, got \${newHash})\`);
      errors++;
      continue;
    }

    let action = '\\u{2795}';
    if (fs.existsSync(target)) {
      const current = fs.readFileSync(target, 'utf8');
      const currentHash = crypto.createHash('sha256').update(current).digest('hex');
      if (currentHash === file.sha256) {
        action = '\\u{23EF}';
        skipped++;
      } else {
        action = '\\u{1F504}';
      }
    }

    fs.writeFileSync(target, newContent, 'utf8');
    console.log(\`  \${action} \${file.path} (\${file.size} bytes)\`);
    applied++;
  }

  console.log('\\n\\u{1F4CA} Ringkasan:');
  console.log(\`  Diterapkan: \${applied}\`);
  console.log(\`  Dilewati (sudah sama): \${skipped}\`);
  console.log(\`  Error: \${errors}\`);
  console.log(\`  Backup di: \${BACKUP}\`);
  console.log('\\n\\u{1F504} Restart bot, lalu coba: .buylimit');

  if (errors > 0) process.exit(1);
}

try {
  main();
} catch (e) {
  console.error('\\u{274C} Gagal:', e);
  process.exit(1);
}
`;

fs.writeFileSync(path.join(process.cwd(), OUT), patchContent);
console.log(`Created ${OUT} (${Buffer.byteLength(patchContent, 'utf8')} bytes)`);