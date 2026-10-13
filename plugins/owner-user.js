/**
 * Manajemen user oleh owner.
 *
 *   .premium add 628xx [hari]      .premium del 628xx
 *   .premium add 30                (sambil reply pesan user -> 30 hari)
 *   .limit add 628xx 10            .limit del 628xx 5
 *   .limit add 10                  (sambil reply -> +10)
 *   .resetlimit 628xx              .ban 628xx [alasan]     .unban 628xx
 *
 * Target boleh: nomor (628xx / 08xx), mention (@628xx), atau cukup reply pesan user.
 * Target ber-LID (`...@lid`) otomatis dipetakan ke record nomor telepon lewat
 * `db.resolveLid` supaya premium/limit tidak masuk ke record yang berbeda.
 * Tambahan limit dari owner disimpan sebagai "bonus" sehingga tidak hilang
 * saat reset limit harian (lihat lib/permissions.js -> adjustLimit).
 */
import { bareNumber, isJidUser, resolveUserTarget } from '../lib/functions.js';
import { adjustLimit, limitBase, refreshLimit } from '../lib/permissions.js';

/** Alias lama: resolusi target user (nomor, mention, atau reply). */
export const resolveTarget = resolveUserTarget;

const HELP = (config) => {
  const p = config.bot.prefix[0];
  return [
    '*Manajemen user*',
    `${p}premium add|del|list <nomor> [hari]`,
    `${p}ban <nomor> [alasan]`,
    `${p}unban <nomor>`,
    `${p}limit add|del <nomor> <jumlah>`,
    `${p}resetlimit <nomor>`,
    '',
    'Nomor bisa format 628xx, 08xx, atau mention @628xx.',
    'Bisa juga reply pesan user lalu:',
    `• ${p}premium add 30   (30 hari)`,
    `• ${p}premium list     (daftar premium)`,
    `• ${p}limit add 10     (+10 limit)`,
  ].join('\n');
};

/**
 * Tentukan target dari argumen, mention, atau pesan yang di-reply.
 * Implementasinya ada di lib/functions.js -> `resolveUserTarget`.
 */

