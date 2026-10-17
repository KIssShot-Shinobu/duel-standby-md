/**
 * Caption reaction-gif harus menyebut NAMA target, bukan nomornya.
 *
 * Mekanismenya bukan bot yang menebak nama: WhatsApp yang mengganti token
 * `@angka` di teks menjadi nama asalkan JID-nya ada di `contextInfo.mentionedJid`
 * — sama seperti mention di `plugins/_afk.js` dan `plugins/_welcome.js`. Karena
 * itu token dan `mentions` harus memakai bentuk identitas yang sama. Yang dulu
 * rusak: caption reaction dikirim lewat `sendImageResult()`, dan fungsi itu
 * membuang `mentions` sehingga token `@628xx` terkirim tanpa metadata mention dan
 * WhatsApp hanya menampilkan angkanya. Test di sini mengunci dua hal:
 *   1. `mentions` benar-benar diteruskan sampai ke `conn.sendMessage`;
 *   2. token `@…` di caption selalu sama dengan JID di `mentions`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import baseConfig from '../config.js';
import { clearListCache } from '../lib/image-source.js';
import { sendImageResult } from '../lib/media-send.js';

const NEKOSBEST = {
  results: [{ url: 'https://images.test/kick.gif', artist_name: 'Anon', source_url: 'https://source.test/1' }],
};

const SENDER = '628111222333@s.whatsapp.net';
const TARGET_PHONE = '628999888777@s.whatsapp.net';
const TARGET_LID = '271446714642565@lid';
const BOT = '628000000000@s.whatsapp.net';

/** fetch tiruan: katalog nekos.best + buffer gambar. */
function stubFetch() {
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('images.test')) {
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('gif palsu') };
    }
    if (target.includes('nekos.best')) {
      return { ok: true, status: 200, text: async () => JSON.stringify(NEKOSBEST) };
    }
    return { ok: false, status: 404, text: async () => '{"error":"rute tidak dikenal"}' };
  };
}

const testConfig = {
  ...baseConfig,
  bot: { ...baseConfig.bot, name: 'ECCLESIA' },
  images: { ...baseConfig.images, cacheDir: '', timeoutMs: 2000 },
  rent: { ...baseConfig.rent, enabled: false },
};

/** Payload yang membawa caption (jalur gambar/stiker memakai field berbeda). */
function captionPayload(sent) {
  const content = sent.map((item) => item.content).find((item) => item && (item.caption || item.text));
  assert.ok(content, 'harus ada pesan ber-caption');
  return { content, caption: content.caption || content.text };
}

/**
 * Jalankan `.kick` sesuai skenario nyata.
 * @param {{targetJid?: string, quoted?: any, pushName?: string}} options
 */
async function runKick({ targetJid = TARGET_PHONE, quoted = null, pushName = 'Shinobu' } = {}) {
  clearListCache();
  stubFetch();

  const sent = [];
  const conn = {
    user: { id: BOT },
    contacts: {},
    getName: async (jid) => String(jid).split('@')[0],
    sendMessage: async (chat, content) => {
      sent.push({ chat, content });
      return { key: { id: `M${sent.length}` } };
    },
  };
  const m = {
    chat: '123@g.us',
    sender: SENDER,
    fromMe: false,
    isGroup: true,
    pushName,
    mentionedJid: targetJid && !quoted ? [targetJid] : [],
    quoted,
    reply: async () => ({ key: { id: 'R' } }),
  };

  const { default: plugin } = await import('../plugins/reaction-gif.js');
  await plugin(m, {
    conn,
    config: testConfig,
    command: 'kick',
    args: [],
    text: '',
    usedPrefix: '.',
  });

  assert.ok(sent.length >= 1, 'harus mengirim sesuatu');
  return sent;
}

test('reaction-gif: token id di caption disertai mentions (jalur render nama WhatsApp)', async () => {
  const sent = await runKick({});
  const { content, caption } = captionPayload(sent);

  assert.equal(caption, '*Shinobu* nendang *@628999888777* 👢');
  assert.deepEqual(content.mentions, [TARGET_PHONE], 'JID target wajib ikut terkirim');
});

test('reaction-gif: target LID -> token & mentions pakai bentuk LID dari WhatsApp', async () => {
  const sent = await runKick({ targetJid: TARGET_LID });
  const { content, caption } = captionPayload(sent);

  // Persis seperti WhatsApp sendiri menulis mention di log:
  // `. Punch @183498317000877` — angka LID, bukan nama, bukan nomor telepon.
  assert.equal(caption, '*Shinobu* nendang *@271446714642565* 👢');
  assert.deepEqual(content.mentions, [TARGET_LID], 'mention wajib memakai bentuk yang sama dengan token');
});

test('reaction-gif: target dari pesan yang di-reply', async () => {
  const sent = await runKick({ targetJid: null, quoted: { sender: TARGET_PHONE } });
  const { content, caption } = captionPayload(sent);

  assert.equal(caption, '*Shinobu* nendang *@628999888777* 👢');
  assert.deepEqual(content.mentions, [TARGET_PHONE]);
});

test('reaction-gif: bot tidak menebak nama sendiri dari cache pushName', async () => {
  // Cache nama bot (`conn.getName`) tidak dipakai lagi: kalau dipakai, token
  // `@Shinobu` tidak akan cocok dengan JID mana pun di `mentions` sehingga
  // WhatsApp kembali menampilkan angka — bug yang justru sedang diperbaiki.
  const sent = await runKick({});
  const { caption } = captionPayload(sent);

  assert.doesNotMatch(caption, /Shinobu\*? 👢$/, 'caption tidak boleh memakai nama sebagai token');
});

test('reaction-gif: self-reaction tidak mengirim mention', async () => {
  const sent = await runKick({ targetJid: null });
  const { content, caption } = captionPayload(sent);

  assert.equal(caption, '*Shinobu* nendang *ECCLESIA* 😳 👢');
  assert.equal(content.mentions, undefined, 'self-reaction tidak perlu mentions');
});

test('sendImageResult: mentions diteruskan ke sendMessage (akar masalah caption gambar)', async () => {
  const sent = [];
  const conn = {
    user: { id: BOT },
    sendMessage: async (chat, content) => {
      sent.push(content);
      return { key: { id: 'M1' } };
    },
  };

  const mode = await sendImageResult(conn, '123@g.us', {
    buffer: Buffer.from('gambar'),
    caption: 'hai *@628999888777*',
    mentions: [TARGET_PHONE],
  });

  assert.equal(mode, 'image');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].mentions, [TARGET_PHONE]);
});

test('sendImageResult: tanpa mentions tidak menambah field apa pun', async () => {
  const sent = [];
  const conn = {
    user: { id: BOT },
    sendMessage: async (chat, content) => {
      sent.push(content);
      return { key: { id: 'M1' } };
    },
  };

  await sendImageResult(conn, '123@g.us', { buffer: Buffer.from('gambar'), caption: 'hai' });

  assert.equal('mentions' in sent[0], false);
});
