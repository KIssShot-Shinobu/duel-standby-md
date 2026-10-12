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
import { buildChoices, isCorrectGuess, isExactGuess, maskName, matchChoice, normalizeAnswer, sample } from './guess.js';

export const DEFAULT_OPTIONS = {
  rounds: 3,
  mode: 'pilihan',
  timeoutMs: 60000,
  hintDelayMs: 20000,
  /** percobaan per pemain di mode teks */
  maxAttempts: 3,
  /** percobaan per pemain di mode pilihan ganda (cegah brute-force A/B/C/D) */
  choiceAttempts: 1,
  /** jawaban harus persis (hanya besar/kecil huruf & tanda baca yang dimaklumi) */
  strict: false,
  /** tampilkan daftar pilihan A/B/C/D */
  showChoices: true,
  /** petunjuk otomatis gratis (mode teks). Matikan kalau hint berbayar dipakai */
  autoHints: true,
  /** biaya limit untuk `.hint` (0 = gratis) */
  hintCost: 3,
  /** maksimal berapa kali satu pemain boleh membeli petunjuk per ronde */
  maxHints: 3,
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
  async start(chat, { starter = '', starterName = '', rounds, mode, prefix = '.', options = {} } = {}) {
    if (this.games.has(chat)) {
      const active = this.games.get(chat);
      return { ok: false, reason: 'already-running', round: active.round, rounds: active.rounds };
    }

    // Opsi bisa berbeda tiap game (mis. mode gambar-saja dengan jawaban persis).
    const gameOptions = {
      ...this.options,
      ...options,
      reward: { ...this.options.reward, ...(options.reward || {}) },
    };

    const state = {
      chat,
      starter,
      starterName,
      prefix: prefix || '.',
      mode: MODES.has(String(mode).toLowerCase()) ? String(mode).toLowerCase() : gameOptions.mode,
      options: gameOptions,
      rounds: clamp(rounds ?? gameOptions.rounds, 1, 10),
      round: 0,
      scores: new Map(),
      attempts: new Map(),
      /** berapa petunjuk berbayar yang sudah dibeli tiap pemain di ronde ini */
      hintReveals: new Map(),
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
    const maxAttempts = isChoiceMode ? state.options.choiceAttempts : state.options.maxAttempts;
    const used = state.attempts.get(sender) || 0;
    const who = name || String(sender).split('@')[0];
    const mentions = sender ? [sender] : [];

    // Percobaan pemain ini sudah habis -> diabaikan tanpa pesan tambahan.
    if (used >= maxAttempts) {
      return { handled: true, correct: false, reason: 'no-attempts' };
    }
    state.attempts.set(sender, used + 1);

    let correct = false;
    if (isChoiceMode) {
      const match = matchChoice(guess, state.choices);
      if (!match) return { handled: false, reason: 'not-a-choice' };
      correct = match.choice.correct;
    } else {
      // Mode "harus persis" hanya memaklumi besar/kecil huruf & tanda baca.
      correct = state.options.strict ? isExactGuess(guess, state.card) : isCorrectGuess(guess, state.card);
    }

    if (!correct) {
      // Balasan seminimal mungkin: ronde tetap jalan sampai ada yang benar / waktu habis.
      await this.send(chat, { text: '❌ Salah', mentions });
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
    else await this.nextRound(state, state.options.roundDelayMs);
    return { handled: true, correct: true };
  }

  /**
   * Petunjuk berbayar untuk satu pemain (dipanggil plugin `.hint`, yang juga
   * memotong limit). Tiap pembelian membuka satu huruf lagi per kata.
   * @returns {{handled: boolean, reason?: string, data?: {masked: string, info: string, letters: number, reveals: number, cost: number}}}
   */
  async hint(chat, { sender, name = '' } = {}) {
    const state = this.games.get(chat);
    if (!state || !state.card) return { handled: false, reason: 'no-game' };

    const reveals = (state.hintReveals.get(sender) || 0) + 1;
    const cost = Math.max(0, Number(state.options.hintCost) || 0);
    const maxHints = Math.max(1, Number(state.options.maxHints) || 3);
    if (reveals > maxHints) return { handled: true, reason: 'max-hint', reveals: reveals - 1 };

    state.hintReveals.set(sender, reveals);
    const card = state.card;
    const info = [
      card.type,
      card.attribute,
      card.level ? `Level ${card.level}` : '',
      card.archetype ? `Archetype: ${card.archetype}` : '',
    ]
      .filter(Boolean)
      .join(' • ');

    return {
      handled: true,
      reveals,
      cost,
      data: {
        masked: maskName(card.name, { reveal: reveals }),
        info,
        letters: card.name.replace(/\s/g, '').length,
        player: name,
      },
    };
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
    const reward = state.options.reward;
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
    state.hintReveals.clear();

    const round = await this.buildRound();
    if (!round) {
      await this.finish(state, 'gagal mengambil kartu dari API');
      return;
    }

    state.card = round.card;
    state.choices = round.choices;

    const { card, art } = round;
    const showChoices = state.mode === 'pilihan' && state.options.showChoices !== false;
    const header = showChoices
      ? `🎴 *TEBAK KARTU YU-GI-OH!* — Ronde ${state.round}/${state.rounds}`
      : `🎴 *TEBAK NAMA KARTU* — Ronde ${state.round}/${state.rounds}`;

    await this.send(state.chat, {
      image: { url: art },
      caption: showChoices
        ? `${header}\n🖼️ Siapa nama kartu di gambar ini?`
        : `${header}\n🖼️ Tulis nama kartu di gambar ini (harus tepat).`,
    });

    const seconds = Math.round(state.options.timeoutMs / 1000);
    if (showChoices) {
      const list = round.choices.map((choice) => `${choice.label}. ${choice.name}`).join('\n');
      await this.send(state.chat, {
        text: [list, '', `⏱️ *${seconds} detik* — jawab A/B/C/D atau tulis namanya.`].join('\n'),
      });
    } else if (state.mode === 'pilihan') {
      await this.send(state.chat, { text: `⏱️ *${seconds} detik* — jawab A/B/C/D atau tulis namanya.` });
    } else {
      const hintsLine =
        state.options.hintCost > 0
          ? `💡 Butuh bantuan? *${state.prefix || '.'}hint* (${state.options.hintCost} limit, maks ${state.options.maxHints}x per ronde)`
          : '💡 Butuh bantuan? Ketik *.hint*';
      await this.send(state.chat, {
        text: [
          `⏱️ *${seconds} detik* — tulis nama kartunya.`,
          state.options.strict ? '📝 Jawaban harus *tepat* (besar/kecil huruf bebas).' : '',
          state.options.hintCost > 0 || state.options.autoHints ? hintsLine : '',
        ]
          .filter(Boolean)
          .join('\n'),
      });
    }

    // Petunjuk gratis bertahap (dimatikan kalau game memakai hint berbayar)
    if (state.mode === 'teks' && state.options.autoHints !== false) {
      const hintOne = setTimeout(() => {
        this.send(state.chat, {
          text: `💡 *Petunjuk 1:* diawali "*${card.name[0]}*" • ${card.name.replace(/\s/g, '').length} huruf`,
        }).catch(() => {});
      }, Math.max(1000, state.options.hintDelayMs));

      const hintTwo = setTimeout(() => {
        this.send(state.chat, {
          text: `💡 *Petunjuk 2:* ${card.type}${card.attribute ? ` • ${card.attribute}` : ''}${card.archetype ? ` • archetype ${card.archetype}` : ''}`,
        }).catch(() => {});
      }, Math.max(1500, state.options.hintDelayMs * 2));

      state.hints = [hintOne, hintTwo];
    }

    state.timeout = setTimeout(() => {
      this.reveal(state, '⏰ Waktu habis!').catch(() => {});
    }, Math.max(250, state.options.timeoutMs));
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
    else await this.nextRound(state, state.options.roundDelayMs);
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
