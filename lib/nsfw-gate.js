/**
 * Gerbang NSFW per chat/grup.
 *
 * Dua lapis kontrol:
 *   1. **Global (owner bot)** — kategori `nsfw` di menu (`enabled: false` bawaan).
 *      Selama ini mati, semua command NSFW diabaikan (lihat handler.js).
 *   2. **Per chat (admin grup / owner)** — flag `nsfw` di record chat.
 *      Bawaan **mati**, jadi fitur 18+ tidak pernah muncul di sebuah grup
 *      sebelum admin grup (atau owner bot) menyalakannya sendiri.
 *
 * Disimpan di `db.data.chats[jid].nsfw` sehingga bertahan setelah restart.
 */

/** Kata yang dianggap "nyalakan". */
const ON = /^(on|enable|enabled|aktif|aktifkan|nyala|nyalakan|hidup)$/i;
/** Kata yang dianggap "matikan". */
const OFF = /^(off|disable|disabled|mati|matikan|nonaktif|nonaktifkan)$/i;

/**
 * Terjemahkan argumen pertama menjadi aksi.
 * @returns {'on'|'off'|''}
 */
export function parseNsfwAction(token = '') {
  const value = String(token || '').trim();
  if (ON.test(value)) return 'on';
  if (OFF.test(value)) return 'off';
  return '';
}

/** Apakah fitur 18+ aktif di chat ini? (bawaan: tidak) */
export function chatNsfwEnabled(db, chat) {
  if (!db?.chat || !chat) return false;
  return db.chat(chat).nsfw === true;
}

/** Ubah status fitur 18+ untuk satu chat. */
export function setChatNsfw(db, chat, enabled) {
  const record = db.chat(chat);
  record.nsfw = Boolean(enabled);
  record.updatedAt = Date.now();
  db.touch?.();
  return record.nsfw;
}

/**
 * Siapa yang boleh mengubah status?
 * - owner bot: di mana saja
 * - admin grup: hanya di grup (di chat pribadi tidak ada admin, jadi owner saja)
 */
export function canToggleNsfw({ isOwner = false, isAdmin = false, isGroup = false } = {}) {
  if (isOwner) return true;
  return Boolean(isGroup && isAdmin);
}

/** Pesan penolakan saat bukan admin grup/owner. */
export function toggleDeniedText(isGroup = false) {
  return isGroup
    ? '🔒 Hanya *admin grup* atau *owner bot* yang bisa mengubah status fitur 18+ di grup ini.'
    : '🔒 Di chat pribadi, hanya *owner bot* yang bisa mengubah status fitur 18+.';
}

/** Pesan saat fitur 18+ belum dinyalakan di chat ini. */
export function lockedText(usedPrefix = '.', isGroup = false) {
  return [
    '🔒 Fitur 18+ *belum diaktifkan di chat ini*.',
    '',
    isGroup
      ? `Admin grup bisa menyalakannya: *${usedPrefix}nsfw on* (matikan: *${usedPrefix}nsfw off*)`
      : `Hanya owner bot yang bisa menyalakannya: *${usedPrefix}nsfw on*`,
  ].join('\n');
}

/** Ringkasan status untuk `.nsfwstatus` / `.nsfwlist`. */
export function formatNsfwStatus({ globalEnabled, chatEnabled, isGroup = false, usedPrefix = '.' } = {}) {
  return [
    `• Kategori bot : ${globalEnabled ? '✅ aktif' : '⛔ mati'}  _(${usedPrefix}category nsfw on)_`,
    `• ${(isGroup ? 'Grup ini' : 'Chat ini').padEnd(12)} : ${chatEnabled ? '✅ aktif' : '⛔ mati'}  _(nsfw on / nsfw off)_`,
  ].join('\n');
}

export default {
  parseNsfwAction,
  chatNsfwEnabled,
  setChatNsfw,
  canToggleNsfw,
  toggleDeniedText,
  lockedText,
  formatNsfwStatus,
};
