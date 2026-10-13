/**
 * Chat AI (OpenAI-compatible) — opsional, butuh AI_KEY di .env.
 *   .ai pertanyaan kamu
 *   .resetai   -> hapus riwayat percakapan
 *
 * Contoh provider: OpenAI, Groq, Together, OpenRouter, Ollama (AI_BASE=http://localhost:11434/v1).
 */
import { userError } from '../lib/errors.js';
const MAX_HISTORY = 12;

const handler = async (m, { text, command, config, chatData, db, usedPrefix }) => {
  if (/^(resetai|aireset)$/i.test(command)) {
    chatData.aiHistory = [];
    db.touch();
    return m.reply('🧹 Riwayat AI untuk chat ini dihapus.');
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

  const history = Array.isArray(chatData.aiHistory) ? chatData.aiHistory : [];
  const messages = [
    { role: 'system', content: `Kamu asisten WhatsApp yang ramah, menjawab singkat dan jelas dalam bahasa Indonesia. Nama bot: ${config.bot.name}.` },
    ...history.slice(-MAX_HISTORY),
    { role: 'user', content: prompt },
  ];

  let response;
    try {
      response = await fetch(`${config.ai.base.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.ai.key}`,
        },
        body: JSON.stringify({ model: config.ai.model, messages, temperature: 0.7 }),
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
          msg = `🤖 Model *${config.ai.model}* tidak ditemukan di provider ini. Cek nama model di .env.`;
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

    chatData.aiHistory = [...messages.filter((item) => item.role !== 'system'), { role: 'assistant', content: answer }].slice(-MAX_HISTORY);
    db.touch();

    return m.reply(answer);
  };

handler.help = ['ai', 'chatgpt', 'resetai'];
handler.tags = ['ai'];
handler.command = /^(ai|chatgpt|ask|resetai|aireset)$/i;
handler.limit = true;

export default handler;
