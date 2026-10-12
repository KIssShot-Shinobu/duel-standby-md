/**
 * Game tebak kartu Yu-Gi-Oh!.
 *
 * Soal memakai GAMBAR ART SAJA (`image_url_cropped`) supaya nama kartu tidak
 * terlihat di gambar — kalau memakai `image_url` (kartu penuh), jawabannya
 * akan tercetak di gambar dan game jadi tidak ada tantangan.
 *
 * Engine ini tidak tahu apa-apa soal WhatsApp: pengiriman pesan lewat
 * callback `send(chat, content)`, sehingga bisa diuji tanpa koneksi.
 */
import { buildChoices, isCorrectGuess, matchChoice, normalizeAnswer, sample } from './guess.js';

export const DEFAULT_OPTIONS = {
  rounds: 3,
  mode: 'pilihan',
  timeoutMs: 60000,
  hintDelayMs: 20000,
  /** percobaan per pemain di mode teks */
  maxAttempts: 3,
  /** percobaan per pemain di mode pilihan ganda (cegah brute-force A/B/C/D) */
  choiceAttempts: 1,
  /** jeda sebelum ronde berikutnya (ms) */
  roundDelayMs: 2500,
  reward: { saldo: 500, exp: 25, limit: 1 },
};

const clamp = (value, min, max) => Math.min(Math.max(Number(value) || min, min), max);
const MODES = new Set(['pilihan', 'teks']);

export class YgoQuiz {
  /**
   * @param {{
   *   client: any,
   *   options?: object,
   *   logger?: any,
   *   send: (chat: string, content: any) => Promise<any>,
   *   db?: any,
   *   random?: () => number
   * }} deps
   */
  constructor({ client, options = {}, logger = console, send, db = null, random = Math.random }) {
    this.client = client;
    this.options = { ...DEFAULT_OPTIONS, ...options, reward: { ...DEFAULT_OPTIONS.reward, ...(options.reward || {}) } };
    this.logger = logger;
    this.send = send;
    this.db = db;
    this.random = random;
    this.games = new Map();
  }

  get(chat) {
    return this.games.get(chat) || null;
  }

  has(chat) {
    return this.games.has(chat);
  }

  /** Mulai game baru di sebuah chat. */
  async start(chat, { starter = '', starterName = '', rounds, mode } = {}) {
    if (this.games.has(chat)) {
      const active = this.games.get(chat);
      return { ok: false, reason: 'already-running', round: active.round, rounds: active.rounds };
    }

    const state = {
      chat,
      starter,
      starterName,
      mode: MODES.has(String(mode).toLowerCase()) ? String(mode).toLowerCase() : this.options.mode,
      rounds: clamp(rounds ?? this.options.rounds, 1, 10),
      round: 0,
      scores: new Map(),
      attempts: new Map(),
      /** pemain yang sudah diberi tahu bahwa percobaannya habis di ronde ini */
      outNotified: new Set(),
      card: null,
      choices: [],
      timeout: null,
      hints: [],
      finished: false,
    };

    this.games.set(chat, state);
    await this.nextRound(state);
    return { ok: true, state };
  }

  /** Hentikan game di sebuah chat. */
  async stop(chat, { silent = false } = {}) {
    const state = this.games.get(chat);
    if (!state) return false;
    this.clearTimers(state);
    state.finished = true;
    this.games.delete(chat);
    if (!silent) {
      await this.send(chat, { text: `🛑 Game tebak kartu dihentikan.\n${this.scoreSummary(state)}` });
    }
    return true;
  }

  /** User menyerah / minta jawaban. */
  async giveUp(chat, { name = '' } = {}) {
    const state = this.games.get(chat);
    if (!state || !state.card) return null;
    await this.reveal(state, name ? `🏳️ *${name}* menyerah.` : '🏳️ Jawaban dibuka.');
    return state.card;
  }

