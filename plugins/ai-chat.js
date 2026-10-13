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

const MAX_HISTORY = 12;

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

const handler = async (m, { text, command, config, chatData, db, usedPrefix, isOwner }) => {
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
 * Hook: owner REPLY pesan bot ATAU TAG/MENTION bot -> langsung dijawab AI
 * (persona waifu). Berjalan di DM & grup, bypass gating rent.
 */
handler.all = async (m, { conn, config, isOwner } = {}) => {
  if (isOwner !== true) return;
  if (config?.ai?.ownerEnabled === false) return;
  if (!config?.ai?.key) return;
  if (m.fromMe || !m.text) return;

  const botJid = conn?.user?.id ? cleanJid(conn.user.id) : '';
  const quotedBot = m.quoted?.fromMe === true;
  const taggedBot = Boolean(botJid && (m.mentionedJid || []).some((jid) => cleanJid(jid) === botJid));
  if (!quotedBot && !taggedBot) return;

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

handler.help = ['ai', 'chatgpt', 'resetai', 'resetownai'];
handler.tags = ['ai'];
handler.command = /^(ai|chatgpt|ask|resetai|aireset|resetownai|owneraireset)$/i;
handler.limit = true;

export default handler;