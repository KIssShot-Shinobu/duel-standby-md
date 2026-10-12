import pino from 'pino';
import config from '../config.js';

const level = process.env.LOG_LEVEL || (config.flags.debug ? 'debug' : 'silent');

/** Logger yang dipakai internal bot (print.js untuk output manusiawi). */
export const logger = pino({
  level,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Logger untuk Baileys. Sengaja selalu silent kecuali `--debug`, supaya
 * log JSON internal Baileys tidak membanjiri konsol panel.
 */
export const silentLogger = pino({ level: config.flags.debug ? 'debug' : 'silent' });

export const baileysLogger = config.flags.debug ? logger : silentLogger;

export default logger;
