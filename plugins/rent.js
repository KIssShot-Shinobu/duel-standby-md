/**
 * Sewa bot per grup (rent).
 *
 * User:
 *   .rent / .sewa                -> info harga & cara sewa (+ QRIS)
 *   .rent <nama grup | link | id> -> ajukan sewa (status pending), owner di-DM
 *   .rentstatus [grup]            -> status & sisa hari
 *   .renew <nama grup | link | id>-> ajukan perpanjangan
 *   (di DM) kirim bukti bayar     -> diteruskan ke owner (handler.all)
 *
 * Owner (subcommand .rent):
 *   .rent approve <grup> [hari]   .rent reject <grup> [alasan]
 *   .rent add <grup> [hari]       .rent del <grup>
 *   .rent list                    .rent price <nominal>
 *   .grouplist                    -> daftar semua grup bot + status sewa
 *
 * Semua data tinggal di db.data.rentals (per grup) + db.data.renters
 * (registry penyewa, terpisah dari data.users); lihat lib/rent.js.
 */
import fs from 'node:fs';
import { userError } from '../lib/errors.js';
import { bareNumber } from '../lib/functions.js';
import * as Rent from '../lib/rent.js';

const OWNER_SUBS = ['approve', 'reject', 'add', 'del', 'list', 'price'];

/** Kirim QRIS + caption; kalau file QRIS tidak ada, kirim teks saja. */
async function sendOffer(conn, chat, text, config, db) {
  const s = Rent.rentSettings(db || { data: {} }, config);
  let image = null;
  try {
    if (fs.existsSync(s.qrisPath)) image = fs.readFileSync(s.qrisPath);
  } catch {
    /* QRIS opsional */
  }
  if (image) await conn.sendMessage(chat, { image, caption: text }).catch(() => {});
  else await conn.sendMessage(chat, { text }).catch(() => {});
}

/** Kirim pesan ke semua owner. */
async function notifyOwners(conn, config, text) {
  const owners = config?.bot?.ownerJids || [];
  for (const jid of owners) {
    await conn.sendMessage(jid, { text }).catch(() => {});
  }
}

/** Balasan status sewa untuk .rentstatus. */
function statusText(db, config, jid, subject) {
  const name = subject || jid;
  const status = Rent.rentalStatus(db, jid);
  const rental = Rent.getRental(db, jid);
  if (status === 'active') {
    return `✅ *${name}* — sewa aktif, sisa *${Rent.remainingDays(db, jid)} hari*.\nPerpanjang: ${config.bot.prefix[0]}renew ${jid}`;
  }
  if (status === 'pending') {
    return `⏳ *${name}* — menunggu persetujuan owner (${rental?.renterName || '?'}).`;
  }
  if (status === 'expired') {
    return `⚠️ *${name}* — sewa sudah *kadaluarsa*. Fitur dikunci. Perpanjang: ${config.bot.prefix[0]}renew ${jid}`;
  }
  return `🔒 *${name}* — belum disewa. Sewa: ${config.bot.prefix[0]}rent ${jid}`;
}

