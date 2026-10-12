import pino from 'pino';
import config from '../config.js';

const level = process.env.LOG_LEVEL || (config.flags.debug ? 'debug' : 'silent');

/** Logger yang dipakai Baileys + internal bot. */
export const logger = pino({
  level,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

export default logger;
