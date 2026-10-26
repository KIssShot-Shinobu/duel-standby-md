/**
 * Chat AI (OpenAI-compatible) — opsional, butuh AI_KEY di .env.
 *   .ai pertanyaan kamu
 *   .resetai            -> hapus riwayat chat biasa
 *   .resetownai         -> hapus memori khusus AI owner
 *
 * PERILAKU KHUSUS OWNER:
 *   Saat owner REPLY pesan bot ATAU TAG/MENTION bot (DM maupun grup), bot
 *   langsung menjawab dengan AI berpersona "waifu" (default: Oshino Shinobu).
 *   Percakapan owner disimpan di memori TERPISAH (database/owner-ai.json)
 *   dengan riwayat lebih panjang, dan bertahan antar restart. Owner juga
 *   memakai jalur ini saat mengetik `.ai`. Bypass gating rent.
 *
 * Contoh provider: OpenAI, Groq, Together, OpenRouter, Ollama (AI_BASE=http://localhost:11434/v1).
 */
import { userError } from '../lib/errors.js';
import { cleanJid } from '../lib/functions.js';
import { getOwnerMemory } from '../lib/owner-ai.js';
import { getQuiz } from '../lib/quiz-instance.js';

const MAX_HISTORY = 12;

/**
 * Pesan yang dibalas (`m.quoted`) berasal dari BOT INI?
 *
 * `m.quoted.fromMe` saja tidak cukup: di grup berbasis LID, `participant` pada
 * pesan yang di-quote berisi LID bot (bukan `conn.user.id`), sehingga fromMe
 * bernilai false walau pesannya milik bot. Identitas bot karena itu dicek dalam
 * dua bentuk: nomor telepon (`user.id`) dan LID (`user.lid`).
 *
 * Sengaja TIDAK memakai "ada m.quoted" saja: balasan ke pesan member lain dulu
 * ikut dijawab AI waifu, padahal bukan ditujukan ke bot.
 */
function isQuotedFromBot(m, conn) {
  const quoted = m?.quoted;
  if (!quoted) return false;
  if (quoted.fromMe) return true;
  const sender = cleanJid(quoted.sender || '');
  if (!sender) return false;
  return [conn?.user?.id, conn?.user?.lid]
    .filter(Boolean)
    .map((jid) => cleanJid(jid))
    .includes(sender);
}

/** Buka koneksi ke provider AI dan kembalikan jawaban teks. */
async function callAI(config, messages, { model } = {}) {
  let response;
  try {
    response = await fetch(`${config.ai.base.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.key}`,
      },
      body: JSON.stringify({ model: model || config.ai.model, messages, temperature: 0.7 }),
      signal: AbortSignal.timeout(90000),
    });
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      throw userError('⏱️ Request timeout. Server AI terlalu lama merespons.');
    }
    throw userError('📡 Gagal terhubung ke server AI. Cek koneksi atau coba lagi nanti.');
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    let msg;
    switch (response.status) {
      case 401:
      case 403:
        msg = '🔑 API key tidak valid atau tidak punya akses ke model ini.';
        break;
      case 404:
        msg = `🤖 Model *${model || config.ai.model}* tidak ditemukan di provider ini. Cek nama model di .env.`;
        break;
      case 429: {
        const retry = response.headers.get('retry-after') || 'beberapa saat';
        msg = `⏳ Terlalu banyak request. Coba lagi dalam *${retry} detik*.`;
        break;
      }
      case 500:
      case 502:
      case 503:
        msg = '☁️ Server AI sedang sibuk/maintenance. Coba lagi nanti ya.';
        break;
      default:
        msg = `⚠️ AI error (${response.status}). Coba lagi sebentar lagi.`;
    }
    throw userError(msg);
  }

  let json;
  try {
    json = await response.json();
  } catch {
    throw userError('⚠️ Respons AI tidak valid. Coba lagi.');
  }

  const answer = json?.choices?.[0]?.message?.content?.trim();
  if (!answer) throw userError('🤖 AI tidak memberikan jawaban. Coba pertanyaan lain.');
  return answer;
}