const handler = async (m, ctx) => {
  const { conn, text, args, command, db, config, isOwner } = ctx;
  const p = config.bot.prefix[0];

  try {
    // ── .grouplist (owner) ────────────────────────────────────────────────
    if (command === 'grouplist') {
      if (!isOwner) throw userError('Khusus owner.');
      const groups = await conn.groupFetchAllParticipating?.().catch(() => ({}));
      const list = Object.values(groups || {});
      if (!list.length) return m.reply('Bot tidak ada di grup mana pun.');
      const lines = list.map((g) => {
        const id = g.id || '';
        const status = Rent.rentalStatus(db, id);
        const icon = status === 'active' ? '✅' : status === 'pending' ? '⏳' : status === 'expired' ? '⚠️' : '🔒';
        const sisa = status === 'active' ? ` — sisa ${Rent.remainingDays(db, id)} hari` : '';
        return `${icon} *${g.subject || id}*\n   🆔 ${id}${sisa}`;
      });
      return m.reply([`📋 *DAFTAR GRUP BOT* (${list.length})`, '', ...lines].join('\n'));
    }

    // ── .rentstatus ───────────────────────────────────────────────────────
    if (command === 'rentstatus') {
      let jid;
      let subject;
      if (m.isGroup && !text) {
        jid = m.chat;
        subject = ctx.groupMetadata?.subject;
      } else {
        const resolved = text ? await Rent.resolveGroupJid(conn, text) : null;
        if (!resolved?.jid) throw userError('Grup tidak ditemukan. Sebut nama grup, link, atau id.');
        jid = resolved.jid;
        subject = resolved.subject;
      }
      return m.reply(statusText(db, config, jid, subject));
    }

    // ── .renew ────────────────────────────────────────────────────────────
    if (command === 'renew') {
      if (!text) return m.reply(`Contoh: ${p}renew <nama grup | link | id>`);
      const resolved = await Rent.resolveGroupJid(conn, text);
      if (!resolved?.jid) throw userError('Bot tidak menemukan grup itu.');
      const rental = Rent.getRental(db, resolved.jid);
      if (!rental || (rental.renter !== m.sender && !isOwner)) {
        throw userError('Kamu bukan penyewa grup ini.');
      }
      Rent.requestRent(db, resolved.jid, { renter: rental.renter, renterName: rental.renterName || m.pushName });
      await sendOffer(conn, m.chat, `Permintaan perpanjangan *${resolved.subject || resolved.jid}* dikirim ke owner. Kirim bukti bayar di chat ini ya.`, config, db);
      await notifyOwners(conn, config, `🔄 Permintaan PERPANJANGAN sewa!\nGrup: *${resolved.subject || resolved.jid}*\nID: ${resolved.jid}\nOleh: ${m.pushName || bareNumber(m.sender)} (${bareNumber(m.sender)})\n\nApprove: ${p}rent approve ${resolved.jid}`);
      return true;
    }

    // ── .rent / .sewa ─────────────────────────────────────────────────────
    if (command === 'rent' || command === 'sewa') {
      const sub = (args[0] || '').toLowerCase();
      if (OWNER_SUBS.includes(sub)) {
        if (!isOwner) throw userError('Khusus owner.');
        return handleOwner(m, ctx, sub, args);
      }

      const s = Rent.rentSettings(db, config);
      const price = s.pricePerMonth ? `Rp${s.pricePerMonth.toLocaleString('id-ID')} / bulan` : '(harga diumumkan owner)';

      if (!text) {
        const info = [
          `🎫 *SEWA BOT*`,
          '',
          `💰 Harga : ${price}`,
          `🗓️ Durasi: ${s.days} hari`,
          '',
          'Cara sewa:',
          `1. Tambahkan bot ke grup (bot auto kirim penawaran sewa)`,
          `2. DM bot: ${p}rent <nama grup | link | id>`,
          `   Contoh : ${p}rent duel standby`,
          '3. Kirim bukti bayar di DM ini',
          '',
          `Perpanjang : ${p}renew <grup>`,
          `Cek status: ${p}rentstatus [grup]`,
          s.helpNumber ? `Kesulitan sewa? Klik link ini untuk DM owner langsung: https://wa.me/${s.helpNumber}` : null,
        ].filter(Boolean).join('\n');
        await sendOffer(conn, m.chat, info, config, db);
        return true;
      }

      const resolved = await Rent.resolveGroupJid(conn, text);
      if (!resolved?.jid) throw userError('Bot tidak menemukan grup itu. Pastikan nama/link/id benar dan bot sudah jadi anggota grup.');
      const status = Rent.rentalStatus(db, resolved.jid);
      if (status === 'active') {
        return m.reply(`Grup *${resolved.subject || resolved.jid}* sudah punya sewa aktif (sisa ${Rent.remainingDays(db, resolved.jid)} hari).`);
      }
      Rent.requestRent(db, resolved.jid, { renter: m.sender, renterName: m.pushName });
      await sendOffer(conn, m.chat, `Permintaan sewa *${resolved.subject || resolved.jid}* dikirim ke owner.\nKirim bukti bayar di chat ini ya.`, config, db);
      await notifyOwners(conn, config, `📥 Permintaan SEWA bot!\nGrup: *${resolved.subject || resolved.jid}*\nID: ${resolved.jid}\nOleh: ${m.pushName || bareNumber(m.sender)} (${bareNumber(m.sender)})\n\nApprove: ${p}rent approve ${resolved.jid}`);
      return true;
    }

    return m.reply('Gunakan: .rent | .rentstatus | .renew | .grouplist');
  } catch (err) {
    throw userError(typeof err === 'string' ? err : err.message || 'Terjadi kesalahan.');
  }
};

