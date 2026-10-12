/**
 * Konvensi error yang "ramah pengguna" (gaya wabot-aq/RTXZY).
 *
 * Plugin boleh `throw 'pesan ramah'` (string) atau `throw userError('pesan')`.
 * Handler akan meneruskan pesan tersebut ke pengguna, sedangkan error teknis
 * (bug, network, dll.) tetap disamarkan dengan pesan umum + detail hanya saat
 * mode --debug.
 */

/** Error yang aman ditampilkan ke pengguna. */
export class UserError extends Error {
  constructor(message) {
    super(String(message ?? 'Terjadi kesalahan'));
    this.name = 'UserError';
    this.friendly = true;
  }
}

export const userError = (message) => new UserError(message);

/** Apakah error ini pantas ditampilkan apa adanya ke pengguna? */
export function isFriendlyError(err) {
  if (typeof err === 'string') return true;
  return err?.friendly === true || err?.name === 'UserError';
}

/** Ambil teks pesan dari error apa pun (string, Error, atau objek lain). */
export function errorText(err) {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || err.name || 'Error tanpa pesan';
  if (err && typeof err === 'object' && 'message' in err) return String(err.message);
  if (err === undefined || err === null) return 'Kesalahan tidak diketahui';
  return String(err);
}

/** Teks untuk log internal (sertakan stack bila ada). */
export function errorLog(err) {
  if (err instanceof Error) return err.stack || err.message;
  return errorText(err);
}

export default { UserError, userError, isFriendlyError, errorText, errorLog };
