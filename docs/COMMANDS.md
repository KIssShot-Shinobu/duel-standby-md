# Daftar Command

> Dibuat otomatis oleh `npm run commands -- --markdown` — 43 plugin, 84 command.
> Prefix default: `.` (lihat `PREFIX` di `.env`).

## ai

| Command | Keterangan syarat | File |
|---|---|---|
| `.ai`, `.chatgpt`, `.resetai` | 1 limit | `ai-chat.js` |

## downloader

| Command | Keterangan syarat | File |
|---|---|---|
| `.tiktok`, `.tt` | 1 limit | `downloader-tiktok.js` |
| `.ytmp3`, `.yta` | 1 limit | `downloader-ytmp3.js` |
| `.ytmp4`, `.ytv` | 1 limit | `downloader-ytmp4.js` |
| `.yts`, `.ytsearch` | 1 limit | `downloader-ytsearch.js` |

## fun

| Command | Keterangan syarat | File |
|---|---|---|
| `.quote`, `.quotes` | — | `fun-quote.js` |

## game

| Command | Keterangan syarat | File |
|---|---|---|
| `.archetype`, `.archetypes` | 1 limit | `game-yugioh-archetype.js` |
| `.card` | 1 limit | `game-yugioh-art.js` |
| `.banlist` | 1 limit | `game-yugioh-banlist.js` |
| `.tebakygo`, `.nyerah`, `.stoptebak`, `.yugoscore` | — | `game-yugioh-guess.js` |
| `.ygorandom`, `.randomcard` | 1 limit | `game-yugioh-random.js` |
| `.ygosearch`, `.ygofind` | 1 limit | `game-yugioh-search.js` |
| `.cardset`, `.setcode`, `.cardsets` | 1 limit | `game-yugioh-set.js` |
| `.ygo`, `.yugioh`, `.kartu` | 1 limit | `game-yugioh.js` |

## group

| Command | Keterangan syarat | File |
|---|---|---|
| `.add` | admin grup, bot harus admin, hanya grup | `group-add.js` |
| `.antilink`, `.antispam`, `.welcome`, `.detect` | admin grup, hanya grup | `group-config.js` |
| `.kick` | admin grup, bot harus admin, hanya grup | `group-kick.js` |
| `.link` | admin grup, bot harus admin, hanya grup | `group-link.js` |
| `.open`, `.close` | admin grup, bot harus admin, hanya grup | `group-open.js` |
| `.promote`, `.demote` | admin grup, bot harus admin, hanya grup | `group-promote.js` |
| `.setname` | admin grup, bot harus admin, hanya grup | `group-setname.js` |
| `.tagall`, `.hidetag` | admin grup, hanya grup | `group-tagall.js` |

## info

| Command | Keterangan syarat | File |
|---|---|---|
| `.tqto`, `.credit` | — | `info-tqto.js` |

## main

| Command | Keterangan syarat | File |
|---|---|---|
| `.info`, `.profile`, `.profil`, `.daftar` | — | `main-info.js` |
| `.menu`, `.help`, `.bantuan` | — | `main-menu.js` |
| `.ping`, `.speed` | — | `main-ping.js` |

## owner

| Command | Keterangan syarat | File |
|---|---|---|
| `.broadcast` | owner | `owner-broadcast.js` |
| `.mode` | owner | `owner-mode.js` |
| `.restart` | owner | `owner-restart.js` |
| `.premium`, `.ban`, `.unban`, `.limit`, `.resetlimit` | owner | `owner-user.js` |

## rpg

| Command | Keterangan syarat | File |
|---|---|---|
| `.bank`, `.nabung`, `.tarik` | — | `rpg-bank.js` |
| `.daily` | — | `rpg-daily.js` |
| `.leaderboard`, `.top` | — | `rpg-leaderboard.js` |

## tools

| Command | Keterangan syarat | File |
|---|---|---|
| `.calc`, `.kalkulator` | — | `tools-calc.js` |
| `.qr`, `.qrcode` | — | `tools-qr.js` |
| `.sticker`, `.stiker`, `.s` | 1 limit | `tools-sticker.js` |
| `.toimg`, `.toimage` | 1 limit | `tools-toimg.js` |
| `.tomp3`, `.toaudio` | 1 limit | `tools-tomp3.js` |
| `.tovn`, `.tovoice` | 1 limit | `tools-tovn.js` |

## event

| Command | Keterangan syarat | File |
|---|---|---|
| `.afk` | — | `_afk.js` |
| _(event otomatis)_ | — | `_antilink.js` |
| _(event otomatis)_ | — | `_antispam.js` |
| _(event otomatis)_ | — | `_welcome.js` |

