import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildChoices,
  isCorrectGuess,
  levenshtein,
  matchChoice,
  normalizeAnswer,
} from '../lib/guess.js';
import { YgoQuiz } from '../lib/yugioh-quiz.js';

// ── Data uji ───────────────────────────────────────────────────────────────

const CARDS = [
  {
    id: 46986414,
    name: 'Dark Magician',
    type: 'Normal Monster',
    attribute: 'DARK',
    race: 'Spellcaster',
    atk: 2500,
    def: 2100,
    archetype: 'Dark Magician',
    card_images: [{ image_url_cropped: 'https://images.ygoprodeck.com/images/cards_cropped/46986414.jpg' }],
  },
  {
    id: 38033121,
    name: 'Dark Magician Girl',
    type: 'Effect Monster',
    attribute: 'DARK',
    race: 'Spellcaster',
    atk: 2000,
    def: 1700,
    archetype: 'Dark Magician',
    card_images: [{ image_url_cropped: 'https://images.ygoprodeck.com/images/cards_cropped/38033121.jpg' }],
  },
  {
    id: 89631139,
    name: 'Blue-Eyes White Dragon',
    type: 'Normal Monster',
    attribute: 'LIGHT',
    race: 'Dragon',
    atk: 3000,
    def: 2500,
    archetype: 'Blue-Eyes',
    card_images: [{ image_url_cropped: 'https://images.ygoprodeck.com/images/cards_cropped/89631139.jpg' }],
  },
  {
    id: 89631140,
    name: 'Blue-Eyes Alternative White Dragon',
    type: 'Effect Monster',
    attribute: 'LIGHT',
    race: 'Dragon',
    atk: 3000,
    def: 2500,
    archetype: 'Blue-Eyes',
    card_images: [{ image_url_cropped: 'https://images.ygoprodeck.com/images/cards_cropped/89631140.jpg' }],
  },
];

const seededRandom = (seed = 42) => {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
};

const makeHarness = ({ cardIndex = 0, options = {}, withDb = true } = {}) => {
  const sent = [];
  const card = CARDS[cardIndex];
  const client = {
    random: async () => ({ data: [card] }),
    card: async () => ({ data: CARDS.filter((item) => item.name !== card.name) }),
  };
  const users = new Map();
  const db = withDb
    ? {
        users,
        user(jid) {
          if (!users.has(jid)) users.set(jid, { jid, saldo: 0, exp: 0, limit: 0, ygoWins: 0 });
          return users.get(jid);
        },
        touch() {},
      }
    : null;

  const quiz = new YgoQuiz({
    client,
    db,
    random: seededRandom(7),
    options: { rounds: 1, mode: 'pilihan', timeoutMs: 5000, roundDelayMs: 0, maxAttempts: 3, ...options },
    send: async (chat, content) => {
      sent.push({ chat, ...content });
      return { ok: true };
    },
  });

  return { quiz, sent, card, db, users, client };
};

const textOf = (sent) => sent.map((item) => item.text || '').join('\n');

// ── Helper pencocokan jawaban ──────────────────────────────────────────────

test('normalizeAnswer membersihkan tanda baca dan kata umum', () => {
  assert.equal(normalizeAnswer("Blue-Eyes White Dragon!"), 'blue eyes white dragon');
  assert.equal(normalizeAnswer('  Dark   Magician  '), 'dark magician');
  assert.equal(normalizeAnswer('Yu-Gi-Oh! Card: Dark Magician'), 'dark magician');
});

test('levenshtein menghitung jarak edit', () => {
  assert.equal(levenshtein('dark', 'dark'), 0);
  assert.equal(levenshtein('dark', 'drak'), 2);
  assert.equal(levenshtein('', 'abc'), 3);
});

test('isCorrectGuess toleran salah ketik, tapi tidak menerima nama lain', () => {
  const card = CARDS[0];
  assert.equal(isCorrectGuess('Dark Magician', card), true);
  assert.equal(isCorrectGuess('dark magican', card), true); // 1 huruf hilang
  assert.equal(isCorrectGuess('46986414', card), true); // passcode
  assert.equal(isCorrectGuess('Blue-Eyes White Dragon', card), false);
  assert.equal(isCorrectGuess('Dark', card), false); // terlalu pendek
  // archetype tidak dihitung sebagai jawaban kartu
  assert.equal(isCorrectGuess('Dark Magician', CARDS[1]), false);
});

