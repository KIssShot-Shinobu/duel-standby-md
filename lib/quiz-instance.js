/**
 * Satu instance engine tebak kartu untuk seluruh proses.
 *
 * Dipakai bersama oleh plugin game (mode pilihan ganda maupun mode
 * gambar-saja) supaya `.nyerah`, `.stoptebak`, dan `.hint` selalu menunjuk
 * game yang sama di sebuah chat.
 */
import { getClient } from './ygoprodeck.js';
import { YgoQuiz } from './yugioh-quiz.js';

let quiz = null;
let activeConn = null;

/** Opsi default dari config (bisa ditimpa per game lewat `start(..., { options })`). */
export function buildQuizOptions(config) {
  const options = config?.game?.yugioh || {};
  return {
    rounds: options.rounds,
    mode: options.mode,
    timeoutMs: options.timeoutMs,
    hintDelayMs: options.hintDelayMs,
    maxAttempts: options.maxAttempts,
    choiceAttempts: options.choiceAttempts,
    hintCost: options.hintCost,
    roundDelayMs: options.roundDelayMs,
    reward: { saldo: options.rewardSaldo, exp: options.rewardExp, limit: options.rewardLimit },
  };
}

/** Ambil (atau buat) engine; socket aktif diperbarui setiap pesan masuk. */
export function ensureQuiz(conn, config, db) {
  if (conn) activeConn = conn;
  if (!quiz) {
    quiz = new YgoQuiz({
      client: getClient(config),
      options: buildQuizOptions(config),
      db,
      send: async (chat, content) => {
        if (!activeConn) return null;
        if (content.image) {
          return activeConn.sendMessage(chat, { image: content.image, caption: content.caption || '' });
        }
        return activeConn.sendMessage(chat, { text: content.text || '', mentions: content.mentions || [] });
      },
    });
  } else if (db) {
    quiz.db = db;
  }
  return quiz;
}

export function getQuiz() {
  return quiz;
}

export default { ensureQuiz, getQuiz, buildQuizOptions };
