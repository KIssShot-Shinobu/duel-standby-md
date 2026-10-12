/**
 * Chat AI (OpenAI-compatible) — opsional, butuh AI_KEY di .env.
 *   .ai pertanyaan kamu
 *   .resetai   -> hapus riwayat percakapan
 *
 * Contoh provider: OpenAI, Groq, Together, OpenRouter, Ollama (AI_BASE=http://localhost:11434/v1).
 */
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

  const response = await fetch(`${config.ai.base.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.ai.key}`,
    },
    body: JSON.stringify({ model: config.ai.model, messages, temperature: 0.7 }),
    signal: AbortSignal.timeout(90000),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`AI ${response.status}: ${detail.slice(0, 200)}`);
  }

  const json = await response.json();
  const answer = json?.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error('Respons AI kosong.');

  chatData.aiHistory = [...messages.filter((item) => item.role !== 'system'), { role: 'assistant', content: answer }].slice(-MAX_HISTORY);
  db.touch();

  return m.reply(answer);
};

handler.help = ['ai', 'chatgpt', 'resetai'];
handler.tags = ['ai'];
handler.command = /^(ai|chatgpt|ask|resetai|aireset)$/i;
handler.limit = true;

export default handler;