test('kartu yang namanya sama dengan archetype tetap bisa dijawab', () => {
  // regresi: sebelumnya varian archetype menghapus varian nama, sehingga
  // "Dark Magician" justru ditolak sebagai jawaban.
  const darkMagician = { name: 'Dark Magician', archetype: 'Dark Magician' };
  assert.equal(isCorrectGuess('Dark Magician', darkMagician), true);
  assert.equal(isCorrectGuess('dark magican', darkMagician), true);

  const girl = { name: 'Dark Magician Girl', archetype: 'Dark Magician' };
  assert.equal(isCorrectGuess('Dark Magician', girl), false);
  // tapi archetype boleh diterima kalau opsinya diaktifkan
  assert.equal(isCorrectGuess('Dark Magician', girl, { allowArchetype: true }), true);
});

test('buildChoices membuat 4 pilihan dengan tepat 1 jawaban benar', () => {
  const choices = buildChoices(CARDS[0], CARDS.slice(1), 4, seededRandom(3));
  assert.equal(choices.length, 4);
  assert.equal(choices.filter((choice) => choice.correct).length, 1);
  assert.deepEqual(choices.map((choice) => choice.label), ['A', 'B', 'C', 'D']);
  assert.ok(choices.some((choice) => choice.name === 'Dark Magician'));
});

test('matchChoice menerima huruf maupun nama', () => {
  const choices = [
    { label: 'A', name: 'Blue-Eyes White Dragon', correct: false },
    { label: 'B', name: 'Dark Magician', correct: true },
  ];
  assert.equal(matchChoice('b', choices).choice.correct, true);
  assert.equal(matchChoice('B)', choices).index, 1);
  assert.equal(matchChoice('dark magician', choices).choice.correct, true);
  assert.equal(matchChoice('xyz', choices), null);
});

// ── Engine game ────────────────────────────────────────────────────────────

test('start: mengirim art crop tanpa membocorkan nama kartu', async () => {
  const { quiz, sent, card } = makeHarness({ cardIndex: 0 });
  const result = await quiz.start('chat@g.us', { starter: '6281@s.whatsapp.net', rounds: 1 });
  assert.equal(result.ok, true);

  const imageMessage = sent.find((item) => item.image);
  assert.ok(imageMessage, 'gambar kartu tidak dikirim');
  assert.match(imageMessage.image.url, /cards_cropped/);
  assert.equal(imageMessage.caption.includes(card.name), false, 'nama kartu bocor di caption!');
  assert.match(imageMessage.caption, /TEBAK KARTU/);

  const choicesMessage = sent.find((item) => item.text && item.text.includes('A.'));
  assert.ok(choicesMessage.text.includes(card.name), 'pilihan ganda tidak memuat jawaban');
  assert.equal((choicesMessage.text.match(/^[A-D]\. /gm) || []).length, 4);

  await quiz.stop('chat@g.us', { silent: true });
});

test('jawaban benar: hadiah masuk ke database dan game lanjut', async () => {
  const { quiz, sent, db } = makeHarness({ cardIndex: 0, options: { rounds: 2 } });
  await quiz.start('chat@g.us', { starter: '6281@s.whatsapp.net', rounds: 2 });
  const state = quiz.get('chat@g.us');
  const correctLabel = state.choices.find((choice) => choice.correct).label;

  const result = await quiz.handleGuess('chat@g.us', { sender: '6281@s.whatsapp.net', name: 'Tester', text: correctLabel });
  assert.equal(result.handled, true);
  assert.equal(result.correct, true);

  const user = db.user('6281@s.whatsapp.net');
  assert.equal(user.saldo, 500);
  assert.equal(user.exp, 25);
  assert.equal(user.ygoWins, 1);

  const body = textOf(sent);
  assert.match(body, /BENAR/);
  // ronde kedua harus dibuka (roundDelayMs = 0)
  assert.equal(quiz.get('chat@g.us').round, 2);
  await quiz.stop('chat@g.us', { silent: true });
});

test('jawaban salah: balasan hanya "❌ Salah" dan ronde tetap jalan', async () => {
  const { quiz, sent, card } = makeHarness({ cardIndex: 2, options: { mode: 'teks', maxAttempts: 2 } });
  await quiz.start('chat@g.us', { starter: '6281@s.whatsapp.net', rounds: 1 });

  const first = await quiz.handleGuess('chat@g.us', { sender: '6281@s.whatsapp.net', name: 'Tester', text: 'kartu salah' });
  assert.equal(first.correct, false);
  assert.equal(sent.at(-1).text, '❌ Salah', 'balasan salah harus persis "❌ Salah"');
  assert.equal(quiz.has('chat@g.us'), true, 'ronde tidak boleh berakhir setelah jawaban salah');

  const second = await quiz.handleGuess('chat@g.us', { sender: '6281@s.whatsapp.net', name: 'Tester', text: 'masih salah' });
  assert.equal(second.correct, false);
  assert.equal(sent.at(-1).text, '❌ Salah');

  // percobaan ketiga: diabaikan tanpa pesan tambahan, ronde TETAP jalan
  const before = sent.length;
  const third = await quiz.handleGuess('chat@g.us', { sender: '6281@s.whatsapp.net', name: 'Tester', text: 'salah lagi' });
  assert.equal(third.reason, 'no-attempts');
  assert.equal(sent.length, before, 'tidak boleh ada pesan tambahan saat percobaan habis');

  const state = quiz.get('chat@g.us');
  assert.ok(state, 'game harus masih berjalan');
  assert.equal(state.round, 1, 'tidak boleh lanjut ke ronde berikutnya');
  assert.equal(state.card.name, card.name, 'kartu tidak boleh diganti');
  const body = textOf(sent);
  assert.doesNotMatch(body, /Jawabannya:/, 'jawaban tidak boleh dibuka karena salah');
  assert.doesNotMatch(body, /Sisa percobaanmu|Percobaanmu di ronde ini habis|Ronde tetap jalan/, 'tidak boleh ada embel-embel');
  await quiz.stop('chat@g.us', { silent: true });
});

