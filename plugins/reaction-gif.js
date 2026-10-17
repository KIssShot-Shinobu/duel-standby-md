/**
 * Reaction GIF (SFW) — interaksi lucu antar user.
 *
 *   .kick @user      -> nendang user
 *   .hug @user       -> peluk user
 *   .kiss @user      -> cium user
 *   .slap @user      -> tampar user
 *   .pat @user       -> pukul sayang user
 *   .cuddle @user    -> peluk erat user
 *   .poke @user      -> colok user
 *   .tickle @user    -> gelitik user
 *   .highfive @user  -> high five user
 *   .bite @user      -> gigit user
 *   .bonk @user      -> bonk user (meme)
 *   .feed @user      -> makanin user
 *   .wave @user      -> bye user
 *   .blush @user     -> malu ke user
 *   .smile @user     -> senyum ke user
 *   .wink @user      -> kedip ke user
 *   .stare @user     -> nongol ke user
 *   .facepalm @user  -> facepalm karena user
 *   .yeet @user      -> lempar user
 *   .carry @user     -> angkat user
 *
 * Target: mention (@628xx), reply pesan user, atau nomor di argumen.
 * Nama target di caption dirender WhatsApp sendiri dari token `@angka` +
 * `mentions` (contextInfo.mentionedJid) — lihat catatan di dalam handler.
 * Tanpa target -> bot jadi target (self-reaction).
 * Alias Indonesia: .tendang, .peluk, .cium, .tampar, .sayang, .peluk2, .colok, .gelitik, .high5, .gigit, .lempar, .angkat
 */

import { bareNumber, getTargets } from '../lib/functions.js';
import { fetchImage, downloadImage } from '../lib/image-source.js';
import { sendImageResult } from '../lib/media-send.js';
import { userError } from '../lib/errors.js';
import { userName } from '../lib/messages.js';

// Mapping command -> kategori nekos.best
const REACTION_MAP = {
  kick: 'kick',
  hug: 'hug',
  kiss: 'kiss',
  slap: 'slap',
  pat: 'pat',
  cuddle: 'cuddle',
  poke: 'poke',
  tickle: 'tickle',
  highfive: 'highfive',
  bite: 'bite',
  bonk: 'bonk',
  feed: 'feed',
  wave: 'wave',
  blush: 'blush',
  smile: 'smile',
  wink: 'wink',
  stare: 'stare',
  facepalm: 'facepalm',
  yeet: 'yeet',
  carry: 'carry',
  // Alias Indonesia
  tendang: 'kick',
  peluk: 'hug',
  cium: 'kiss',
  tampar: 'slap',
  sayang: 'pat',
  peluk2: 'cuddle',
  colok: 'poke',
  gelitik: 'tickle',
  high5: 'highfive',
  gigit: 'bite',
  lempar: 'yeet',
  angkat: 'carry',
};

const REACTION_VERBS = {
  kick: 'nendang',
  hug: 'memeluk',
  kiss: 'mencium',
  slap: 'menampar',
  pat: 'memukul sayang',
  cuddle: 'memeluk erat',
  poke: 'menyodok',
  tickle: 'menggigitik',
  highfive: 'high five',
  bite: 'menggigit',
  bonk: 'bonk',
  feed: 'memberi makan',
  wave: 'melambaikan tangan ke',
  blush: 'malu melihat',
  smile: 'tersenyum ke',
  wink: 'mengedipkan mata ke',
  stare: 'menatap',
  facepalm: 'facepalm karena',
  yeet: 'melempar',
  carry: 'mengangkat',
};

const REACTION_EMOJI = {
  kick: '👢',
  hug: '🤗',
  kiss: '💋',
  slap: '👋',
  pat: '🤚',
  cuddle: '🫂',
  poke: '👉',
  tickle: '😂',
  highfive: '✋',
  bite: '🦷',
  bonk: '🔨',
  feed: '🍴',
  wave: '👋',
  blush: '😳',
  smile: '😊',
  wink: '😉',
  stare: '👀',
  facepalm: '🤦',
  yeet: '🚀',
  carry: '💪',
};