  /**
   * Proses tebakan. Dipanggil dari hook `handler.before`.
   *
   * Penting untuk game rame-rame: jawaban SALAH tidak mengakhiri ronde.
   * Ronde hanya berakhir kalau ada yang menjawab benar atau waktu habis.
   * @returns {Promise<{handled: boolean, correct?: boolean, reason?: string}>}
   */
  async handleGuess(chat, { sender, name = '', text = '' } = {}) {
    const state = this.games.get(chat);
    if (!state || !state.card) return { handled: false, reason: 'no-game' };
    const guess = String(text || '').trim();
    if (!guess || guess.length > 80) return { handled: false, reason: 'invalid' };

    const isChoiceMode = state.mode === 'pilihan';
    const maxAttempts = isChoiceMode ? this.options.choiceAttempts : this.options.maxAttempts;
    const used = state.attempts.get(sender) || 0;
    const who = name || String(sender).split('@')[0];
    const mentions = sender ? [sender] : [];

    // Percobaan pemain ini sudah habis -> ronde tetap berjalan untuk pemain lain.
    if (used >= maxAttempts) {
      if (!state.outNotified.has(sender)) {
        state.outNotified.add(sender);
        await this.send(chat, {
          text: [
            `⏳ *${who}* sudah memakai semua percobaan di ronde ini.`,
            'Ronde tetap jalan — tunggu pemain lain menjawab benar, atau sampai waktu habis.',
          ].join('\n'),
          mentions,
        });
      }
      return { handled: true, correct: false, reason: 'no-attempts' };
    }
    state.attempts.set(sender, used + 1);

    let correct = false;
    if (isChoiceMode) {
      const match = matchChoice(guess, state.choices);
      if (!match) return { handled: false, reason: 'not-a-choice' };
      correct = match.choice.correct;
    } else {
      correct = isCorrectGuess(guess, state.card);
    }

    if (!correct) {
      const remaining = Math.max(0, maxAttempts - (used + 1));
      await this.send(chat, {
        text:
          remaining > 0
            ? `❌ Belum tepat, *${who}*. Sisa percobaanmu: *${remaining}*`
            : `❌ Belum tepat, *${who}*. Percobaanmu di ronde ini habis — tunggu pemain lain atau waktu habis.`,
        mentions,
      });
      // RONDE TIDAK DIBUKA di sini: biarkan pemain lain menjawab.
      return { handled: true, correct: false };
    }

    const reward = await this.award(state, sender, name);
    const wasLastRound = state.round >= state.rounds;
    await this.send(chat, {
      text: [
        `✅ *BENAR!* ${name ? `*${name}*` : 'Kamu'} menebak *${state.card.name}*`,
        '',
        `💰 +${reward.saldo} saldo • ✨ +${reward.exp} exp • 🎯 +${reward.limit} limit`,
        `🏆 Skor ${name || sender}: ${this.scoreOf(state, sender).correct}`,
      ].join('\n'),
      mentions: sender ? [sender] : [],
    });

    if (wasLastRound) await this.finish(state);
    else await this.nextRound(state, this.options.roundDelayMs);
    return { handled: true, correct: true };
  }

  // ── Internal ──────────────────────────────────────────────────────────

  clearTimers(state) {
    if (state.timeout) clearTimeout(state.timeout);
    for (const timer of state.hints || []) clearTimeout(timer);
    state.timeout = null;
    state.hints = [];
  }

  scoreOf(state, jid) {
    if (!state.scores.has(jid)) state.scores.set(jid, { name: '', correct: 0 });
    return state.scores.get(jid);
  }

  scoreSummary(state) {
    const rows = [...state.scores.entries()]
      .filter(([, score]) => score.correct > 0)
      .sort((a, b) => b[1].correct - a[1].correct)
      .slice(0, 5)
      .map(([jid, score], index) => `${index + 1}. ${score.name || jid} — ${score.correct} benar`);

    return rows.length ? `🏆 *Skor akhir:*\n${rows.join('\n')}` : 'Tidak ada yang menebak dengan benar.';
  }

  async award(state, jid, name) {
    const reward = this.options.reward;
    const score = this.scoreOf(state, jid);
    score.correct += 1;
    if (name) score.name = name;

    try {
      const user = this.db?.user?.(jid);
      if (user) {
        user.saldo = (user.saldo || 0) + reward.saldo;
        user.exp = (user.exp || 0) + reward.exp;
        user.limit = (user.limit || 0) + reward.limit;
        user.ygoWins = (user.ygoWins || 0) + 1;
        this.db.touch?.();
      }
    } catch (err) {
      this.logger?.warn?.(`[ygo-quiz] gagal menyimpan hadiah: ${err.message}`);
    }

    return reward;
  }

