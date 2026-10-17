/**
 * Manajemen moderator oleh owner.
 *
 *   .mod add 628xx        -> angkat jadi moderator
 *   .mod add              (sambil reply pesan user / mention @628xx)
 *   .mod del 628xx        -> cabut moderator
 *   .mod list             -> daftar moderator
 *
 * Target boleh: nomor (628xx / 08xx), mention (@628xx), atau cukup reply pesan
 * user. Target ber-LID (`...@lid`) dipetakan ke record nomor telepon lewat
 * `db.resolveIdentity` supaya role-nya tidak masuk ke record yang berbeda.
 *
 * Role disimpan di `user.role = 'mod'` — bertahan setelah restart dan dibaca
 * `lib/permissions.js -> isMods` bersama daftar `config.bot.mods` (env).
 *
 * Moderator BUKAN owner: plugin bertanda `owner = true` (termasuk plugin ini)
 * tetap tertutup untuknya. Yang moderator dapat: bebas limit, bebas gate sewa
 * grup, dan bebas tag premium/register — di grup maupun DM.
 */
import { bareNumber, isJidUser, resolveUserTarget } from '../lib/functions.js';
import { userDisplayName } from '../lib/messages.js';

const HELP = (config) => {
  const p = config.bot.prefix[0];
  return [
    '*Manajemen moderator*',
    `${p}mod add <nomor>   → angkat jadi moderator`,
    `${p}mod del <nomor>   → cabut moderator`,
    `${p}mod list          → daftar moderator`,
    '',
    'Nomor bisa format 628xx, 08xx, atau mention @628xx.',
    `Bisa juga reply pesan user lalu ketik ${p}mod add.`,
    '',
    'Moderator bebas limit dan bisa memakai fitur di grup yang belum disewa,',
    'tapi tetap bukan owner (command khusus owner tetap tertutup).',
  ].join('\n');
};

const label = (jid, user) => `${userDisplayName(user, jid)} (${bareNumber(jid)})`;

const handler = async (m, { args, command, config, db }) => {
  const action = String(args[0] || '').toLowerCase();

  // ── .mod list ─────────────────────────────────────────────────────────────
  if (action === 'list') {
    const fromDb = Object.entries(db.data.users)
      .filter(([, user]) => user?.role === 'mod')
      .map(([jid, user]) => ({ jid, name: userDisplayName(user, jid) }));

    // Moderator lama yang diatur lewat env (`config.bot.mods`) tetap ditampilkan
    // supaya owner melihat daftar lengkap, bukan cuma yang dari database.
    const known = new Set(fromDb.map((item) => bareNumber(item.jid)));
    const fromConfig = (config.bot.mods || [])
      .map((num) => bareNumber(num))
      .filter((num) => num && !known.has(num))
      .map((num) => ({ jid: `${num}@s.whatsapp.net`, name: '(dari config)' }));

    const all = [...fromDb, ...fromConfig];
    if (!all.length) return m.reply('Belum ada moderator.');
    const lines = all.map((item, i) => `${i + 1}. ${item.name} (${bareNumber(item.jid)})`).join('\n');
    return m.reply(`*Daftar Moderator (${all.length})*\n\n${lines}`);
  }

  // `shorthand: false` — sisa argumen tidak pernah dianggap nomor target,
  // jadi `.mod add <nomor>` jelas dan mention/reply tetap jalan.
  const { jid: rawTarget } = resolveUserTarget(m, args.slice(1), { shorthand: false });
  const target = rawTarget ? db.resolveIdentity?.(rawTarget) || rawTarget : rawTarget;
  if (!target || !isJidUser(target)) return m.reply(HELP(config));

  const user = db.user(target);

  if (action === 'add') {
    if (user.role === 'mod') return m.reply(`ℹ️ ${label(target, user)} sudah moderator.`);
    user.role = 'mod';
    db.touch();
    await db.save?.(true);
    return m.reply(
      [
        `✅ ${label(target, user)} sekarang *moderator*.`,
        'Bebas limit & bisa memakai fitur di grup yang belum disewa.',
        '_Command khusus owner tetap tertutup untuknya._',
      ].join('\n'),
    );
  }

  if (action === 'del') {
    if (user.role !== 'mod') return m.reply(`ℹ️ ${label(target, user)} bukan moderator.`);
    user.role = 'user';
    db.touch();
    await db.save?.(true);
    return m.reply(`✅ Status moderator ${label(target, user)} dicabut.`);
  }

  return m.reply(HELP(config));
};

handler.help = ['mod'];
handler.tags = ['owner'];
handler.command = /^(mod|moderator)$/i;
handler.owner = true;
handler.limit = false;

export default handler;
