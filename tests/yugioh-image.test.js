import test from 'node:test';
import assert from 'node:assert/strict';

import { isExactGuess, maskName, normalizeStrict } from '../lib/guess.js';
import { YgoQuiz } from '../lib/yugioh-quiz.js';
import { buildImageModeOptions } from '../plugins/game-yugioh-image.js';

/** Harness: API palsu + pengiriman pesan yang direkam. */
function makeHarness({ options = {}, cardIndex = 0, cards } = {}) {
  const sent = [];
  const pool = cards || [
    { name: 'Dark Magician', type: 'Normal Monster', attribute: 'DARK', level: 7, race: 'Spellcaster', card_images: [{ image_url_cropped: 'art1' }] },
    { name: 'Blue-Eyes White Dragon', type: 'Normal Monster', attribute: 'LIGHT', level: 8, race: 'Dragon', card_images: [{ image_url_cropped: 'art2' }] },
  ];
  const card = pool[cardIndex];

  const client = {
    random: async () => ({ data: [card] }),
    card: async () => ({ data: pool }),
  };

  const quiz = new YgoQuiz({
    client,
    options,
    send: async (chat, content) => {
      sent.push({ chat, ...content });
      return { ok: true };
    },
  });
  return { quiz, sent, card };
}

const textOf = (sent) => sent.map((item) => item.text || item.caption || '').join('\n');

// ── Pencocokan persis ──────────────────────────────────────────────────────

test('isExactGuess: besar/kecil huruf & tanda baca dimaklumi, typo tidak', () => {
  const card = { name: 'Blue-Eyes White Dragon' };

  assert.equal(isExactGuess('Blue-Eyes White Dragon', card), true);
  assert.equal(isExactGuess('blue eyes white dragon', card), true, 'huruf kecil harus diterima');
  assert.equal(isExactGuess('BLUE-EYES  WHITE   DRAGON', card), true, 'spasi berlebih dimaklumi');
  assert.equal(isExactGuess('  blue eyes white dragon  ', card), true);

  assert.equal(isExactGuess('Blue Eyes White Dragn', card), false, 'typo harus ditolak');
  assert.equal(isExactGuess('Blue Eyes White', card), false);
  assert.equal(isExactGuess('Blue Eyes Ultimate Dragon', card), false);
  assert.equal(isExactGuess('', card), false);

  // nama dengan tanda baca & apostrof
  assert.equal(isExactGuess('kuriboh', { name: 'Kuriboh' }), true);
  assert.equal(isExactGuess("pot of greed", { name: 'Pot of Greed' }), true);
  assert.equal(normalizeStrict('Axe of Despair & Hope'), 'axe of despair and hope');
});

test('maskName menyamarkan sebagian huruf dan makin terbuka tiap tingkat', () => {
  assert.equal(maskName('Dark Magician', { reveal: 1 }), 'D*** M*******');
  assert.equal(maskName('Dark Magician', { reveal: 2 }), 'Da*k Ma*****n');
  assert.equal(maskName('Kuriboh', { reveal: 1 }), 'K******');
  assert.equal(maskName('Jinzo', { reveal: 3 }), 'Jin*o');
});

// ── Mode gambar saja ───────────────────────────────────────────────────────

const imageOptions = () =>
  buildImageModeOptions({
    game: { yugioh: { hintCost: 3, maxHints: 3, imageAttempts: 5, imageTimeoutMs: 90000, imageRounds: 2, roundDelayMs: 0 } },
  });

test('mode gambar-saja: kirim gambar TANPA pilihan A/B/C/D', async () => {
  const { quiz, sent } = makeHarness({ options: { ...imageOptions(), roundDelayMs: 0 } });
  await quiz.start('chat@g.us', { starter: 'a@s.whatsapp.net', rounds: 1, mode: 'teks', options: imageOptions() });

  const all = textOf(sent);
  assert.equal(sent[0].image.url, 'art1', 'gambar kartu harus dikirim');
  assert.match(all, /TEBAK NAMA KARTU/);
  assert.doesNotMatch(all, /A\. /, 'tidak boleh ada daftar pilihan');
  assert.doesNotMatch(all, /Dark Magician|Blue-Eyes/, 'nama kartu tidak boleh bocor');
  assert.match(all, /harus tepat/i, 'harus menjelaskan jawaban tepat');
  assert.match(all, /\.hint/, 'harus menawarkan petunjuk berbayar');
  assert.match(all, /3 limit/, 'harga petunjuk harus disebut');
  assert.match(all, /maks 3x per ronde/, 'batas petunjuk harus disebut');
  await quiz.stop('chat@g.us', { silent: true });
});