test('pemain lain tetap bisa menjawab setelah pemain pertama salah (pilihan ganda)', async () => {
  const { quiz, sent, db } = makeHarness({ cardIndex: 0, options: { rounds: 1, mode: 'pilihan', choiceAttempts: 1 } });
  await quiz.start('chat@g.us', { starter: '6281@s.whatsapp.net', rounds: 1 });

  const state = quiz.get('chat@g.us');
  const wrongLabel = state.choices.find((choice) => !choice.correct).label;
  const correctLabel = state.choices.find((choice) => choice.correct).label;

  const wrong = await quiz.handleGuess('chat@g.us', { sender: '6281@s.whatsapp.net', name: 'Pemain A', text: wrongLabel });
  assert.equal(wrong.correct, false);
  assert.match(textOf(sent), /❌ Salah/);
  assert.equal(quiz.get('chat@g.us').card.name, state.card.name, 'kartu tidak boleh diganti setelah salah');
  assert.equal(quiz.get('chat@g.us').round, 1);

  const right = await quiz.handleGuess('chat@g.us', { sender: '6282@s.whatsapp.net', name: 'Pemain B', text: correctLabel });
  assert.equal(right.correct, true, 'pemain lain harus bisa menjawab benar');

  const winner = db.user('6282@s.whatsapp.net');
  assert.equal(winner.saldo, 500, 'pemenang mendapat hadiah');
  assert.equal(db.user('6281@s.whatsapp.net').saldo, 0, 'yang salah tidak mendapat hadiah');
  assert.equal(quiz.has('chat@g.us'), false, 'ronde terakhir selesai setelah ada yang benar');
  assert.match(textOf(sent), /BENAR/);
});

test('mode teks: jawaban dengan salah ketik tetap diterima', async () => {
  const { quiz, sent } = makeHarness({ cardIndex: 3, options: { mode: 'teks' } });
  await quiz.start('chat@g.us', { starter: '6281@s.whatsapp.net', rounds: 1 });

  // "Blue-Eyes Alternative White Dragn" (kurang 1 huruf)
  const result = await quiz.handleGuess('chat@g.us', {
    sender: '6281@s.whatsapp.net',
    name: 'Tester',
    text: 'blue eyes alternative white dragn',
  });
  assert.equal(result.correct, true);
  assert.match(textOf(sent), /BENAR/);
});

test('menyerah membuka jawaban dan melanjutkan ronde', async () => {
  const { quiz, sent, card } = makeHarness({ cardIndex: 1, options: { rounds: 2 } });
  await quiz.start('chat@g.us', { starter: '6281@s.whatsapp.net', rounds: 2 });
  await quiz.giveUp('chat@g.us', { name: 'Tester' });

  const body = textOf(sent);
  assert.match(body, /menyerah/);
  assert.ok(body.includes(card.name), 'jawaban tidak dibuka');
  assert.equal(quiz.get('chat@g.us').round, 2);
  await quiz.stop('chat@g.us', { silent: true });
});

test('timeout: jawaban dibuka otomatis', async () => {
  const { quiz, sent, card } = makeHarness({ cardIndex: 0, options: { timeoutMs: 80, rounds: 1 } });
  await quiz.start('chat@g.us', { starter: '6281@s.whatsapp.net', rounds: 1 });

  await new Promise((resolve) => setTimeout(resolve, 500));
  const body = textOf(sent);
  assert.match(body, /Waktu habis/);
  assert.ok(body.includes(card.name));
  assert.equal(quiz.has('chat@g.us'), false);
});

test('tebakan di luar pilihan ganda tidak dianggap jawaban', async () => {
  const { quiz } = makeHarness({ cardIndex: 0 });
  await quiz.start('chat@g.us', { starter: '6281@s.whatsapp.net', rounds: 1 });
  const result = await quiz.handleGuess('chat@g.us', { sender: '6281@s.whatsapp.net', text: 'halo apa kabar' });
  assert.equal(result.handled, false);
  await quiz.stop('chat@g.us', { silent: true });
});

