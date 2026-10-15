/**
 * Beli limit pakai saldo in-game.
 *
 *   .buylimit              -> lihat paket & harga
 *   .buylimit 30           -> beli paket 30 limit
 *   .buylimit 7            -> beli 7 limit (harga satuan)
 *
 * Saldo didapat dari chat dan kuis. Limit yang dibeli sifatnya permanen: tidak
 * hilang saat reset harian dan langsung terpakai seperti limit biasa.
 */
import { isPremiumUser, limitQuota } from '../lib/permissions.js';
import { buyCatalog, buySettings, buyStatus, quote, purchase, reasonText } from '../lib/buy-limit.js';

const number = (value) => Number(value || 0).toLocaleString('id-ID');

function catalogText(user, config, status) {
  const settings = buySettings(config);
  const premium = isPremiumUser(user, user.jid, config);
  const quota = limitQuota(user, config);
  const lines = [
    '🛒 *Belanja Limit*',
    '',
    `💰 Saldo kamu: *${number(user.saldo)}*`,
    `🎯 Limit sekarang: *${number(user.limit)}/${number(quota)}*${premium ? ' (premium)' : ''}`,
    '',
    '*Paket:*',
  ];

  for (const item of buyCatalog(config)) {
    lines.push(`• *${item.label}* — ${number(item.price)} saldo${item.hemat ? ` (hemat ${number(item.hemat)})` : ''}`);
  }

  lines.push(
    '',
    `Atau jumlah bebas: *${settings.min}–${settings.max}* limit @ ${number(settings.price)} saldo/limit.`,
    '',
    `Sisa jatah: *${settings.dailyCap > 0 ? number(status.dayLeft) : '∞'}* limit per 24 jam` +
      `${settings.monthlyCap > 0 ? `, *${number(status.monthLeft)}* per bulan` : ''}.`,
    '',
    `Cara beli: \`${config.bot.prefix[0]}buylimit 30\``,
  );
  return lines.join('\n');
}

const handler = async (m, { args, command, config, db, user }) => {
  const status = buyStatus(user, config);
  const raw = String(args[0] ?? '').trim();

  if (!raw) return m.reply(catalogText(user, config, status));

  const result = quote(db, user, config, raw);
  if (!result.ok) {
    // Format salah / di luar rentang -> tampilkan katalog sekaligus.
    if (result.reason === 'invalid') {
      return m.reply(`${reasonText('invalid', { config })}\n\n${catalogText(user, config, status)}`);
    }
    return m.reply(reasonText(result.reason, { config, result, status }));
  }

  const done = purchase(db, user, config, result);
  await db.save?.(true);

  const after = buyStatus(user, config);
  const quota = limitQuota(user, config);

  return m.reply(
    [
      `✅ Berhasil beli *${done.limit}* limit.`,
      '',
      `💸 Saldo tersisa: *${number(done.saldo)}*`,
      `🎯 Limit sekarang: *${number(user.limit)}/${number(quota)}*`,
      `📦 Bonus limit: *+${number(done.bonus)}* (permanen, nggak hilang saat reset)`,
      after.dailyCap > 0 ? `📅 Sisa jatah 24 jam: *${number(after.dayLeft)}* limit` : '',
      '',
      '_Makin sering dipakai, makin hemat. Simpan saldo buat kuis juga ya!_',
    ]
      .filter(Boolean)
      .join('\n'),
  );
};

handler.help = ['buylimit', 'limitbeli'];
handler.tags = ['tools'];
handler.command = /^(buylimit|buylim|limitbeli)$/i;
handler.limit = false;

export default handler;