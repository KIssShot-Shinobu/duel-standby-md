/**
 * Kalkulator sederhana tanpa eval().
 *   .calc 12 * (3 + 4) / 2
 * Mendukung: + - * / % ^ ( ) dan fungsi sqrt/abs/round/floor/ceil/min/max.
 */
const FUNCTIONS = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  min: Math.min,
  max: Math.max,
};

export function calculate(input) {
  const tokens = String(input)
    .replace(/\s+/g, '')
    .match(/(\d+\.?\d*|[a-zA-Z]+|[+\-*/%^(),])/g);
  if (!tokens) throw new Error('Ekspresi kosong');

  let index = 0;
  const peek = () => tokens[index];
  const next = () => tokens[index++];

  const parseExpression = () => {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const right = parseTerm();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  };

  const parseTerm = () => {
    let value = parsePower();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = next();
      const right = parsePower();
      if (op === '*') value *= right;
      else if (op === '/') value /= right;
      else value %= right;
    }
    return value;
  };

  const parsePower = () => {
    const base = parseUnary();
    if (peek() === '^') {
      next();
      return base ** parsePower();
    }
    return base;
  };

  const parseUnary = () => {
    if (peek() === '-') {
      next();
      return -parseUnary();
    }
    if (peek() === '+') {
      next();
      return parseUnary();
    }
    return parseAtom();
  };

  const parseAtom = () => {
    const token = next();
    if (token === undefined) throw new Error('Ekspresi tidak lengkap');
    if (token === '(') {
      const value = parseExpression();
      if (next() !== ')') throw new Error('Tanda kurung tidak seimbang');
      return value;
    }
    if (/^[a-zA-Z]+$/.test(token)) {
      const fn = FUNCTIONS[token.toLowerCase()];
      if (!fn) throw new Error(`Fungsi "${token}" tidak dikenal`);
      if (next() !== '(') throw new Error(`Fungsi ${token} butuh tanda kurung`);
      const args = [parseExpression()];
      while (peek() === ',') {
        next();
        args.push(parseExpression());
      }
      if (next() !== ')') throw new Error('Tanda kurung tidak seimbang');
      return fn(...args);
    }
    const number = Number(token);
    if (!Number.isFinite(number)) throw new Error(`Token tidak valid: ${token}`);
    return number;
  };

  const result = parseExpression();
  if (index !== tokens.length) throw new Error(`Sisa ekspresi tidak dipahami: ${tokens.slice(index).join('')}`);
  if (!Number.isFinite(result)) throw new Error('Hasil bukan angka valid');
  return result;
}

const handler = async (m, { text, config }) => {
  if (!text) return m.reply(`Contoh: ${config.bot.prefix[0]}calc 12 * (3 + 4) / 2`);
  try {
    const result = calculate(text);
    return m.reply(`🧮 *${text.trim()} = ${result}*`);
  } catch (err) {
    return m.reply(`❌ ${err.message}`);
  }
};

handler.help = ['calc', 'kalkulator'];
handler.tags = ['tools'];
handler.command = /^(calc|kalkulator|hitung)$/i;
handler.limit = false;

export default handler;
