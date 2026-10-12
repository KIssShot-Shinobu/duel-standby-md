import test from 'node:test';
import assert from 'node:assert/strict';

import { botInfo, err, joinLines, ok, profileText, resultText, friendlyNumber, userName } from '../lib/messages.js';

/**
 * WhatsApp memakai SATU asterisk untuk bold (`*teks*`). Kalau kode memakai
 * `**teks**`, chat menampilkan bintang liar di kiri-kanan teks.
 */
const m = { sender: '628111222333@s.whatsapp.net', pushName: 'Budi' };

test('helper pesan tidak memakai markdown ** (harus * saja)', () => {
  const outputs = [
    profileText(
      {
        name: 'Budi',
        age: 20,
        registered: true,
        premium: true,
        until: '1/1/2027',
        level: 3,
        exp: 900,
        limit: 12,
        quota: 100,
        saldo: 500,
        rank: 2,
        totalUsers: 10,
        totalCommands: 42,
        banned: null,
        isSelf: true,
        limitBonus: 10,
      },
      m,
    ),
    botInfo(
      {
        name: 'RTXZY Clean',
        version: '1.3.0',
        ownerName: 'Owner',
        pluginCount: 49,
        commandCount: 99,
        userCount: 3,
        chatCount: 2,
        messageCount: 10,
        prefix: ['.', '#'],
        mode: 'public',
        nodeVersion: 'v22.11.0',
        ffmpeg: true,
        ytdlp: false,
        connected: true,
      },
      m,
    ),
    resultText('Judul Lagu', { duration: '3:00', size: '1,2 MB', format: 'MP3', note: 'catatan' }),
    joinLines(['baris satu', 'baris dua']),
    ok('beres'),
    err('gagal'),
  ];

  for (const out of outputs) {
    assert.doesNotMatch(out, /\*\*/, `markdown salah: ${out.split('\n')[0]}`);
  }
});

test('teks penting tetap ditebalkan dengan satu asterisk', () => {
  assert.match(profileText({ name: 'Budi', level: 1, exp: 0, limit: 1, quota: 20, isSelf: true }, m), /\*Profilmu/);
  assert.match(botInfo({ name: 'Bot' }, m), /\*Bot\*/);
  assert.match(resultText('Lagu'), /\*Lagu\*/);
});

test('friendlyNumber mengubah 62xx menjadi 08xx', () => {
  assert.equal(friendlyNumber('628222333444@s.whatsapp.net'), '08222333444');
  assert.equal(friendlyNumber(''), '-');
});

test('userName memakai pushName atau nomor', () => {
  assert.equal(userName({ pushName: 'Budi', sender: '628111@s.whatsapp.net' }), 'Budi');
  assert.equal(userName({ sender: '628111@s.whatsapp.net' }), '628111');
});
