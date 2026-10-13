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
const files = [
  'handler.js',
  'lib/database.js',
  'lib/permissions.js',
  'lib/serialize.js',
  'plugins/main-info.js',
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
 * 2. Perbaikan kedua: chat GRUP yang hanya mengirim participant = LID
 *    - Di grup WA sering mengirim key.participant = LID tanpa participantPn
 *      maupun participantAlt, jadi nomor teleponnya tidak ada di pesan dan
 *      db.mapLid() tidak punya pasangan untuk disimpan.
 *    - Satu-satunya sumber pasangan LID <-> nomor di grup adalah daftar
 *      peserta ({ lid, phoneNumber }), yang selama ini hanya dipakai untuk cek
 *      admin, bukan untuk pemetaan identitas.
 *    - Sekarang Perm.findParticipantPhone() dipakai dari handler.js.
 *    - Pengambilan metadata grup juga tidak lagi bergantung pada groupCache:
 *      kalau cache belum siap, identitas peserta diambil langsung dari socket.
 *    - Ditambah peringatan di log kalau pengirim tetap tidak bisa dipetakan ke
 *      nomor telepon, supaya masalah ini kelihatan dari log dan bukan hanya
 *      dari gejala "limitnya kok tidak berubah".
 *
 * 3. Perbaikan ketiga (INI YANG BENAR-BENAR MENYEBABKAN GEJALAMU)
 *    - Dari database.json asli ditemukan 4 user premium punya record kedua
 *      yang kuncinya adalah LID berpola nomor telepon, contoh:
 *        271446714642565@s.whatsapp.net
 *        @271446714642565
 *        81596157788284@s.whatsapp.net
 *      Record-record itulah yang menyimpan premium/limit dari owner, sedangkan
 *      semua pesan user resolve ke nomor aslinya -> user tetap free.
 *      Gejalanya: .premium list bilang premium aktif, tapi user lihat 0/20.
 *    - Penyebab: LID juga 14-15 digit sehingga LOLOS dari validasi nomor
 *      (NUMBER_ARG /^@?\+?\d{7,20}$/ di lib/functions.js), lalu toJid()
 *      menempelkan suffix @s.whatsapp.net dan membuat record hantu.
 *      resolveLid() tidak bisa menangkapnya karena jid-nya sudah tidak
 *      berakhiran @lid.
 *    - Sekarang db.resolveIdentity() menyelesaikan identitas baik JID @lid
 *      maupun LID-yang-dipaksa-jadi-nomor; dipakai di db.user(), .premium,
 *      .limit, dan .profile.
 *    - mapLid() dan repairLidRecords() menggabungkan semua bentuk record hantu
 *      dan tetap jalan walau pemetaannya sudah diketahui sebelumnya.
 *    - mergeUserRecords() memakai premiumUntil TERPANJANG, karena satu user
 *      bisa punya dua record hantu dengan durasi berbeda.
 *
 * Catatan: data lama TIDAK perlu diedit manual. repairLidRecords() jalan
 * otomatis saat bot start, jadi cukup restart. Seharusnya muncul di log:
 *   [database] 5 record LID dilebur ke record nomor telepon
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