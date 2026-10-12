// Cek manual game tebak kartu Yu-Gi-Oh! memakai API asli (tanpa WhatsApp).
//   node scripts/yugioh-quiz-check.mjs
//
// Menguji dua mode: pilihan ganda (.tebakygo) dan gambar-saja (.tebakgambar,
// termasuk aturan jawaban persis + petunjuk berbayar).
import { createClient } from '../lib/ygoprodeck.js';
import { YgoQuiz } from '../lib/yugioh-quiz.js';

const LABEL = 13;
const say = (label, value) => console.log(`${label.padEnd(LABEL)}: ${value}`);
const section = (title) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 46 - title.length))}`);

const newQuiz = (options) => {
  const sent = [];
  const quiz = new YgoQuiz({
    client: createClient({ cacheFile: '' }),
    options,
    db: null,
    send: async (_chat, content) => {
      sent.push(content);
      return { ok: true };
    },
  });
  return { quiz, sent };
};

// ── Mode pilihan ganda (.tebakygo) ────────────────────────────────────────
const { quiz, sent } = newQuiz({ rounds: 1, mode: 'pilihan', timeoutMs: 30000, roundDelayMs: 0 });

section('mode pilihan ganda (.tebakygo)');
const chat = 'check@chat';
await quiz.start(chat, { starter: 'tester', rounds: 1 });

const image = sent.find((item) => item.image);
const choicesMessage = sent.find((item) => item.text?.includes('A.'));

say('art crop', image?.image?.url || '(TIDAK ADA)');
say('pakai crop', /cards_cropped/.test(image?.image?.url || '') ? 'YA — nama kartu aman' : 'TIDAK — nama kartu bisa terlihat!');
say('caption', (image?.caption || '').replace(/\n/g, ' | '));
say('pilihan', (choicesMessage?.text || '').split('\n').slice(0, 4).join(' / '));

const state = quiz.get(chat);
if (!state) {
  say('status', 'GAGAL — game tidak berjalan (gagal ambil kartu dari API)');
  process.exit(1);
}

const correct = state.choices.find((choice) => choice.correct).label;
say('jawaban', `${correct} → ${state.card.name}`);
say('nama bocor', (image?.caption || '').includes(state.card.name) ? 'YA (BUG!)' : 'tidak');

await quiz.handleGuess(chat, { sender: 'tester', name: 'Tester', text: correct });
say('hasil tebak', (sent.at(-1)?.text || '').split('\n')[0]);
say('game usai', quiz.has(chat) ? 'BELUM (BUG!)' : 'ya');

// ── Mode gambar saja (.tebakgambar) ──────────────────────────────────────
const imageOptions = {
  rounds: 1,
  mode: 'teks',
  timeoutMs: 30000,
  roundDelayMs: 0,
  strict: true, // jawaban harus persis
  showChoices: false, // tanpa pilihan A/B/C/D
  autoHints: false, // petunjuk hanya lewat `.hint` berbayar
  hintCost: 3,
  maxHints: 3,
  maxAttempts: 5,
};

const { quiz: imageQuiz, sent: imageSent } = newQuiz(imageOptions);
const imageChat = 'check-image@chat';

section('mode gambar saja (.tebakgambar)');
await imageQuiz.start(imageChat, { starter: 'tester', rounds: 1, mode: 'teks', prefix: '.', options: imageOptions });

const imageState = imageQuiz.get(imageChat);
if (!imageState) {
  say('status', 'GAGAL — game tidak berjalan (gagal ambil kartu dari API)');
  process.exit(1);
}

const imageMsg = imageSent.find((item) => item.image);
const joined = imageSent.map((item) => item.text || item.caption || '').join('\n');

say('caption', (imageMsg?.caption || '').replace(/\n/g, ' | '));
say('pilihan', /(^|\n)[A-D]\. /.test(joined) ? 'ADA (BUG!)' : 'tidak ada — benar');
say('nama bocor', joined.includes(imageState.card.name) ? 'YA (BUG!)' : 'tidak');

const hints = [];
for (let index = 0; index < imageOptions.maxHints + 1; index += 1) {
  hints.push(await imageQuiz.hint(imageChat, { sender: 'tester', name: 'Tester' }));
}
hints.forEach((item, index) => {
  say(`petunjuk ${index + 1}`, item.reason ? `ditolak (${item.reason})` : `${item.data.masked} • ${item.cost} limit`);
});
const hintCapped = hints.at(-1).reason === 'max-hint';

const typo = await imageQuiz.handleGuess(imageChat, { sender: 'tester', name: 'Tester', text: `${imageState.card.name.toLowerCase()}zz` });
say('typo', typo.correct ? 'DITERIMA (BUG!)' : 'ditolak — benar');

const exact = await imageQuiz.handleGuess(imageChat, { sender: 'tester', name: 'Tester', text: imageState.card.name.toLowerCase() });
say('beda kapital', exact.correct ? 'diterima — benar' : 'DITOLAK (BUG!)');
say('game usai', imageQuiz.has(imageChat) ? 'BELUM (BUG!)' : 'ya');

// ── Ringkasan ────────────────────────────────────────────────────────────
section('ringkasan');
say('game pilihan', quiz.has(chat) ? 'masih jalan (BUG!)' : 'OK');
say('game gambar', imageQuiz.has(imageChat) ? 'masih jalan (BUG!)' : 'OK');
say('batas hint', hintCapped ? `OK — maks ${imageOptions.maxHints}x per ronde` : 'GAGAL — batas tidak berlaku');
