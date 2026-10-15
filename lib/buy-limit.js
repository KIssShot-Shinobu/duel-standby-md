/**
 * Jual limit dengan saldo in-game.
 *
 * Alurnya: `quote()` mengecek dulu (paket / harga satuan, saldo cukup, belum
 * kena batas harian-bulanan) tanpa mengubah apa pun; kalau lolos, `purchase()`
 * yang benar-benar memotong saldo dan menambah bonus limit.
 *
 * Limit yang dibeli disimpan sebagai `limitBonus`, jadi:
 *  - tidak hilang saat reset harian, sama seperti bonus dari owner;
 *  - langsung terpakai seperti limit biasa (dikurangi tiap command berlimit);
 *  - ikut terhitung di kuota premium kalau pemiliknya premium.
 *
 * Batas harian sengaja disejajarkan dengan siklus reset limit, bukan kalender:
 * "maksimal 60 per siklus" jauh lebih mudah dipahami user daripada "per hari".
 */
import { adjustLimit } from './permissions.js';

/** Konfigurasi beli limit beserta nilai bawaannya. */
export function buySettings(config) {
  const raw = config?.buyLimit || {};
  const price = Math.max(1, Number(raw.price) || 250);
  const packages = (Array.isArray(raw.packages) ? raw.packages : [])
    .map((item) => ({ limit: Math.trunc(Number(item?.limit) || 0), price: Math.max(0, Math.trunc(Number(item?.price) || 0)) }))
    .filter((item) => item.limit > 0 && item.price > 0)
    .sort((a, b) => a.limit - b.limit);
  return {
    enabled: raw.enabled !== false,
    price,
    packages,
    min: Math.max(1, Math.trunc(Number(raw.min) || 1)),
    max: Math.max(1, Math.trunc(Number(raw.max) || 60)),
    dailyCap: Math.max(0, Math.trunc(Number(raw.dailyCap) || 0)),
    monthlyCap: Math.max(0, Math.trunc(Number(raw.monthlyCap) || 0)),
    resetIntervalMs: config?.limits?.resetIntervalMs ?? 86400000,
    timezone: config?.bot?.timezone || 'Asia/Jakarta',
  };
}

/** Kunci bulan kalender (YYYY-MM) menurut timezone bot. */
export function monthKey(now = Date.now(), timezone = 'Asia/Jakarta') {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date(now));
    const get = (type) => parts.find((item) => item.type === type)?.value || '';
    return `${get('year')}-${get('month')}`;
  } catch {
    const d = new Date(now);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
}

/**
 * Total limit yang sudah dibeli user, serta sisa kuota belinya.
 *
 * Jendela harian TIDAK ditumpangkan ke `lastLimitReset`: field itu ditulis ulang
 * oleh `refreshLimit()` setiap pesan begitu siklus limit berganti, sehingga
 * tracker harian tidak akan pernah melihat pergantian itu dan jatahnya bisa
 * terkunci permanen. Jadi jendela dicatat sendiri: mulai dari pembelian pertama,
 * berlaku `resetIntervalMs`, lalu berganti sendiri.
 * Tracker bulanan mengikuti pergantian bulan kalender.
 */
export function buyStatus(user, config) {
  const settings = buySettings(config);
  const interval = settings.resetIntervalMs;
  const now = Date.now();
  const dayKey = Number(user?.buyDayKey) || 0;

  const windowActive = Boolean(dayKey) && now - dayKey < interval;
  const dayAmount = windowActive ? Math.max(0, Number(user?.buyDayAmount) || 0) : 0;

  const key = monthKey(now, settings.timezone);
  const monthAmount = user?.buyMonthKey === key ? Math.max(0, Number(user?.buyMonthAmount) || 0) : 0;

  return {
    dayAmount,
    monthAmount,
    dayLeft: settings.dailyCap > 0 ? Math.max(0, settings.dailyCap - dayAmount) : Infinity,
    monthLeft: settings.monthlyCap > 0 ? Math.max(0, settings.monthlyCap - monthAmount) : Infinity,
    dailyCap: settings.dailyCap,
    monthlyCap: settings.monthlyCap,
    resetAt: windowActive ? dayKey + interval : 0,
  };
}

/** Daftar paket siap tampil, lengkap dengan penghematan terhadap harga satuan. */
export function buyCatalog(config) {
  const settings = buySettings(config);
  return settings.packages.map((item) => {
    const normal = item.limit * settings.price;
    return {
      ...item,
      normal,
      hemat: Math.max(0, normal - item.price),
      label: `${item.limit} limit`,
    };
  });
}

/**
 * Hitung harga tanpa mengubah apa pun.
 *
 * @param input number|string - jumlah limit, atau angka yang cocok dengan paket
 * @returns {{ok: true, limit: number, cost: number, isPackage: boolean}
 *          |{ok: false, reason: string, [needed]: number, [have]: number, [left]: number}}
 */
