import test from 'node:test';
import assert from 'node:assert/strict';

// Warna dimatikan supaya regex bisa menguji teks apa adanya.
process.env.NO_COLOR = '1';
const { default: print } = await import('../lib/print.js');

/** Tangkap semua baris dari console.log + console.error selama fn(). */
function captureOutput(fn) {
  const lines = [];
  const originalLog = console.log;
  const originalError = console.error;
  const push = (...args) => lines.push(args.map(String).join(' '));
  console.log = push;
  console.error = push;
  try {
    fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return lines;
}

// ── Format baris dasar ────────────────────────────────────────────────────

test('baris log memakai jam HH:mm:ss dan tag selebar 4 karakter', () => {
  const lines = captureOutput(() => {
    print.info('pesan info');
    print.success('pesan ok');
    print.warn('pesan warn');
    print.error('pesan err');
  });

  assert.match(lines[0], /^\d{2}:\d{2}:\d{2} INFO pesan info$/);
  assert.match(lines[1], /^\d{2}:\d{2}:\d{2} OK {3}pesan ok$/, 'tag OK dipadukan 4 karakter');
  assert.match(lines[2], /^\d{2}:\d{2}:\d{2} WARN pesan warn$/);
  assert.match(lines[3], /^\d{2}:\d{2}:\d{2} ERR {2}pesan err$/);
});

test('jam tidak memakai titik gaya locale (21.29.32)', () => {
  assert.match(print.time('Asia/Jakarta'), /^\d{2}:\d{2}:\d{2}$/);
});

// ── Baris data (kv/rows) ──────────────────────────────────────────────────

test('kv() & rows() menyejajarkan kolom label', () => {
  const lines = captureOutput(() => {
    print.kv('Database', 'database/database.json');
    print.rows([
      ['Plugin', '47 file'],
      ['Zona waktu', 'Asia/Jakarta'],
    ]);
  });

  assert.match(lines[0], /INFO Database {4}database\/database\.json$/);
  assert.match(lines[1], /INFO Plugin {6}47 file$/);
  assert.match(lines[2], /INFO Zona waktu {2}Asia\/Jakarta$/);
});

// ── Aktivitas chat ────────────────────────────────────────────────────────

test('printMessage/printCommand memendekkan JID panjang', () => {
  const lines = captureOutput(() => {
    print.printMessage({
      chat: '628111@s.whatsapp.net',
      sender: '628111@s.whatsapp.net',
      pushName: 'Budi',
      text: 'halo   semua',
      isGroup: false,
    });
    print.printMessage({
      chat: '12036@g.us',
      sender: '628222@s.whatsapp.net',
      pushName: 'Ani',
      text: 'pagi',
      isGroup: true,
    });
    print.printCommand({ command: 'tebakgambar', sender: '628222@s.whatsapp.net', chat: '12036@g.us', isGroup: true });
  });

  assert.match(lines[0], /PRIB Budi \(628111\) \[text\] halo semua$/);
  assert.match(lines[1], /GRUP grup 12036 ← Ani \(628222\) \[text\] pagi$/);
  assert.match(lines[2], /GRUP grup 12036 » \.tebakgambar oleh 628222$/);
  assert.equal(
    lines.some((line) => line.includes('@s.whatsapp.net')),
    false,
    'JID penuh tidak boleh muncul di log normal',
  );
});

test('nama grup dipakai di log kalau tersedia (bukan id)', () => {
  const lines = captureOutput(() => {
    print.printMessage({
      chat: '6289670762522-1614085129@g.us',
      sender: '62895623051780@s.whatsapp.net',
      pushName: 'Reza Khaslana',
      text: 'Siapa sangka',
      isGroup: true,
      groupName: 'Grup Pelarian Doi',
    });
    print.printCommand({ command: 'menu', sender: '62895623051780@s.whatsapp.net', chat: '6289670762522-1614085129@g.us', isGroup: true, groupName: 'Grup Pelarian Doi' });
  });

  assert.match(lines[0], /GRUP grup Grup Pelarian Doi ← Reza Khaslana \(62895623051780\) \[text\] Siapa sangka$/);
  assert.match(lines[1], /GRUP grup Grup Pelarian Doi » \.menu oleh 62895623051780$/);
  assert.doesNotMatch(lines.join('\n'), /1614085129/, 'id grup tidak boleh muncul kalau nama tersedia');
});

test('fallback ke id grup kalau nama tidak tersedia', () => {
  const lines = captureOutput(() => {
    print.printMessage({
      chat: '12036@g.us',
      sender: '628222@s.whatsapp.net',
      pushName: 'Ani',
      text: 'pagi',
      isGroup: true,
      groupName: '',
    });
  });

  assert.match(lines[0], /GRUP grup 12036 ← Ani \(628222\) \[text\] pagi$/);
});

test('banner tidak lagi memakai border yang bisa miring', () => {
  const lines = captureOutput(() => print.banner('🜲 Bot Uji', 'v1.2.5', 'zona Asia/Jakarta'));
  assert.match(lines[0], /^─+$/);
  assert.match(lines[1], /Bot Uji {2}v1\.2\.5$/);
  assert.match(lines[2], /^zona Asia\/Jakarta$/);
  assert.match(lines[3], /^─+$/);
});

// ── Logger pino ───────────────────────────────────────────────────────────

test('logger pino tampil sebagai baris rapi, bukan JSON mentah', async () => {
  process.env.LOG_LEVEL = 'info';
  const { default: logger } = await import('../lib/logger.js?rapi=1');

  const lines = captureOutput(() => {
    logger.info('halo terminal');
    logger.warn({ chat: 'x@g.us' }, 'ada masalah');
    logger.error({ err: new Error('boom') }, 'gagal total');
  });
  const text = lines.join('\n');

  assert.match(text, /INFO halo terminal/);
  assert.match(text, /WARN ada masalah {2}chat=x@g\.us/);
  assert.match(text, /ERR {2}gagal total/);
  assert.match(text, /boom/, 'stack error ikut ditampilkan');
  assert.doesNotMatch(text, /"level":|"msg":/, 'tidak boleh ada JSON mentah');
});