/** System prompt khusus owner = persona waifu + identitas bot. */
function ownerSystemPrompt(config) {
  return `${config.ai.ownerPersona}\n\nKamu adalah AI di bot WhatsApp bernama "${config.bot.name}". Pemilik bot ini adalah orang yang kamu cintai — "Araragi"-mu.`;
}

/** Promise jawaban AI jalur owner (pakai memori terpisah + persona waifu). */
async function ownerAnswer(m, config, prompt) {
  const mem = getOwnerMemory(config);
  const history = (mem.get(m.sender)?.history || []).slice(-(config.ai.ownerHistory || 50));
  const quoteText = m.quoted?.text ? `[Pesan yang kau balas: "${String(m.quoted.text).slice(0, 200)}"]\n` : '';
  const messages = [
    { role: 'system', content: ownerSystemPrompt(config) },
    ...history,
    { role: 'user', content: `${quoteText}${prompt}` },
  ];
  const answer = await callAI(config, messages, { model: config.ai.ownerModel || undefined });
  mem.push(m.sender, 'user', prompt, config.ai.ownerHistory);
  mem.push(m.sender, 'assistant', answer, config.ai.ownerHistory);
  mem.flush();
  return answer;
}

/** Promise jawaban AI jalur chat biasa (history per chat, riwayat pendek). */
async function chatAnswer(m, { chatData, db, config }, prompt) {
  const history = Array.isArray(chatData.aiHistory) ? chatData.aiHistory : [];
  const messages = [
    { role: 'system', content: `Kamu asisten WhatsApp yang ramah, menjawab singkat dan jelas dalam bahasa Indonesia. Nama bot: ${config.bot.name}.` },
    ...history.slice(-MAX_HISTORY),
    { role: 'user', content: prompt },
  ];
  const answer = await callAI(config, messages);
  chatData.aiHistory = [...messages.filter((item) => item.role !== 'system'), { role: 'assistant', content: answer }].slice(-MAX_HISTORY);
  db.touch();
  return answer;
}

const handler = async (m, { text, command, config, chatData, db, usedPrefix, isOwner, isMods }) => {
  // Saklar fitur balasan AI otomatis (global). Owner & moderator saja.
  if (/^(aireply|aichat)$/i.test(command)) {
    if (isOwner !== true && isMods !== true) throw userError('Khusus owner & moderator.');
    const choice = String(text || '').trim().toLowerCase();
    const aktif = db.data.settings?.aiReply !== false && config.ai.ownerEnabled !== false;
    if (!['on', 'off'].includes(choice)) {
      return m.reply(
        [
          `🤖 Balasan AI otomatis: *${aktif ? 'AKTIF' : 'MATI'}*`,
          '',
          `Ubah: ${usedPrefix}aireply on|off`,
          `Catatan: perintah manual \`${usedPrefix}ai <pertanyaan>\` tetap jalan walau saklar mati.`,
        ].join('\n'),
      );
    }
    if (!db.data.settings) db.data.settings = {};
    db.data.settings.aiReply = choice === 'on';
    db.touch();
    return m.reply(
      choice === 'on'
        ? '✅ Balasan AI otomatis dinyalakan.'
        : `⛔ Balasan AI otomatis dimatikan. Perintah manual \`${usedPrefix}ai\` tetap bisa dipakai.`,
    );
  }

  if (/^(resetai|aireset)$/i.test(command)) {
    chatData.aiHistory = [];
    db.touch();
    return m.reply('🧹 Riwayat AI untuk chat ini dihapus.');
  }

  if (/^(resetownai|owneraireset)$/i.test(command)) {
    if (isOwner !== true) throw userError('Khusus owner.');
    getOwnerMemory(config).clear(m.sender);
    getOwnerMemory(config).flush();
    return m.reply('🧹 Memori khusus AI owner dihapus.');
  }

  if (!config.ai.key) {
    return m.reply(
      [
        '❌ *Fitur AI belum aktif.*',
        '',
        'Isi di file .env:',
        '```',
        `AI_BASE=${config.ai.base}`,
        'AI_KEY=sk-xxxxxxxx',
        `AI_MODEL=${config.ai.model}`,
        '```',
        'AI_BASE boleh provider apa pun yang kompatibel OpenAI (Groq, OpenRouter, Ollama, dll).',
      ].join('\n'),
    );
  }

  const prompt = text?.trim();
  if (!prompt) return m.reply(`Contoh: ${usedPrefix}ai jelaskan apa itu bot WhatsApp`);

  // Owner memakai persona waifu + memori terpisah.
  if (isOwner === true && config.ai.ownerEnabled !== false) {
    const answer = await ownerAnswer(m, config, prompt);
    return m.reply(answer);
  }

  const answer = await chatAnswer(m, { chatData, db, config }, prompt);
  return m.reply(answer);
};