const handler = async (m, { args, command, config, db }) => {
  const action = String(args[0] || '').toLowerCase();

  // ── .premium list ──────────────────────────────────────────────────────────
  if (/^premium$/i.test(command) && action === 'list') {
    const now = Date.now();
    const premiumUsers = Object.entries(db.data.users)
      .filter(([, user]) => user.premium && (!user.premiumUntil || user.premiumUntil > Date.now()))
      .map(([jid, user]) => ({
        jid,
        name: user.name || bareNumber(jid),
        until: user.premiumUntil ? new Date(user.premiumUntil).toLocaleString('id-ID', { timeZone: config.bot.timezone }) : 'selamanya',
        limit: user.limit || 0,
      }));

    if (!premiumUsers.length) {
      return m.reply('Belum ada user premium.');
    }

    const lines = premiumUsers.map((u, i) => `${i + 1}. ${u.name} (${bareNumber(u.jid)}) — sampai ${u.until} | limit: ${u.limit}`).join('\n');
    return m.reply(`*Daftar Premium (${premiumUsers.length})*\n\n${lines}`);
  }

  // `.premium add <target> ...` / `.limit add <target> ...` punya kata kunci aksi dulu,
  // sedangkan `.ban <target>`, `.unban <target>`, `.resetlimit <target>` tidak.
  const withAction = /^(premium|limit)$/i.test(command);
  const { jid: rawTarget, rest } = resolveTarget(m, withAction ? args.slice(1) : args, { shorthand: withAction });
  // Target bisa berupa LID (WhatsApp baru). Arahkan ke record nomor teleponnya
  // supaya premium/limit tidak masuk ke record LID yang berbeda.
  // `resolveIdentity` (bukan `resolveLid`) karena target bisa berupa LID yang
  // salah dibaca sebagai nomor telepon — `271446714642565@s.whatsapp.net`.
  // Kalau tidak diselesaikan di sini, premium/limit owner masuk ke record hantu
  // dan user-nya tetap free.
  const target = rawTarget ? db.resolveIdentity?.(rawTarget) || rawTarget : rawTarget;

  if (!target || !isJidUser(target)) {
    return m.reply(HELP(config));
  }

  const action2 = String(args[0] || '').toLowerCase();
  const user = db.user(target);
  const bonus = () => Math.max(0, Number(user.limitBonus) || 0);

  // ── .limit add|del ───────────────────────────────────────────────────────
  if (/^limit$/i.test(command)) {
    const amount = Math.abs(Number(rest[0]) || 0);
    if (!['add', 'del'].includes(action2) || !amount) {
      return m.reply(`Format: ${config.bot.prefix[0]}limit add|del ${bareNumber(target)} 10`);
    }
    const delta = action2 === 'add' ? amount : -amount;
    const result = adjustLimit(db, user, delta, config);
    await db.save?.(true);
    return m.reply(
      [
        `✅ Limit ${bareNumber(target)} sekarang *${result.limit}*`,
        `📊 kuota harian (setelah reset): *${result.quota}*`,
        result.bonus ? `➕ bonus owner: *+${result.bonus}* (tidak hilang saat reset harian)` : '',
        '',
        `_Cek dari sisi user: \`${config.bot.prefix[0]}profile ${bareNumber(target)}\`_`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  // ── .premium add|del ─────────────────────────────────────────────────────
  if (/^premium$/i.test(command)) {
    if (!['add', 'del'].includes(action2)) {
      return m.reply(`Format: ${config.bot.prefix[0]}premium add|del ${bareNumber(target)} [hari]`);
    }

    if (action2 === 'add') {
      const days = Number(rest[0]) > 0 ? Number(rest[0]) : config.limits.premiumDays;
      // Kalau premium masih aktif, tambahkan harinya dari sisa masa aktif —
      // bukan menimpanya (dulu `.premium add 30` memotong sisa hari yang ada).
      const stillActive = Number(user.premiumUntil) > Date.now();
      const startFrom = stillActive ? Number(user.premiumUntil) : Date.now();
      user.premium = true;
      user.premiumUntil = startFrom + days * 86400000;
      // kuota limit langsung menyesuaikan status premium
      if (!user.lastLimitReset) user.lastLimitReset = Date.now();
      user.limit = limitBase(user, config) + bonus();
      db.touch();
      await db.save?.(true);
      return m.reply(
        [
          `✅ ${bareNumber(target)} ${stillActive ? `premium *diperpanjang ${days} hari*` : `sekarang *premium* selama ${days} hari`}.`,
          `📅 berakhir: ${new Date(user.premiumUntil).toLocaleString('id-ID', { timeZone: config.bot.timezone })}`,
          `💳 kuota limit: *${user.limit}*`,
        ].join('\n'),
      );
    }

    user.premium = false;
    user.premiumUntil = 0;
    if (!user.lastLimitReset) user.lastLimitReset = Date.now();
    user.limit = Math.min(Number(user.limit) || 0, limitBase(user, config) + bonus());
    db.touch();
    await db.save?.(true);
    return m.reply(`✅ Premium ${bareNumber(target)} dicabut. Kuota limit: *${user.limit}*`);
  }

  // ── .ban / .unban ────────────────────────────────────────────────────────
  if (/^(ban)$/i.test(command)) {
    user.banned = true;
    user.bannedReason = rest.join(' ') || 'tanpa alasan';
    db.touch();
    await db.save?.(true);
    return m.reply(`🚫 ${bareNumber(target)} diblokir. Alasan: ${user.bannedReason}`);
  }

  if (/^(unban)$/i.test(command)) {
    user.banned = false;
    user.bannedReason = '';
    db.touch();
    await db.save?.(true);
    return m.reply(`✅ Blokir ${bareNumber(target)} dibuka.`);
  }

  // ── .resetlimit ──────────────────────────────────────────────────────────
  if (/^(resetlimit)$/i.test(command)) {
    user.lastLimitReset = 0;
    const limit = refreshLimit(db, user, config);
    db.touch();
    await db.save?.(true);
    return m.reply(
      `✅ Limit ${bareNumber(target)} direset menjadi *${limit}*${bonus() ? ` (termasuk bonus owner +${bonus()})` : ''}`,
    );
  }

  return m.reply(HELP(config));
};

handler.help = ['premium', 'ban', 'unban', 'limit', 'resetlimit'];
handler.tags = ['owner'];
handler.command = /^(premium|ban|unban|limit|resetlimit)$/i;
handler.owner = true;
handler.limit = false;

export default handler;