test('mode gambar-saja: typo dianggap salah, ejaan sama (beda kapital) benar', async () => {
  const { quiz, sent } = makeHarness({ options: imageOptions() });
  await quiz.start('chat@g.us', { starter: 'a@s.whatsapp.net', rounds: 1, mode: 'teks', options: imageOptions() });

  const wrong = await quiz.handleGuess('chat@g.us', { sender: 'p1@s.whatsapp.net', name: 'P1', text: 'Dark Magican' });
  assert.equal(wrong.correct, false, 'typo harus salah');
  assert.equal(sent.at(-1).text, '❌ Salah');
  assert.equal(quiz.has('chat@g.us'), true, 'ronde tetap jalan');

  const right = await quiz.handleGuess('chat@g.us', { sender: 'p2@s.whatsapp.net', name: 'P2', text: 'dark magician' });
  assert.equal(right.correct, true, 'ejaan benar (huruf kecil) harus diterima');
  // ronde terakhir langsung ditutup, jadi periksa seluruh pesan — bukan hanya yang terakhir
  assert.match(textOf(sent), /BENAR/);
  assert.match(textOf(sent), /Game selesai/);
  await quiz.stop('chat@g.us', { silent: true });
});

test('format gambar-saja punya percobaan lebih banyak daripada mode pilihan', () => {
  const options = imageOptions();
  assert.equal(options.strict, true);
  assert.equal(options.showChoices, false);
  assert.equal(options.autoHints, false, 'petunjuk gratis harus mati (ada hint berbayar)');
  assert.equal(options.hintCost, 3);
  assert.equal(options.maxHints, 3, 'batas petunjuk default 3x per ronde');
  assert.ok(options.maxAttempts >= 3);
});

test('default petunjuk tanpa config: 3 limit per petunjuk & maks 3x per ronde', () => {
  const options = buildImageModeOptions({ game: { yugioh: {} } });
  assert.equal(options.mode, 'teks');
  assert.equal(options.strict, true);
  assert.equal(options.hintCost, 3, 'harga default 3 limit');
  assert.equal(options.maxHints, 3, 'batas default 3x per pemain per ronde');
});

// ── Petunjuk berbayar ──────────────────────────────────────────────────────

test('hint membuka huruf bertahap dan dibatasi maxHints', async () => {
  const { quiz } = makeHarness({ options: imageOptions() });
  await quiz.start('chat@g.us', { starter: 'a@s.whatsapp.net', rounds: 1, mode: 'teks', options: { ...imageOptions(), maxHints: 2 } });

  const first = await quiz.hint('chat@g.us', { sender: 'p1@s.whatsapp.net', name: 'P1' });
  assert.equal(first.handled, true);
  assert.equal(first.reveals, 1);
  assert.equal(first.cost, 3, 'biaya petunjuk 3 limit');
  assert.equal(first.data.masked, 'D*** M*******');
  assert.match(first.data.info, /DARK/);

  const second = await quiz.hint('chat@g.us', { sender: 'p1@s.whatsapp.net', name: 'P1' });
  assert.equal(second.data.masked, 'Da*k Ma*****n', 'petunjuk kedua lebih terbuka');

  const third = await quiz.hint('chat@g.us', { sender: 'p1@s.whatsapp.net', name: 'P1' });
  assert.equal(third.reason, 'max-hint');
  assert.equal(third.reveals, 2, 'tidak menambah hitungan saat sudah maksimal');

  // pemain lain punya jatah sendiri
  const other = await quiz.hint('chat@g.us', { sender: 'p2@s.whatsapp.net', name: 'P2' });
  assert.equal(other.reveals, 1);
  await quiz.stop('chat@g.us', { silent: true });
});

test('hint tanpa game berjalan tidak melakukan apa-apa', async () => {
  const { quiz } = makeHarness({ options: imageOptions() });
  const result = await quiz.hint('kosong@g.us', { sender: 'p1@s.whatsapp.net' });
  assert.equal(result.handled, false);
  assert.equal(result.reason, 'no-game');
});

test('petunjuk direset tiap ronde baru', async () => {
  const { quiz } = makeHarness({
    options: imageOptions(),
    cards: [
      { name: 'Dark Magician', type: 'Normal Monster', attribute: 'DARK', card_images: [{ image_url_cropped: 'art1' }] },
      { name: 'Jinzo', type: 'Effect Monster', attribute: 'DARK', card_images: [{ image_url_cropped: 'art2' }] },
    ],
  });
  await quiz.start('chat@g.us', { starter: 'a@s.whatsapp.net', rounds: 2, mode: 'teks', options: { ...imageOptions(), roundDelayMs: 0 } });
  await quiz.hint('chat@g.us', { sender: 'p1@s.whatsapp.net' });

  await quiz.handleGuess('chat@g.us', { sender: 'p2@s.whatsapp.net', name: 'P2', text: 'dark magician' });
  const state = quiz.get('chat@g.us');
  assert.equal(state.round, 2);
  assert.equal(state.hintReveals.size, 0, 'hitungan petunjuk harus direset tiap ronde');
  await quiz.stop('chat@g.us', { silent: true });
});