  /** Ambil kartu random yang punya gambar art (crop) + 3 distraktor. */
  async buildRound() {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let card;
      try {
        card = (await this.client.random()).data?.[0];
      } catch (err) {
        this.logger?.warn?.(`[ygo-quiz] random gagal: ${err.message}`);
        return null;
      }
      const images = card?.card_images?.[0];
      const art = images?.image_url_cropped;
      if (!card || !art) continue; // tanpa art crop, nama kartu akan terlihat

      const pool = await this.distractorPool(card);
      const choices = buildChoices(card, pool, 4, this.random);
      return { card, art, choices };
    }
    return null;
  }

  /** Kumpulkan kandidat pengecoh dari archetype/tipe yang sama. */
  async distractorPool(card) {
    const pool = [];
    const queries = [];
    if (card.archetype) queries.push({ archetype: card.archetype, num: '20', offset: '0', sort: 'name' });
    if (card.type) queries.push({ type: card.type, num: '20', offset: String(Math.floor(this.random() * 150)), sort: 'name' });
    if (card.race && card.attribute) {
      queries.push({ race: card.race, attribute: card.attribute, num: '20', offset: '0', sort: 'name' });
    }

    for (const query of queries) {
      try {
        const data = (await this.client.card(query)).data || [];
        pool.push(...data);
      } catch {
        /* lanjut ke query berikutnya */
      }
      if (pool.length >= 12) break;
    }

    const unique = new Map();
    for (const item of pool) {
      const key = normalizeAnswer(item?.name);
      if (key && !unique.has(key)) unique.set(key, item);
    }
    return [...unique.values()];
  }

  async nextRound(state, delayMs = 0) {
    if (state.finished || !this.games.has(state.chat)) return;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (state.finished || !this.games.has(state.chat)) return;

    this.clearTimers(state);
    state.round += 1;
    state.attempts.clear();
    state.outNotified.clear();

    const round = await this.buildRound();
    if (!round) {
      await this.finish(state, 'gagal mengambil kartu dari API');
      return;
    }

    state.card = round.card;
    state.choices = round.choices;

    const { card, art } = round;
    const header = `🎴 *TEBAK KARTU YU-GI-OH!* — Ronde ${state.round}/${state.rounds}`;

    await this.send(state.chat, {
      image: { url: art },
      caption: `${header}\n🖼️ Siapa nama kartu di gambar ini?`,
    });

    if (state.mode === 'pilihan') {
      const list = round.choices.map((choice) => `${choice.label}. ${choice.name}`).join('\n');
      await this.send(state.chat, {
        text: [
          list,
          '',
          `⏱️ *${Math.round(this.options.timeoutMs / 1000)} detik* — jawab dengan huruf (A/B/C/D) atau tulis namanya.`,
          'Salah? Ronde tetap jalan sampai ada yang benar atau waktu habis.',
          'Ketik .nyerah untuk membuka jawaban.',
        ].join('\n'),
      });
    } else {
      await this.send(state.chat, {
        text: [
          `⏱️ *${Math.round(this.options.timeoutMs / 1000)} detik* — tulis nama kartunya.`,
          `Salah tidak mengakhiri ronde (${this.options.maxAttempts} percobaan per orang) — petunjuk muncul otomatis.`,
          'Ketik .nyerah untuk membuka jawaban.',
        ].join('\n'),
      });
    }

    // Petunjuk bertahap (khusus mode teks)
    if (state.mode === 'teks') {
      const hintOne = setTimeout(() => {
        this.send(state.chat, {
          text: `💡 *Petunjuk 1:* diawali "*${card.name[0]}*" • ${card.name.replace(/\s/g, '').length} huruf`,
        }).catch(() => {});
      }, Math.max(1000, this.options.hintDelayMs));

      const hintTwo = setTimeout(() => {
        this.send(state.chat, {
          text: `💡 *Petunjuk 2:* ${card.type}${card.attribute ? ` • ${card.attribute}` : ''}${card.archetype ? ` • archetype ${card.archetype}` : ''}`,
        }).catch(() => {});
      }, Math.max(1500, this.options.hintDelayMs * 2));

      state.hints = [hintOne, hintTwo];
    }

    state.timeout = setTimeout(() => {
      this.reveal(state, '⏰ Waktu habis!').catch(() => {});
    }, Math.max(250, this.options.timeoutMs));
  }

  /** Buka jawaban lalu lanjut ke ronde berikutnya. */
  async reveal(state, intro = '') {
    if (state.finished || !state.card) return;
    this.clearTimers(state);

    const card = state.card;
    const wasLastRound = state.round >= state.rounds;

    await this.send(state.chat, {
      text: [`${intro}`, `Jawabannya: *${card.name}*`, `📛 ${card.type}${card.atk !== undefined ? ` • ATK ${card.atk}` : ''}`].filter(Boolean).join('\n'),
    });

    if (wasLastRound) await this.finish(state);
    else await this.nextRound(state, this.options.roundDelayMs);
  }

  async finish(state, reason = '') {
    if (state.finished) return;
    this.clearTimers(state);
    state.finished = true;
    this.games.delete(state.chat);

    const text = [`🏁 *Game selesai!*${reason ? ` (${reason})` : ''}`, '', this.scoreSummary(state)].join('\n');
    await this.send(state.chat, { text });
  }
}

export default YgoQuiz;
