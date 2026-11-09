import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyStoredSettings,
  bareNumber,
  chunkText,
  cleanJid,
  clockString,
  formatBytes,
  getTargets,
  isYoutubeUrl,
  parseMention,
  shortClock,
  toJid,
} from '../lib/functions.js';
import { parseArgv, flagEnabled } from '../lib/argv.js';
import { calculate } from '../plugins/tools-calc.js';
import { resolveVideo } from '../plugins/downloader-ytmp3.js';

test('toJid & cleanJid menormalkan nomor dan device suffix', () => {
  assert.equal(toJid('628123456789'), '628123456789@s.whatsapp.net');
  assert.equal(toJid('08123456789'), '628123456789@s.whatsapp.net');
  assert.equal(toJid('628123456789:12@s.whatsapp.net'), '628123456789@s.whatsapp.net');
  assert.equal(cleanJid('628123456789:5@s.whatsapp.net'), '628123456789@s.whatsapp.net');
  assert.equal(bareNumber('628123456789:5@s.whatsapp.net'), '628123456789');
});

test('clockString & shortClock', () => {
  assert.equal(shortClock(3661000), '01:01:01');
  assert.equal(clockString(90061000), '1 Hari 01:01:01');
  assert.equal(clockString(-1), '--');
});

test('formatBytes', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1,00 KB');
  assert.equal(formatBytes(1048576), '1,00 MB');
});

test('parseMention & getTargets', () => {
  assert.deepEqual(parseMention('hai @628111222333'), ['628111222333@s.whatsapp.net']);
  const targets = getTargets(
    { mentionedJid: ['628111@s.whatsapp.net'], quoted: { sender: '628222@s.whatsapp.net' } },
    ['628333444555'],
  );
  assert.deepEqual(targets, ['628111@s.whatsapp.net', '628222@s.whatsapp.net', '628333444555@s.whatsapp.net']);
  // string pendek bukan nomor -> diabaikan
  assert.deepEqual(getTargets({ mentionedJid: [] }, ['123']), []);
});

test('applyStoredSettings: mode self dari database dipulihkan', () => {
  const config = { bot: { mode: 'public' } };
  assert.equal(applyStoredSettings(config, { settings: { mode: 'self' } }), 'self');
  assert.equal(config.bot.mode, 'self');
});

test('applyStoredSettings: nilai rusak diabaikan', () => {
  const config = { bot: { mode: 'public' } };
  assert.equal(applyStoredSettings(config, { settings: { mode: 'hacker' } }), 'public');
  assert.equal(applyStoredSettings(config, null), 'public');
});

test('chunkText memotong teks panjang', () => {
  const chunks = chunkText('a'.repeat(9000), 4000);
  assert.equal(chunks.length, 3);
  assert.equal(chunks.join('').length, 9000);
});

test('parseArgv & flagEnabled', () => {
  const { flags, positionals } = parseArgv(['--qr', '--prefix', '.', '--pair=628123', '--no-connect', 'extra']);
  assert.equal(flags.qr, true);
  assert.equal(flags.prefix, '.');
  assert.equal(flags.pair, '628123');
  assert.equal(flags['no-connect'], true);
  assert.deepEqual(positionals, ['extra']);
  assert.equal(flagEnabled({ debug: 'false' }, 'debug', true), false);
  assert.equal(flagEnabled({}, 'debug', true), true);
});

test('isYoutubeUrl: hanya host YouTube', () => {
  assert.equal(isYoutubeUrl('https://youtu.be/abc'), true);
  assert.equal(isYoutubeUrl('https://www.youtube.com/watch?v=abc'), true);
  assert.equal(isYoutubeUrl('https://m.youtube.com/watch?v=abc'), true);
  assert.equal(isYoutubeUrl('https://youtube.com.evil.com/watch?v=abc'), false);
  assert.equal(isYoutubeUrl('http://127.0.0.1:8080/x'), false);
  assert.equal(isYoutubeUrl('http://169.254.169.254/latest/meta-data/'), false);
  assert.equal(isYoutubeUrl('bukan url'), false);
});

test('resolveVideo: URL non-YouTube ditolak tanpa jaringan', async () => {
  await assert.rejects(() => resolveVideo('http://127.0.0.1:8080/x', {}), /YouTube/);
});

test('calculate: aritmetika aman tanpa eval', () => {
  assert.equal(calculate('2+3*4'), 14);
  assert.equal(calculate('(2+3)*4'), 20);
  assert.equal(calculate('2^3^2'), 512);
  assert.equal(calculate('10 % 3'), 1);
  assert.equal(calculate('-5 + max(2, 7)'), 2);
  assert.equal(calculate('sqrt(81)'), 9);
  assert.equal(calculate('round(2.6)'), 3);
  assert.throws(() => calculate('2 + system'), /tidak dikenal/);
  assert.throws(() => calculate('(1+2'), /kurung/);
});
