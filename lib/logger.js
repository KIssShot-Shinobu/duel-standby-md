/**
 * Logger internal bot.
 *
 * Pino tetap dipakai sebagai API (level, child, serialisasi error), tapi
 * output-nya TIDAK lagi JSON mentah di terminal — setiap baris diformat ulang
 * lewat `print.js` supaya sama rapi dengan log bot lainnya:
 *
 *   21:30:05 INFO  [reward] 628111 +5 xp +3 saldo │ total 120 xp • 40 saldo • level 1
 *
 * Field tambahan (mis. `logger.warn({ chat }, '...')`) ikut ditampilkan sebagai
 * `key=value` di ujung baris, dan `err` dicetak sebagai stack di baris berikutnya.
 */
import { Writable } from 'node:stream';
import pino from 'pino';
import config from '../config.js';
import print from './print.js';

const level = process.env.LOG_LEVEL || (config.flags.debug ? 'debug' : 'silent');

/** Nomor level pino -> nama fungsi di print.js. */
const TAG_BY_LEVEL = { 10: 'debug', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'error' };
const INTERNAL_FIELDS = new Set(['level', 'time', 'msg', 'pid', 'hostname', 'v', 'err']);

const stringify = (value) => (typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value));

/** Ubah satu baris JSON pino menjadi baris rapi (atau teruskan apa adanya). */
function formatLine(text) {
  let record;
  try {
    record = JSON.parse(text);
  } catch {
    return text;
  }
  if (!record || typeof record !== 'object') return text;

  const tag = TAG_BY_LEVEL[record.level] || 'info';
  const extras = Object.entries(record)
    .filter(([key]) => !INTERNAL_FIELDS.has(key))
    .map(([key, value]) => `${key}=${stringify(value)}`)
    .join(' ');

  print[tag](`${record.msg ?? ''}${extras ? `  ${print.color.gray(extras)}` : ''}`);
  if (record.err) print.error(String(record.err.stack || record.err.message || record.err));
  return '';
}

const prettyStream = new Writable({
  write(chunk, _encoding, callback) {
    const text = String(chunk).trim();
    if (text) {
      const line = formatLine(text);
      if (line) process.stdout.write(`${line}\n`);
    }
    callback();
  },
});

export const logger = pino({ level, base: undefined, timestamp: false }, prettyStream);

/**
 * Logger untuk Baileys. Sengaja selalu silent kecuali `--debug`, supaya
 * log internal Baileys tidak membanjiri konsol panel.
 */
export const silentLogger = pino({ level: 'silent' });

export const baileysLogger = config.flags.debug ? logger : silentLogger;

export default logger;
