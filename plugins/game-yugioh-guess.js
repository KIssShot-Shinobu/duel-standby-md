/**
 * Game tebak kartu Yu-Gi-Oh!.
 *
 *   .tebakygo                -> mulai (default 3 ronde, pilihan ganda A-D)
 *   .tebakygo teks           -> mode tulis nama sendiri (ada petunjuk)
 *   .tebakygo pilihan 5      -> 5 ronde mode pilihan ganda
 *   .nyerah                  -> buka jawaban & lanjut ronde berikutnya
 *   .stoptebak               -> hentikan game (pembuat game / admin / owner)
 *   .yugoscore               -> papan skor penebak terbaik
 *
 * Gambar yang dikirim adalah ART CROP kartu (`image_url_cropped`) sehingga
 * nama kartu tidak terlihat. Jawaban berupa huruf (A/B/C/D) atau nama kartu
 * (toleran salah ketik).
 */
import { getClient } from '../lib/ygoprodeck.js';
import { YgoQuiz } from '../lib/yugioh-quiz.js';
import { consumeLimit } from '../lib/permissions.js';

let quiz = null;
let activeConn = null;

function buildOptions(config) {
  const options = config.game?.yugioh || {};
  return {
    rounds: options.rounds,
    mode: options.mode,
    timeoutMs: options.timeoutMs,
    hintDelayMs: options.hintDelayMs,
    maxAttempts: options.maxAttempts,
    choiceAttempts: options.choiceAttempts,
    roundDelayMs: options.roundDelayMs,
    reward: { saldo: options.rewardSaldo, exp: options.rewardExp, limit: options.rewardLimit },
  };
}

/** Satu engine per proses; socket aktif diperbarui setiap pesan masuk. */
function ensureQuiz(conn, config, db) {
  if (conn) activeConn = conn;
  if (!quiz) {
    quiz = new YgoQuiz({
      client: getClient(config),
      options: buildOptions(config),
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

const handler = async (m, { conn, args, config, db, user, isAdmin, isOwner, command, usedPrefix }) => {
  const engine = ensureQuiz(conn, config, db);

  if (/^(tebakygo|tebakkartu|yugoguess)$/i.test(command)) {
    const tokens = (args || []).map((token) => String(token).toLowerCase());
    const mode = tokens.includes('teks') ? 'teks' : tokens.includes('pilihan') ? 'pilihan' : config.game?.yugioh?.mode;
    const rounds = Number(tokens.find((token) => /^\d+$/.test(token))) || undefined;
    const limits = config.game?.yugioh || {};

    // Biaya limit hanya saat memulai game (bukan untuk .yugoscore/.stoptebak)
    const limit = consumeLimit(db, user, { limit: true }, config);
    if (!limit.ok) return m.reply(config.messages?.limit || '_Limit kamu habis._');

    const result = await engine.start(m.chat, {
      starter: m.sender,
      starterName: m.pushName || '',
      rounds: rounds ? Math.min(rounds, Number(limits.maxRounds) || 10) : undefined,
      mode,
    });

    if (!result.ok) {
      return m.reply(
        `⚠️ Masih ada game berjalan di chat ini (ronde ${result.round}/${result.rounds}).\nSelesaikan dulu atau ketik ${usedPrefix}stoptebak.`,
      );
    }

    if (!user.ygoPlays) user.ygoPlays = 0;
    user.ygoPlays += 1;
    db.touch();
    return true;
  }

  if (/^(nyerah|skip)$/i.test(command)) {
    if (!engine.has(m.chat)) return m.reply('Tidak ada game tebak kartu yang berjalan di chat ini.');
    await engine.giveUp(m.chat, { name: m.pushName || m.sender.split('@')[0] });
    return true;
  }

  if (/^(stoptebak|stopgame)$/i.test(command)) {
    const state = engine.get(m.chat);
    if (!state) return m.reply('Tidak ada game yang berjalan.');
    const allowed = isOwner || isAdmin || state.starter === m.sender;
    if (!allowed) return m.reply('Hanya pembuat game, admin grup, atau owner yang bisa menghentikan game ini.');
    await engine.stop(m.chat);
    return true;
  }

  if (/^(yugoscore|toptebak)$/i.test(command)) {
    const rows = Object.entries(db.data.users)
      .map(([jid, item]) => ({ jid, wins: Number(item.ygoWins) || 0, saldo: Number(item.saldo) || 0, name: item.name || '' }))
      .filter((item) => item.wins > 0)
      .sort((a, b) => b.wins - a.wins || b.saldo - a.saldo)
      .slice(0, 10);

    if (!rows.length) return m.reply(`Belum ada pemenang. Mulai dengan ${usedPrefix}tebakygo`);

    const medals = ['🥇', '🥈', '🥉'];
    return m.reply(
      [
        '🏆 *PAPAN SKOR TEBAK KARTU*',
        '',
        ...rows.map((item, index) => `${medals[index] || `${index + 1}.`} ${item.name || item.jid.split('@')[0]} — ${item.wins} benar`),
        '',
        'Tebak terus untuk naik peringkat!',
      ].join('\n'),
    );
  }

  return true;
};

/**
 * Hook: setiap pesan di chat yang sedang ada game dianggap sebagai tebakan.
 * Pesan ber-prefix dibiarkan lewat supaya tetap diproses sebagai command.
 */
handler.before = async (m, { conn, config, db }) => {
  if (!m.text || m.fromMe) return true;
  const prefixes = config?.bot?.prefix || [];
  if (prefixes.includes(String(m.text)[0])) return true;

  const engine = ensureQuiz(conn, config, db);
  if (!engine.has(m.chat)) return true;

  const result = await engine.handleGuess(m.chat, {
    sender: m.sender,
    name: m.pushName || m.sender.split('@')[0],
    text: m.text,
  });

  // false = hentikan pemrosesan pesan ini (sudah ditangani game)
  return result.handled ? false : true;
};

handler.help = ['tebakygo', 'nyerah', 'stoptebak', 'yugoscore'];
handler.tags = ['game'];
handler.command = /^(tebakygo|tebakkartu|yugoguess|nyerah|skip|stoptebak|stopgame|yugoscore|toptebak)$/i;
// Limit dipotong manual hanya saat game dimulai (lihat consumeLimit di atas).
handler.limit = false;

export default handler;
