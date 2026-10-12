/**
 * Pencarian lanjutan kartu Yu-Gi-Oh!.
 *   .ygosearch atk>2500 level<=4 attribute=dark sort=atk
 *   .ygosearch type=xyz race=dragon num=5
 *   .ygosearch archetype="blue-eyes" banlist=tcg
 *   .ygosearch staple=yes
 *
 * Parameter yang didukung: name, fname, id, type, atk, def, level, race,
 * attribute, link, linkmarker, scale, cardset, archetype, banlist, sort,
 * format, staple, misc, has_effect, startdate, enddate, dateregion, num, offset.
 */
import { getClient, formatCardLine, parseSearchQuery } from '../lib/ygoprodeck.js';

const MAX_RESULTS = 15;

const handler = async (m, { text, config, usedPrefix, command }) => {
  const raw = String(text || '').trim();

  if (!raw) {
    return m.reply(
      [
        `*「 PENCARIAN KARTU 」*`,
        '',
        `• ${usedPrefix}${command} atk>2500 level<=4 attribute=dark sort=atk`,
        `• ${usedPrefix}${command} type=xyz race=dragon num=5`,
        `• ${usedPrefix}${command} archetype="blue-eyes" banlist=tcg`,
        `• ${usedPrefix}${command} staple=yes`,
        '',
        'Operator yang didukung: > >= < <= = (untuk atk, def, level).',
        'Alias type: normal, effect, ritual, fusion, synchro, xyz, link, pendulum, spell, trap.',
      ].join('\n'),
    );
  }

  const { params, unknown } = parseSearchQuery(raw);
  if (!Object.keys(params).length) {
    return m.reply(`❌ Tidak ada filter yang dikenali dari: *${raw}*\nKetik ${usedPrefix}${command} tanpa argumen untuk contoh.`);
  }

  const ygo = getClient(config);
  const num = Math.min(Number(params.num) || 10, MAX_RESULTS);
  const requestParams = { ...params, num: String(num) };
  if (!requestParams.sort) requestParams.sort = 'name';

  let payload;
  try {
    payload = await ygo.card(requestParams);
  } catch (err) {
    return m.reply(`❌ Pencarian gagal:\n${err.message}`);
  }

  const cards = payload.data || [];
  const total = payload.meta?.total_rows ?? cards.length;

  if (!cards.length) return m.reply('🔎 Tidak ada kartu yang cocok dengan filter tersebut.');

  const filters = Object.entries(requestParams)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');

  const lines = [
    `🔎 *HASIL PENCARIAN*`,
    `\`${filters}\``,
    total > cards.length ? `Menampilkan ${cards.length} dari *${total}* kartu` : `*${total}* kartu ditemukan`,
    '',
    ...cards.map((card, index) => formatCardLine(card, index)),
  ];

  if (unknown.length) lines.push('', `⚠️ Filter diabaikan: ${[...new Set(unknown)].join(', ')}`);

  return m.reply(lines.join('\n'));
};

handler.help = ['ygosearch', 'ygofind'];
handler.tags = ['game'];
handler.command = /^(ygosearch|ygofind|searchygo)$/i;
handler.limit = true;

export default handler;