test('game ganda di chat yang sama ditolak', async () => {
  const { quiz } = makeHarness({ cardIndex: 0 });
  await quiz.start('chat@g.us', { starter: '6281@s.whatsapp.net', rounds: 2 });
  const second = await quiz.start('chat@g.us', { starter: '6282@s.whatsapp.net' });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'already-running');
  await quiz.stop('chat@g.us', { silent: true });
});

// ── Plugin ─────────────────────────────────────────────────────────────────

// Mock fetch global supaya plugin Yu-Gi-Oh tidak benar-benar memanggil API.
const PLUGIN_CARD = {
  id: 12345678,
  name: 'Kuriboh',
  type: 'Effect Monster',
  attribute: 'DARK',
  race: 'Fiend',
  atk: 300,
  def: 200,
  archetype: 'Kuriboh',
  card_images: [{ image_url_cropped: 'https://images.ygoprodeck.com/images/cards_cropped/12345678.jpg' }],
};
const PLUGIN_DISTRACTORS = [
  { ...PLUGIN_CARD, id: 1, name: 'Winged Kuriboh' },
  { ...PLUGIN_CARD, id: 2, name: 'Kuribohrn' },
  { ...PLUGIN_CARD, id: 3, name: 'Kuribandit' },
];
globalThis.fetch = async (url) => {
  const target = String(url);
  const payload = target.includes('randomcard.php')
    ? { data: [PLUGIN_CARD] }
    : target.includes('cardinfo.php')
      ? { data: PLUGIN_DISTRACTORS }
      : { error: 'endpoint tidak diharapkan' };
  return { ok: Boolean(payload.data), status: payload.data ? 200 : 404, text: async () => JSON.stringify(payload) };
};

test('plugin: perintah .tebakygo, hook tebakan, .stoptebak, dan .yugoscore', async () => {
  const { default: guessPlugin } = await import('../plugins/game-yugioh-guess.js');

  const sent = [];
  const conn = {
    user: { id: '628999@s.whatsapp.net' },
    sendMessage: async (chat, content) => {
      sent.push({ chat, ...content });
      return { key: { id: `M${sent.length}` } };
    },
  };
  const users = { '628111@s.whatsapp.net': { jid: '628111@s.whatsapp.net', saldo: 0, exp: 0, limit: 5, ygoWins: 2, name: 'Juara' } };
  const db = {
    data: { users },
    touch() {},
    user(jid) {
      if (!users[jid]) users[jid] = { jid, saldo: 0, exp: 0, limit: 5, ygoWins: 0 };
      return users[jid];
    },
  };
  const config = {
    bot: { prefix: ['.'] },
    game: { yugioh: { mode: 'pilihan', rounds: 2, timeoutMs: 4000, roundDelayMs: 0, maxAttempts: 3, rewardSaldo: 100, rewardExp: 5, rewardLimit: 1 } },
    ygoprodeck: { cacheFile: false },
  };

  const m = (text) => ({
    chat: '123@g.us',
    sender: '628111@s.whatsapp.net',
    fromMe: false,
    pushName: 'Juara',
    text,
    reply: async (value) => sent.push({ chat: '123@g.us', text: String(value) }),
  });
  const ctx = () => ({ conn, args: [], config, db, user: db.user('628111@s.whatsapp.net'), usedPrefix: '.', isOwner: true });

  await guessPlugin(m('.tebakygo'), { ...ctx(), command: 'tebakygo' });

  const body = sent.map((item) => item.text || item.caption || '').join('\n');
  assert.match(body, /TEBAK KARTU/);
  assert.match(sent.find((item) => item.image).image.url, /cards_cropped/);
  assert.equal(sent.find((item) => item.image).caption.includes('Kuriboh'), false, 'nama bocor di caption');

  // hook: pesan biasa yang bukan pilihan tidak dianggap tebakan
  assert.equal(await guessPlugin.before(m('halo semua'), ctx()), true);
  // hook: huruf pilihan dianggap tebakan -> pemrosesan pesan dihentikan
  assert.equal(await guessPlugin.before(m('A'), ctx()), false);

  await guessPlugin(m('.stoptebak'), { ...ctx(), command: 'stoptebak' });
  await guessPlugin(m('.yugoscore'), { ...ctx(), command: 'yugoscore' });

  const finalBody = sent.map((item) => item.text || item.caption || '').join('\n');
  assert.match(finalBody, /PAPAN SKOR TEBAK KARTU/);
  // jumlah kemenangan boleh berubah (tebakan 'A' bisa benar/salah), yang penting
  // pemain dengan ygoWins > 0 tetap muncul di papan skor
  assert.match(finalBody, /Juara — \d+ benar/);
});