function helpText(usedPrefix) {
  const actions = [...new Set(Object.values(REACTION_MAP))].sort();
  const lines = [
    '🎭 *REACTION GIF*',
    '',
    'Tag/reply user lalu:',
  ];
  for (const action of actions) {
    const v = REACTION_VERBS[action] || action;
    lines.push(`  ${usedPrefix}${action} @user  -> ${v} user`);
  }
  lines.push(
    '',
    'Tanpa target -> bot jadi target (self-reaction).',
    'Alias Indo: tendang, peluk, cium, tampar, sayang, peluk2, colok, gelitik, high5, gigit, lempar, angkat',
    `Contoh: ${usedPrefix}kick @628xx  |  ${usedPrefix}hug (reply pesan)  |  ${usedPrefix}peluk @628xx`,
  );
  return lines.join('\n');
}

const handler = async (m, { conn, text, args, command, usedPrefix, config }) => {
  if (/^reactionlist$/i.test(command)) return m.reply(helpText(usedPrefix));

  // command langsung = action (.kick, .hug, .kiss, dll)
  const action = REACTION_MAP[command.toLowerCase()];
  if (!action) return; // bukan command reaction

  // Cari target dari mention, reply, atau argumen
  const targets = getTargets(m, args);
  const senderName = userName(m) || 'Kamu';

  let targetJid = null;
  let targetName = null;
  let mentionJids = [];

  if (targets.length > 0) {
    targetJid = targets[0];
    // Nama target TIDAK di-resolve oleh bot sendiri. WhatsApp yang mengganti
    // token `@angka` di teks menjadi nama asalkan JID-nya ada di `mentions`
    // (contextInfo.mentionedJid) — itu sebabnya pesan asli user tertulis
    // `@183498317000877` (angka) tapi tampil sebagai nama di HP.
    // Token dan `mentions` karena itu wajib memakai bentuk identitas yang SAMA,
    // persis seperti WhatsApp menulis mentionnya sendiri; kalau tidak cocok,
    // WhatsApp hanya menampilkan angkanya. Pola ini sama dengan
    // `plugins/_afk.js` dan `plugins/_welcome.js` yang sudah jalan di grup.
    mentionJids = [targetJid];
    targetName = bareNumber(targetJid);
  } else {
    // Self-reaction: bot jadi target
    targetJid = conn.user?.id || '628999@s.whatsapp.net';
    targetName = config.bot?.name || 'Bot';
  }

  // Jangan biar user reaction ke diri sendiri (kecuali self-reaction mode)
  if (targetJid === m.sender && targets.length > 0) {
    return m.reply('🤔 Mau reaction ke diri sendiri? Coba tanpa mention/reply aja.');
  }

  // Ambil GIF dari nekos.best
  let item;
  try {
    item = await fetchImage({ mode: 'sfw', query: action, config });
  } catch (err) {
    throw userError(`❌ Gagal ambil GIF *${action}*.`);
  }

  const buffer = await downloadImage(item, { config }).catch(() => null);
  if (!buffer) throw userError('❌ GIF gagal diunduh. Coba lagi sebentar lagi.');

  // Format caption
  const verb = REACTION_VERBS[action] || action;
  const emoji = REACTION_EMOJI[action] || '';
  const isSelf = targetJid === conn.user?.id;

  const caption = isSelf
    ? `*${senderName}* ${verb} *${config.bot?.name || 'Bot'}* 😳 ${emoji}`
    : `*${senderName}* ${verb} *@${targetName}* ${emoji}`;

  await sendImageResult(conn, m.chat, {
    buffer,
    caption,
    quoted: m,
    config,
    mentions: isSelf ? [] : mentionJids,
  });

  return item.id;
};

handler.help = [...Object.keys(REACTION_MAP).filter((v, i, a) => a.indexOf(v) === i), 'reactionlist'];
handler.tags = ['reaction'];
handler.command = new RegExp(`^(${Object.keys(REACTION_MAP).join('|')}|reactionlist)$`, 'i');
handler.limit = true;

export default handler;