/** Subcommand owner dari .rent. */
async function handleOwner(m, ctx, sub, args) {
  const { conn, db, config } = ctx;
  const p = config.bot.prefix[0];
  const normalize = async (target) =>
    String(target).includes('@g.us') ? { jid: target, subject: undefined } : (await Rent.resolveGroupJid(conn, target));

  if (sub === 'list') {
    const rows = Object.entries(db.data.rentals || {});
    if (!rows.length) return m.reply('Belum ada data sewa.');
    const lines = rows.map(([jid, r]) => {
      const status = Rent.rentalStatus(db, jid);
      const icon = status === 'active' ? '✅' : status === 'pending' ? '⏳' : '⚠️';
      const renter = r.renterName || bareNumber(r.renter) || '?';
      const sisa = status === 'active' ? ` • sisa ${Rent.remainingDays(db, jid)} hari` : '';
      return `${icon} ${renter} — ${jid}${sisa}`;
    });
    return m.reply([`🗂️ *SEWA* (${rows.length})`, '', ...lines].join('\n'));
  }

  if (sub === 'price') {
    const value = Rent.setPrice(db, args[1]);
    return m.reply(`💰 Harga sewa diubah: Rp${value.toLocaleString('id-ID')} / bulan.`);
  }

  const target = args[1] || '';
  const days = Number(args[2]) || config.rent.days || 30;

  if (sub === 'del') {
    const resolved = await normalize(target);
    if (!resolved?.jid) throw userError('Grup tidak ditemukan.');
    Rent.removeRental(db, resolved.jid);
    return m.reply(`🗑️ Sewa *${resolved.subject || resolved.jid}* dihapus.`);
  }

  const resolved = await normalize(target);
  if (!resolved?.jid) throw userError('Grup tidak ditemukan. Sebut id/nama/link grup.');

  if (sub === 'approve' || sub === 'add') {
    const existing = Rent.getRental(db, resolved.jid);
    Rent.activateRent(db, resolved.jid, {
      renter: existing?.renter || '',
      renterName: existing?.renterName || '',
      days,
      by: m.sender,
      now: Date.now(),
    });
    const until = new Date(Date.now() + days * 86400000).toLocaleDateString('id-ID');
    if (existing?.status === 'pending') {
      await conn.sendMessage(existing.renter, { text: `✅ Sewa *grup-mu* disetujui owner. Aktif ${days} hari (s.d. ${until}).` }).catch(() => {});
    }
    return m.reply(`✅ Sewa *${resolved.subject || resolved.jid}* aktif ${days} hari (s.d. ${until}).`);
  }

  if (sub === 'reject') {
    const reason = args.slice(2).join(' ') || '(tanpa alasan)';
    Rent.rejectRent(db, resolved.jid, { by: m.sender, reason });
    return m.reply(`❌ Sewa *${resolved.subject || resolved.jid}* ditolak. Alasan: ${reason}`);
  }

  return m.reply(`Subcommand: ${p}rent approve|reject|add|del|list|price`);
}

/**
 * Forward bukti bayar: pesan apa pun (teks/gambar) yang dikirim user berstatus
 * pending di DM diteruskan ke owner. Hanya berjalan saat pesan BUKAN command.
 */
handler.all = async (m, { db, conn, config, ...ctx }) => {
  if (m.isGroup || m.fromMe || !m.sender) return;
  const pendings = Object.entries(db.data.rentals || {}).filter(
    ([, r]) => r.status === 'pending' && r.renter === m.sender,
  );
  if (!pendings.length) return;

  const groupsText = pendings.map(([jid, r]) => `• ${r.renterName || bareNumber(jid)} → ${jid}`).join('\n');
  const caption = `🧾 Bukti bayar dari *${m.pushName || bareNumber(m.sender)}*\nUntuk sewa:\n${groupsText}\n\nApprove: ${config.bot.prefix[0]}rent approve <id grup>`;

  if (m.mtype === 'image') {
    const buffer = await m.download().catch(() => null);
    if (buffer) {
      for (const jid of config?.bot?.ownerJids || []) await conn.sendMessage(jid, { image: buffer, caption }).catch(() => {});
    } else {
      for (const jid of config?.bot?.ownerJids || []) await conn.sendMessage(jid, { text: caption }).catch(() => {});
    }
  } else {
    const body = m.text ? `${caption}\n\n📝 ${m.text.slice(0, 500)}` : caption;
    for (const jid of config?.bot?.ownerJids || []) await conn.sendMessage(jid, { text: body }).catch(() => {});
  }

  for (const [, r] of pendings) r.lastProofAt = Date.now();
  db.touch();
};

handler.help = ['rent', 'sewa', 'rentstatus', 'renew', 'grouplist'];
handler.tags = ['main'];
handler.command = /^(rent|sewa|rentstatus|renew|grouplist)$/i;

export default handler;