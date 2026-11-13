# AGENTS.md — duel-standby-md

WhatsApp Multi-Device bot (Baileys) clean-room dengan arsitektur plugin gaya RTXZY-MD.

## Tech Stack

- Node.js >= 20.11, ESM (`"type": "module"`), MIT license.
- Baileys (WhatsApp Multi-Device), tanpa API key untuk fitur inti, deps sengaja minim.
- v1.3.0 — lihat `package.json` / `README.md` sebagai sumber kebenaran.

## Perintah

| Perintah | Fungsi |
| --- | --- |
| `npm start` | Jalankan bot (`node index.js`) |
| `npm run dev` | Mode development (`node --watch main.js`) |
| `npm run smoke` | Boot tanpa WhatsApp + cek plugin & tool |
| `npm run check` | Syntax check semua file `.js` |
| `npm test` | Jalankan test (`node --test`) |
| `npm run commands` / `commands:md` | Daftar command |
| `npm run check:sticker\|check:ytdlp\|check:ygo\|check:quiz\|check:nsfw\|check:image` | Cek tool eksternal / API |

## Struktur

```
index.js      supervisor + health server
main.js       koneksi Baileys + plugin loader
handler.js    dispatcher pesan: before hook → gating → plugin
config.js     konfigurasi: CLI > .env > default
lib/          api, argv, connection, database, env, functions, health,
              logger, media, permissions, plugins, print, serialize, simple
plugins/      35+ plugin, auto-load + hot reload
tests/        node:test
scripts/      check-syntax, list-commands, cek tool eksternal/API
database/     penyimpanan JSON atomik (data user runtime)
sessions/     kredensial WhatsApp — JANGAN disentuh
tmp/          file sementara (autoclear)
```

## Konvensi Plugin

- File: `plugins/<kategori>-<nama>.js`. Default-export `handler` async `(m, ctx)`.
- Wajib: `handler.help` (array), `handler.tags` (kategori string), `handler.command` (RegExp | string | string[]).
- Flag opsional: `handler.limit` (true|false|angka), `handler.owner`, `handler.admin`, `handler.botAdmin`, `handler.group`, `handler.private`, `handler.register`, `handler.premium`, `handler.prefix = false`.
- Hook opsional: `handler.before`, `handler.all`, `handler.onGroupParticipants`, `handler.onGroupsUpdate`, `handler.onCall`.
- Error ramah user: `throw userError('pesan')` dari `../lib/errors.js` atau `throw 'string'`. JANGAN `throw new Error()` untuk pesan user — dianggap error teknis dan disamarkan.
- Context `ctx`: `conn, args, text, usedPrefix, command, user, db, config, plugins, isOwner, isMods, isAdmin, isBotAdmin, isPremium, participants, groupMetadata, wait(), Api, Func, runtime`.
- Objek `m`: `m.chat, m.sender, m.isGroup, m.text, m.mtype, m.msg, m.mentionedJid, m.quoted (dengan .download()), m.reply(), m.react(), m.delete(), m.read(), m.download()`.
- Plugin di-hot-reload saat file berubah — tidak perlu restart bot.

Contoh plugin minimal:

```js
const handler = async (m, { conn, text, args, usedPrefix, command, config, db, user }) => {
  if (!text) return m.reply(`Contoh: ${usedPrefix}${command} NamaKamu`);
  return m.reply(`Halo ${text}! Level kamu ${user.level}.`);
};
handler.help = ['hello'];
handler.tags = ['tools'];
handler.command = /^(hello|halo)$/i;
handler.limit = true;
export default handler;
```

## Boundaries

- JANGAN PERNAH commit atau ubah `sessions/` (kredensial penuh akun WhatsApp), `database/` (data user runtime), `.env` (rahasia). `.gitignore` sudah mengatur; jangan lemahkan.
- Jangan tambah dependensi baru tanpa pertimbangan matang — proyek sengaja minim deps.
- Jangan obfuscate; kode harus tetap 100% terbaca (prinsip clean-room).
- Error teknis tidak boleh bocor detail ke user (disamarkan `config.messages.error`; detail hanya dengan `--debug`).
- File media sementara hanya di `tmp/` (ada autoclear).

## Verify Before Act

Sebelum perubahan dianggap selesai:

1. `npm run check` — semua file `.js` lolos syntax check.
2. `npm test` — semua test hijau.
3. Plugin baru: pastikan tidak ada command dobel (loader mendeteksi) dan plugin muncul di `npm run commands`.