// ── Plugin .tebakgambar + .hint (potong limit sungguhan) ───────────────────

const PLUGIN_CARD = {
  id: 46986414,
  name: 'Dark Magician',
  type: 'Normal Monster',
  attribute: 'DARK',
  level: 7,
  race: 'Spellcaster',
  atk: 2500,
  def: 2100,
  archetype: 'Dark Magician',
  card_images: [{ image_url_cropped: 'https://images.ygoprodeck.com/images/cards_cropped/46986414.jpg' }],
};

test('plugin .tebakgambar memotong 1 limit; .hint 3 limit & dibatasi 3x per ronde', async () => {
  const { default: imagePlugin } = await import('../plugins/game-yugioh-image.js');
  const { getQuiz } = await import('../lib/quiz-instance.js');

  globalThis.fetch = async (url) => {
    const target = String(url);
    const payload = target.includes('randomcard.php')
      ? { data: [PLUGIN_CARD] }
      : target.includes('cardinfo.php')
        ? { data: [PLUGIN_CARD, { ...PLUGIN_CARD, id: 2, name: 'Dark Magician Girl' }, { ...PLUGIN_CARD, id: 3, name: 'Magician of Black Chaos' }] }
        : { error: 'endpoint tidak diharapkan' };
    return { ok: Boolean(payload.data), status: payload.data ? 200 : 404, text: async () => JSON.stringify(payload) };
  };

  const sent = [];
  const conn = {
    user: { id: '628999@s.whatsapp.net' },
    sendMessage: async (chat, content) => {
      sent.push({ chat, ...content });
      return { key: { id: `M${sent.length}` } };
    },
  };
  const users = { '628222@s.whatsapp.net': { jid: '628222@s.whatsapp.net', saldo: 0, exp: 0, limit: 20 } };
  const db = {
    data: { users },
    touch() {},
    user(jid) {
      if (!users[jid]) users[jid] = { jid, saldo: 0, exp: 0, limit: 20 };
      return users[jid];
    },
  };
  const config = {
    bot: { prefix: ['.'] },
    limits: { free: 20, premium: 100 },
    game: {
      yugioh: {
        rounds: 3,
        maxRounds: 10,
        imageRounds: 1,
        imageAttempts: 5,
        imageTimeoutMs: 4000,
        roundDelayMs: 0,
        hintCost: 3,
        maxHints: 3,
        rewardSaldo: 500,
        rewardExp: 25,
        rewardLimit: 1,
      },
    },
    ygoprodeck: { cacheFile: false },
  };
  const user = db.user('628222@s.whatsapp.net');
  const m = (text) => ({
    chat: 'img@g.us',
    sender: '628222@s.whatsapp.net',
    fromMe: false,
    pushName: 'Pemain',
    text,
    reply: async (value) => sent.push({ chat: 'img@g.us', text: String(value) }),
  });
  const ctx = (command) => ({ conn, args: [], config, db, user, usedPrefix: '.', command });

  await imagePlugin(m('.tebakgambar'), ctx('tebakgambar'));
  const startBody = sent.map((item) => item.text || item.caption || '').join('\n');
  assert.match(startBody, /TEBAK NAMA KARTU/);
  assert.doesNotMatch(startBody, /A\. /, 'tidak boleh ada pilihan ganda');
  assert.equal(user.limit, 19, 'mulai game memotong 1 limit');

  await imagePlugin(m('.hint'), ctx('hint'));
  assert.match(sent.at(-1).text, /PETUNJUK 1\/3/);
  assert.match(sent.at(-1).text, /biaya 3 limit/);
  assert.match(sent.at(-1).text, /D\*\*\* M\*\*\*\*\*\*\*/);
  assert.equal(user.limit, 16, 'petunjuk pertama memotong 3 limit');

  await imagePlugin(m('.hint'), ctx('hint'));
  await imagePlugin(m('.hint'), ctx('hint'));
  assert.equal(user.limit, 10, '3 petunjuk = 9 limit');
  assert.match(sent.at(-1).text, /PETUNJUK 3\/3/);

  // Pembelian ke-4 ditolak SEBELUM memotong limit.
  await assert.rejects(() => imagePlugin(m('.hint'), ctx('hint')), /sudah memakai \*3\* petunjuk/);
  assert.equal(user.limit, 10, 'limit tidak boleh terpotong saat jatah petunjuk habis');

  await getQuiz().stop('img@g.us', { silent: true });
});