/**
 * Hook: owner berbicara dengan bot -> langsung dijawab AI berpersona waifu.
 * Terdiri dari: DM (chat pribadi), REPLY pesan bot itu sendiri, atau
 * tag/mention bot. Balasan ke pesan ORANG LAIN (termasuk pesan owner sendiri)
 * tidak dianggap bicara dengan bot — dulu semua `m.quoted` ikut dijawab.
 * Deteksi reply memakai `isQuotedFromBot()` yang mengenali bot lewat nomor
 * telepon maupun LID. Berjalan DM & grup, bypass gating rent.
 */
handler.all = async (m, { conn, config, db, isOwner } = {}) => {
  if (isOwner !== true) return;
  if (config?.ai?.ownerEnabled === false) return;
  // Saklar global dari owner/moderator (`.aireply off`).
  if (db?.data?.settings?.aiReply === false) return;
  if (m.fromMe || !m.text) return;

  // Saat game tebak kartu berjalan, pesan yang DIARAHKAN ke soal game (balas
  // pesan soal / tag bot) jangan dijawab AI — hook game yang menanganinya (atau
  // memang bukan jawaban). Pakai aturan YgoQuiz.isDirected yang SAMA dengan
  // hook game, bukan sekadar "ada m.quoted", supaya balasan owner ke pesan bot
  // NON-game tetap dijawab AI selama game aktif.
  try {
    if (getQuiz()?.isDirected?.(m, conn)) return;
  } catch {
    /* abaikan, lanjut ke jalur normal */
  }

  const botJid = conn?.user?.id ? cleanJid(conn.user.id) : '';
  const taggedBot = Boolean(botJid && (m.mentionedJid || []).some((jid) => cleanJid(jid) === botJid));
  const directed = m.isGroup === false || isQuotedFromBot(m, conn) || taggedBot;
  if (!directed) return;

  if (!config?.ai?.key) {
    try {
      await m.reply('Hmph. Aku belum bisa berbicara — pemilikku belum mengisi AI_KEY di .env.');
    } catch {
      /* ignore */
    }
    return;
  }

  const prompt = String(m.text).trim();
  if (!prompt) return;

  const answer = await ownerAnswer(m, config, prompt).catch((err) => {
    const msg = err?.message || String(err || 'Terjadi kesalahan.');
    return `Hmph. ${msg}`;
  });
  try {
    await m.reply(answer);
  } catch {
    /* balasan boleh gagal */
  }
};

handler.help = ['ai', 'chatgpt', 'resetai', 'resetownai', 'aireply'];
handler.tags = ['ai'];
handler.command = /^(ai|chatgpt|ask|resetai|aireset|resetownai|owneraireset|aireply|aichat)$/i;
handler.limit = true;

export default handler;