/**
 * Helper pencocokan jawaban tebak-tebakan (dipakai game Yu-Gi-Oh!).
 * Dipisah ke modul sendiri supaya bisa diuji tanpa WhatsApp.
 */

/** Normalisasi teks jawaban: huruf kecil, tanpa tanda baca, tanpa spasi ganda. */
export function normalizeAnswer(text = '') {
  return String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(yugioh|yu gi oh|card|kartu|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Jarak edit (Levenshtein) — untuk toleransi salah ketik. */
export function levenshtein(a = '', b = '') {
  const s = String(a);
  const t = String(b);
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;

  let previous = Array.from({ length: t.length + 1 }, (_, index) => index);
  for (let i = 1; i <= s.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[t.length];
}

/** Berapa salah ketik yang masih ditoleransi (nama pendek = harus persis). */
export function toleranceFor(answer = '') {
  const length = normalizeAnswer(answer).length;
  if (length <= 4) return 0;
  if (length <= 8) return 1;
  if (length <= 16) return 2;
  return 3;
}

/**
 * Semua bentuk jawaban yang diterima untuk sebuah kartu.
 * Archetype TIDAK dimasukkan secara default: banyak kartu namanya sama dengan
 * archetype-nya (mis. "Dark Magician"), jadi mengecualikannya berdasarkan teks
 * akan membuat nama kartu itu sendiri ikut tertolak.
 */
export function answerVariants(card = {}, { includeArchetype = false } = {}) {
  const variants = new Set();
  const add = (value) => {
    const normalized = normalizeAnswer(value);
    if (normalized) variants.add(normalized);
  };
  add(card.name);
  add(String(card.name || '').replace(/["'“”]/g, ''));
  add(card.id);
  if (includeArchetype) add(card.archetype);
  // nama tanpa sub-judul setelah koma / tanda hubung
  const base = String(card.name || '').split(/[,–—-]/)[0];
  add(base);
  return [...variants];
}

/**
 * Apakah tebakan benar?
 * @param {string} guess
 * @param {object} card
 * @param {{maxDistance?: number, allowArchetype?: boolean}} options
 */
export function isCorrectGuess(guess, card = {}, { maxDistance, allowArchetype = false } = {}) {
  const normalized = normalizeAnswer(guess);
  if (!normalized) return false;

  const variants = answerVariants(card, { includeArchetype: allowArchetype });
  for (const variant of variants) {
    if (normalized === variant) return true;
    const tolerance = maxDistance ?? toleranceFor(variant);
    if (variant.length >= 5 && levenshtein(normalized, variant) <= tolerance) return true;
    // jawaban sebagian (mis. "dark magician" untuk "Dark Magician Girl")
    if (variant.length >= 8 && normalized.length >= 5 && variant.startsWith(normalized) && variant.length - normalized.length <= 3) {
      return true;
    }
  }
  return false;
}

/** Buat pilihan ganda: 1 jawaban benar + distraktor, sudah diacak. */
export function buildChoices(card, pool = [], count = 4, rng = Math.random) {
  const seen = new Set([normalizeAnswer(card.name)]);
  const distractors = [];
  for (const candidate of pool) {
    const name = String(candidate?.name || candidate || '').trim();
    const key = normalizeAnswer(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    distractors.push(name);
    if (distractors.length >= count - 1) break;
  }

  const choices = [{ name: card.name, correct: true }, ...distractors.map((name) => ({ name, correct: false }))];
  // Fisher-Yates dengan rng yang bisa diganti saat tes
  for (let i = choices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return choices.map((choice, index) => ({ ...choice, label: 'ABCD'[index] }));
}

/**
 * Cocokkan tebakan dengan pilihan ganda: boleh huruf (A/B/C/D) atau nama kartu.
 * @returns {{index: number, choice: object}|null}
 */
export function matchChoice(guess, choices = []) {
  const raw = String(guess || '').trim();
  if (!raw || !choices.length) return null;

  const letter = raw.match(/^([a-d])\b/i) || raw.match(/^([a-d])[).:]?$/i);
  if (letter) {
    const index = 'abcd'.indexOf(letter[1].toLowerCase());
    if (index >= 0 && choices[index]) return { index, choice: choices[index] };
  }

  const normalized = normalizeAnswer(raw);
  for (let index = 0; index < choices.length; index += 1) {
    if (isCorrectGuess(raw, { name: choices[index].name })) return { index, choice: choices[index] };
    if (normalizeAnswer(choices[index].name) === normalized) return { index, choice: choices[index] };
  }
  return null;
}

/** Pilih n elemen acak dari array (tanpa mengubah array asal). */
export function sample(list = [], count = 1, rng = Math.random) {
  const copy = [...list];
  const result = [];
  while (copy.length && result.length < count) {
    result.push(...copy.splice(Math.floor(rng() * copy.length), 1));
  }
  return result;
}

export default {
  normalizeAnswer,
  levenshtein,
  toleranceFor,
  answerVariants,
  isCorrectGuess,
  buildChoices,
  matchChoice,
  sample,
};
