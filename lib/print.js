/**
 * Printer log konsol yang enak dibaca (pengganti chalk/colors tanpa dependency berat).
 */
import pc from 'picocolors';

const time = (timeZone = 'Asia/Jakarta') =>
  new Intl.DateTimeFormat('id-ID', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());

export const color = pc;

export function banner(name, version = '') {
  const line = '─'.repeat(46);
  console.log(pc.cyan(`┌${line}┐`));
  console.log(pc.cyan('│') + pc.bold(pc.white(` ${name} ${version}`.padEnd(45))) + pc.cyan('│'));
  console.log(pc.cyan(`└${line}┘`));
}

export function info(message, ...args) {
  console.log(`${pc.gray(time())} ${pc.blue('INFO')} ${message}`, ...args);
}

export function success(message, ...args) {
  console.log(`${pc.gray(time())} ${pc.green('OK  ')} ${message}`, ...args);
}

export function warn(message, ...args) {
  console.log(`${pc.gray(time())} ${pc.yellow('WARN')} ${message}`, ...args);
}

export function error(message, ...args) {
  console.error(`${pc.gray(time())} ${pc.red('ERR ')} ${message}`, ...args);
}

export function debug(message, ...args) {
  if (!process.env.LOG_LEVEL || !/debug|trace/.test(process.env.LOG_LEVEL)) return;
  console.log(`${pc.gray(time())} ${pc.magenta('DBG ')} ${message}`, ...args);
}

/** Cetak ringkasan pesan masuk ala bot WhatsApp. */
export function printMessage({ chat, sender, pushName, mtype = 'text', text = '', isGroup = false, timeZone }) {
  const kind = isGroup ? pc.magenta('GROUP') : pc.cyan('PRIVATE');
  const who = pushName ? `${pushName} (${sender})` : sender;
  const body = String(text || '').replace(/\s+/g, ' ').slice(0, 200);
  console.log(
    `${pc.gray(time(timeZone))} ${kind} ${pc.bold(chat)} ← ${who} ${pc.gray(`[${mtype}]`)} ${body}`,
  );
}

/** Cetak pemakaian perintah. */
export function printCommand({ command, sender, chat, isGroup = false, timeZone }) {
  const kind = isGroup ? pc.magenta('GROUP') : pc.cyan('PRIVATE');
  console.log(`${pc.gray(time(timeZone))} ${kind} ${pc.bold(chat)} » ${pc.yellow(`.${command}`)} oleh ${sender}`);
}

export default { color, banner, info, success, warn, error, debug, printMessage, printCommand };
