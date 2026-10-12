// Cek manual game tebak kartu Yu-Gi-Oh! memakai API asli (tanpa WhatsApp).
//   node scripts/yugioh-quiz-check.mjs
import { createClient } from '../lib/ygoprodeck.js';
import { YgoQuiz } from '../lib/yugioh-quiz.js';

const sent = [];
const quiz = new YgoQuiz({
  client: createClient({ cacheFile: '' }),
  options: { rounds: 1, mode: 'pilihan', timeoutMs: 30000, roundDelayMs: 0 },
  db: null,
  send: async (_chat, content) => {
    sent.push(content);
    return { ok: true };
  },
});

const chat = 'check@chat';
await quiz.start(chat, { starter: 'tester', rounds: 1 });

const image = sent.find((item) => item.image);
const choicesMessage = sent.find((item) => item.text?.includes('A.'));

console.log('art crop   :', image?.image?.url || '(TIDAK ADA)');
console.log('pakai crop :', /cards_cropped/.test(image?.image?.url || '') ? 'YA (nama kartu aman)' : 'TIDAK — nama kartu bisa terlihat!');
console.log('caption    :', (image?.caption || '').replace(/\n/g, ' | '));
console.log('pilihan    :', (choicesMessage?.text || '').split('\n').slice(0, 4).join(' / '));

const state = quiz.get(chat);
if (!state) {
  console.log('status     : game tidak berjalan (gagal ambil kartu dari API)');
  process.exit(1);
}

const correct = state.choices.find((choice) => choice.correct).label;
console.log('jawaban    :', correct, '->', state.card.name);
console.log('nama bocor :', (image?.caption || '').includes(state.card.name) ? 'YA (BUG!)' : 'tidak');

await quiz.handleGuess(chat, { sender: 'tester', name: 'Tester', text: correct });
console.log('hasil      :', (sent.at(-1)?.text || '').split('\n')[0]);
console.log('game usai  :', !quiz.has(chat));
