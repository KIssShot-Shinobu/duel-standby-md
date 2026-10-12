/**
 * Bank sederhana: nabung & tarik saldo.
 *   .nabung 1000
 *   .tarik 500
 *   .bank
 */
const handler = async (m, { args, command, user, db, config }) => {
  const amount = Number(args[0]);

  if (/^(bank)$/i.test(command)) {
    return m.reply(
      [
        '🏦 *BANK*',
        '',
        `💵 Saldo di tangan : ${user.saldo || 0}`,
        `🏦 Saldo di bank   : ${user.bank || 0}`,
        '',
        `${config.bot.prefix[0]}nabung <jumlah> — simpan uang`,
        `${config.bot.prefix[0]}tarik <jumlah> — ambil uang`,
      ].join('\n'),
    );
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return m.reply(`Masukkan jumlah yang valid. Contoh: ${config.bot.prefix[0]}${command} 1000`);
  }

  if (/^(nabung|deposit)$/i.test(command)) {
    if ((user.saldo || 0) < amount) return m.reply('💸 Saldo kamu tidak cukup.');
    user.saldo -= amount;
    user.bank = (user.bank || 0) + amount;
    db.touch();
    return m.reply(`🏦 Menabung *${amount}*\n\nSaldo: ${user.saldo} • Bank: ${user.bank}`);
  }

  if ((user.bank || 0) < amount) return m.reply('🏦 Saldo bank tidak cukup.');
  user.bank -= amount;
  user.saldo = (user.saldo || 0) + amount;
  db.touch();
  return m.reply(`💵 Menarik *${amount}*\n\nSaldo: ${user.saldo} • Bank: ${user.bank}`);
};

handler.help = ['bank', 'nabung', 'tarik'];
handler.tags = ['rpg'];
handler.command = /^(bank|nabung|deposit|tarik|withdraw)$/i;
handler.limit = false;

export default handler;
