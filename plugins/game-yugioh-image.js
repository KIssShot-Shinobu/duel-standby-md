/**
 * Game tebak kartu Yu-Gi-Oh! mode GAMBAR SAJA.
 *
 *   .tebakgambar           -> mulai (gambar saja, TANPA pilihan A/B/C/D)
 *   .tebakgambar 5         -> 5 ronde
 *   .hint                  -> beli petunjuk (3 limit), maksimal 3x per pemain per ronde
 *   .nyerah / .stoptebak   -> lihat game yang berjalan (dipakai bersama game lain)
 *
 * Bedanya dengan `.tebakygo`: tidak ada daftar pilihan, jadi pemain harus
 * menulis sendiri nama kartunya dan jawabannya **harus tepat** — hanya
 * besar/kecil huruf, tanda baca, dan spasi yang dimaklumi.
 */
import { ensureQuiz } from '../lib/quiz-instance.js';
import { consumeLimitCost } from '../lib/permissions.js';
import { userError } from '../lib/errors.js';

/** Opsi game mode gambar-saja. */
export function buildImageModeOptions(config) {
  const ygo = config.game?.yugioh || {};
  return {
    mode: 'teks',
    strict: true, // nama harus persis
    showChoices: false, // gambar saja, tanpa pilihan
    autoHints: false, // petunjuk hanya lewat `.hint` berbayar
    hintCost: Math.max(0, Number(ygo.hintCost ?? 3)),
    maxHints: Math.max(1, Number(ygo.maxHints ?? 3)),
    maxAttempts: Math.max(1, Number(ygo.imageAttempts ?? 5)),
    timeoutMs: Number(ygo.imageTimeoutMs ?? ygo.timeoutMs) || 90000,
    roundDelayMs: ygo.roundDelayMs,
    reward: { saldo: ygo.rewardSaldo, exp: ygo.rewardExp, limit: ygo.rewardLimit },
  };
}

const handler = async (m, { conn, args, config, db, user, command, usedPrefix }) => {
  const engine = ensureQuiz(conn, config, db);

  // ── .tebakgambar ─────────────────────────────────────────────────────────
  if (/^(tebakgambar|tebakgambarygo|tg)$/i.test(command)) {
    const tokens = (args || []).map((token) => String(token).toLowerCase());
    const requested = Number(tokens.find((token) => /^\d+$/.test(token))) || undefined;
    const ygo = config.game?.yugioh || {};
    const rounds = requested ? Math.min(requested, Number(ygo.maxRounds) || 10) : Number(ygo.imageRounds) || 3;

    // Biaya membuka game: 1 limit
    const paid = consumeLimitCost(db, user, 1, config);
    if (!paid.ok) throw userError(config.messages?.limit || '_Limit kamu habis._');

    const result = await engine.start(m.chat, {
      starter: m.sender,
      starterName: m.pushName || '',
      rounds,
      mode: 'teks',
      prefix: usedPrefix,
      options: buildImageModeOptions(config),
    });

    if (!result.ok) {
      // limit dikembalikan karena game tidak jadi dimulai
      user.limit = (Number(user.limit) || 0) + 1;
      db.touch();
      return m.reply(
        `⚠️ Masih ada game berjalan di chat ini (ronde ${result.round}/${result.rounds}).\nSelesaikan dulu atau ketik ${usedPrefix}stoptebak.`,
      );
    }

    user.ygoPlays = (Number(user.ygoPlays) || 0) + 1;
    db.touch();
    return true;
  }

  // ── .hint (berbayar) ─────────────────────────────────────────────────────
  if (/^(hint|petunjuk|clue)$/i.test(command)) {
    const state = engine.get(m.chat);
    if (!state) throw userError('Tidak ada game tebak kartu yang berjalan di chat ini.');

    const cost = Math.max(0, Number(state.options.hintCost) || 0);
    const maxHints = Math.max(1, Number(state.options.maxHints) || 3);
    const usedHints = state.hintReveals.get(m.sender) || 0;

    // Cek batas petunjuk SEBELUM memotong limit supaya limit tidak terbuang.
    if (usedHints >= maxHints) {
      throw userError(`❌ Kamu sudah memakai *${maxHints}* petunjuk di ronde ini. Tunggu ronde berikutnya.`);
    }

    if (cost > 0) {
      const paid = consumeLimitCost(db, user, cost, config);
      if (!paid.ok) {
        throw userError(`❌ Limit kamu tidak cukup untuk petunjuk.\nButuh *${cost}* limit, sisa *${paid.limit}*.`);
      }
      const result = await engine.hint(m.chat, { sender: m.sender, name: m.pushName || '' });
      if (!result.handled) throw userError('Tidak ada game berjalan.');
      const sent = await m.reply(
        [
          `💡 *PETUNJUK ${result.reveals}/${maxHints}* — biaya ${cost} limit`,
          '',
          `📝 ${result.data.masked}`,
          `🔎 ${result.data.letters} huruf • ${result.data.info}`,
          '',
          `💳 sisa limit kamu: *${paid.limit}* — sisa jatah petunjuk ronde ini: *${maxHints - result.reveals}*`,
        ].join('\n'),
      );
      // balasan ke pesan petunjuk ini tetap dianggap mengirim jawaban
      engine.remember(m.chat, sent);
      return sent;
    }

    const result = await engine.hint(m.chat, { sender: m.sender, name: m.pushName || '' });
    if (!result.handled) throw userError('Tidak ada game berjalan.');
    const sent = await m.reply(
      [
        `💡 *PETUNJUK ${result.reveals}/${maxHints}*`,
        '',
        `📝 ${result.data.masked}`,
        `🔎 ${result.data.letters} huruf • ${result.data.info}`,
      ].join('\n'),
    );
    engine.remember(m.chat, sent);
    return sent;
  }

  return true;
};

// CATATAN: hook `before` untuk jawaban game TIDAK ada di sini — semua game tebak
// kartu (.tebakygo maupun .tebakgambar) memakai SATU hook di plugins/game-yugioh-guess.js
// karena engine-nya sama (lib/quiz-instance.js). Hook duplikat membuat satu pesan
// diproses dua kali (percobaan terpotong dua kali) dan menelan chat biasa.

handler.help = ['tebakgambar', 'hint'];
handler.tags = ['game'];
handler.command = /^(tebakgambar|tebakgambarygo|tg|hint|petunjuk|clue)$/i;
// Limit dipotong manual (mulai game 1 limit, petunjuk sesuai config).
handler.limit = false;

export default handler;
