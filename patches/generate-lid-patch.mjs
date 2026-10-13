#!/usr/bin/env node
/**
 * Generate patch-v1.3.3-lid-identity.mjs
 *
 * Hanya berisi lib/serialize.js karena folder tests/ tidak ada di panel.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'patch-v1.3.3-lid-identity.mjs';
const files = ['lib/serialize.js'];

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
 * Patch otomatis rtxzy-md-clean v1.3.3-lid-identity (dibuat ${new Date().toISOString().replace(/[:.]/g, '-')}).
 * Jalankan dari dalam folder bot:  node ${OUT}
 *
 * Perbaikan:
 * 1. Limit/premium user tidak lagi "bolong" (owner lihat 100, user lihat 0/20)
 *    - Di chat pribadi WhatsApp mengirim key.remoteJid = nomor telepon dan
 *      key.remoteJidAlt = LID, tanpa participantPn/senderPn.
 *    - Dulu smsg() tidak pernah mempertimbangkan key.remoteJid sebagai
 *      kandidat nomor telepon, sehingga pengirim jatuh ke remoteJidAlt (LID).
 *    - Akibatnya senderPn = null, db.mapLid() tidak pernah menyimpan pasangan
 *      LID <-> nomor, dan user punya record terpisah dari record yang diedit
 *      owner lewat .premium add / .limit add.
 *    - Gejala: owner melihat "Premium: Ya" dan 100 limit, tapi user yang sama
 *      saat .profile melihat "Premium: Belum" dan 0/20.
 *    - Sekarang key.remoteJid jadi kandidat nomor telepon (khusus chat privat;
 *      di grup remoteJid adalah JID grup).
 *    - Setelah pemetaan dipelajari, db.mapLid() 자동으로 menggabungkan record
 *      LID ke record nomor telepon: premium/limit milik nomor dipertahankan,
 *      sedangkan exp/saldo/total command dari record LID ikut terselamatkan.
 *
 * Catatan: data lama tidak perlu diedit manual. Setelah patch ini dipasang,
 * record ganda dilebur otomatis begitu user itu mengirim pesan berikutnya
 * (juga saat bot start, lewat repairLidRecords()).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const BACKUP = path.join(ROOT, \`backup-patch-\${STAMP}\`);
const FILES = ${JSON.stringify(FILES, null, 2)};

function main() {
  console.log('\\u{1F4E6} Patch v1.3.3-lid-identity');
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
  console.log('\\n\\u{1F504} Restart bot, lalu user yg bermasalah kirim pesan apa saja.');

  if (errors > 0) process.exit(1);
}

try {
  main();
} catch (e) {
  console.error('\\u{274C} Gagal:', e);
  process.exit(1);
}
`;

const outPath = path.join(process.cwd(), OUT);
fs.writeFileSync(outPath, patchContent);
console.log(`Created ${OUT} (${Buffer.byteLength(patchContent, 'utf8')} bytes)`);