export function quote(db, user, config, input) {
  const settings = buySettings(config);
  const status = buyStatus(user, config);

  if (!settings.enabled) return { ok: false, reason: 'disabled' };

  const raw = String(input ?? '').trim();
  const amount = Number(raw);

  // Paket dulu: ".buylimit 30" harus dapat harga paket, bukan harga satuan.
  const pack = settings.packages.find((item) => item.limit === amount);
  const limit = pack?.limit ?? Math.trunc(amount);
  const cost = pack ? pack.price : limit * settings.price;

  // min/max hanya untuk JUMLAH BEBAS (lihat config.buyLimit.min/max) — paket
  // sudah punya jumlah & harga sendiri dan tetap ditawarkan oleh katalog.
  // Dulu rentang ini ikut menolak paket, sehingga `.buylimit 30` menjawab
  // "format salah" padahal katalog baru saja menawarkan paket 30.
  const inRange = pack ? true : limit >= settings.min && limit <= settings.max;
  if (!raw || !Number.isFinite(amount) || limit <= 0 || !inRange) {
    return { ok: false, reason: 'invalid' };
  }

  if (status.dayLeft < limit) return { ok: false, reason: 'dailyCap', left: status.dayLeft, want: limit };
  if (status.monthLeft < limit) return { ok: false, reason: 'monthlyCap', left: status.monthLeft, want: limit };

  const have = Math.max(0, Number(user?.saldo) || 0);
  if (have < cost) return { ok: false, reason: 'saldo', needed: cost, have };

  return { ok: true, limit, cost, isPackage: Boolean(pack) };
}

/**
 * Terapkan pembelian dari hasil `quote()` yang sudah `ok`.
 * Aman terhadap data rusak: saldo & bonus tidak pernah jadi negatif.
 * @returns {{limit: number, cost: number, saldo: number, bonus: number}}
 */
export function purchase(db, user, config, result) {
  const amount = Math.max(0, Math.trunc(Number(result?.limit) || 0));
  const cost = Math.max(0, Math.trunc(Number(result?.cost) || 0));
  if (!amount) return { limit: 0, cost: 0, saldo: Number(user?.saldo) || 0, bonus: Number(user?.limitBonus) || 0 };

  user.saldo = Math.max(0, (Number(user.saldo) || 0) - cost);
  // Pakai adjustLimit supaya perlakuannya identik dengan bonus dari owner:
  // kuota di-refresh dulu, jadi angka limit yang dilaporkan tidak meleset.
  adjustLimit(db, user, amount, config);

  const settings = buySettings(config);
  const key = monthKey(Date.now(), settings.timezone);
  // Jendela harian dimulai ulang kalau yang lama sudah lewat.
  if (!Number(user.buyDayKey) || Date.now() - Number(user.buyDayKey) >= settings.resetIntervalMs) {
    user.buyDayKey = Date.now();
    user.buyDayAmount = 0;
  }
  user.buyDayAmount = Math.max(0, Number(user.buyDayAmount) || 0) + amount;
  user.buyMonthAmount =
    (user.buyMonthKey === key ? Math.max(0, Number(user.buyMonthAmount) || 0) : 0) + amount;
  user.buyMonthKey = key;
  user.limitBonus = Math.max(0, Number(user.limitBonus) || 0);

  db.touch();
  return { limit: amount, cost, saldo: user.saldo, bonus: user.limitBonus };
}

/** Alasan kegagalan + kalimat yang enak dibaca user. */
export function reasonText(reason, { config, result, status } = {}) {
  const p = config?.bot?.prefix?.[0] || '.';
  const settings = buySettings(config);
  switch (reason) {
    case 'disabled':
      return 'Fitur beli limit lagi dimatikan sama owner. Sabar ya 😄';
    case 'saldo':
      return [
        `💸 Saldo kamu belum cukup.`,
        '',
        `Dibutuhkan: *${result?.needed ?? 0}*`,
        `Saldo kamu: *${result?.have ?? 0}*`,
        `Kurang: *${Math.max(0, (result?.needed ?? 0) - (result?.have ?? 0))}*`,
      ].join('\n');
    case 'dailyCap':
      return [
        '🚫 Jatah beli limit harian sudah habis.',
        '',
        `Sisa hari ini: *${result?.left ?? 0}* limit`,
        status?.resetAt ? `Reset lagi: *${new Date(status.resetAt).toLocaleString('id-ID', { timeZone: settings.timezone })}*` : '',
      ].filter(Boolean).join('\n');
    case 'monthlyCap':
      return `🚫 Jatah beli limit bulan ini sudah habis (${settings.monthlyCap} limit). Nanti bulan depan ya.`;
    default:
      return [
        `Format: ${p}buylimit <jumlah>`,
        '',
        `Minimal *${settings.min}*, maksimal *${settings.max}* limit per pembelian.`,
      ].join('\n');
  }
}