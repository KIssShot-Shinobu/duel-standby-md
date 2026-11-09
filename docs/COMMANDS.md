# Daftar Command

> Dibuat otomatis oleh `npm run commands -- --markdown` — 69 plugin, 196 command.
> Prefix default: `.` (lihat `PREFIX` di `.env`).

## ai

| Command | Keterangan syarat | File |
|---|---|---|
| `.ai`, `.chatgpt`, `.resetai`, `.resetownai`, `.aireply` | 1 limit | `ai-chat.js` |

## anime

| Command | Keterangan syarat | File |
|---|---|---|
| `.anime`, `.animeinfo`, `.eps`, `.themes`, `.streaming`, `.recs`, `.reviews`, `.chars`, `.staff`, `.relations` | 1 limit | `jikan-anime.js` |
| `.char`, `.charinfo`, `.charanime`, `.charva`, `.va`, `.vainfo`, `.vaanime` | 1 limit | `jikan-char.js` |
| `.manga`, `.mangainfo`, `.mangachars`, `.mangarecs`, `.mangareviews` | 1 limit | `jikan-manga.js` |
| `.seasonal`, `.jadwal`, `.topmal`, `.random`, `.maluser`, `.animelist`, `.mangalist`, `.malfav`, `.malstats` | 1 limit | `jikan.js` |

## downloader

| Command | Keterangan syarat | File |
|---|---|---|
| `.fb`, `.facebook`, `.fbdl` | 1 limit | `downloader-facebook.js` |
| `.tiktok`, `.tt` | 1 limit | `downloader-tiktok.js` |
| `.x`, `.twitter`, `.tw` | 1 limit | `downloader-twitter.js` |
| `.ytmp3`, `.yta` | 1 limit | `downloader-ytmp3.js` |
| `.ytmp4`, `.ytv` | 1 limit | `downloader-ytmp4.js` |
| `.yts`, `.ytsearch` | 1 limit | `downloader-ytsearch.js` |

## fun

| Command | Keterangan syarat | File |
|---|---|---|
| `.animequote`, `.aquote`, `.quoteanime` | 1 limit | `anime-quote.js` |
| `.quote`, `.quotes` | — | `fun-quote.js` |

## game

| Command | Keterangan syarat | File |
|---|---|---|
| `.archetype`, `.archetypes` | 1 limit | `game-yugioh-archetype.js` |
| `.art`, `.artwork`, `.artall` | 1 limit | `game-yugioh-art-select.js` |
| `.card` | 1 limit | `game-yugioh-art.js` |
| `.banlist` | 1 limit | `game-yugioh-banlist.js` |
| `.effect`, `.ef`, `.e` | 1 limit | `game-yugioh-effect.js` |
| `.tebakygo`, `.nyerah`, `.stoptebak`, `.yugoscore` | — | `game-yugioh-guess.js` |
| `.tebakgambar`, `.hint` | — | `game-yugioh-image.js` |
| `.ygorandom`, `.randomcard` | 1 limit | `game-yugioh-random.js` |
| `.ygosearch`, `.ygofind` | 1 limit | `game-yugioh-search.js` |
| `.cardset`, `.setcode`, `.cardsets` | 1 limit | `game-yugioh-set.js` |
| `.ygo`, `.yugioh`, `.kartu` | 1 limit | `game-yugioh.js` |

## group

| Command | Keterangan syarat | File |
|---|---|---|
| `.add` | admin grup, bot harus admin, hanya grup | `group-add.js` |
| `.bot` | admin grup, hanya grup | `group-bot.js` |
| `.antilink`, `.antispam`, `.welcome`, `.detect` | admin grup, hanya grup | `group-config.js` |
| `.gkick`, `.groupkick`, `.keluarkan` | admin grup, bot harus admin, hanya grup | `group-kick.js` |
| `.link` | admin grup, bot harus admin, hanya grup | `group-link.js` |
| `.open`, `.close` | admin grup, bot harus admin, hanya grup | `group-open.js` |
| `.promote`, `.demote` | admin grup, bot harus admin, hanya grup | `group-promote.js` |
| `.setname` | admin grup, bot harus admin, hanya grup | `group-setname.js` |
| `.tagall`, `.hidetag` | admin grup, hanya grup | `group-tagall.js` |

## image

| Command | Keterangan syarat | File |
|---|---|---|
| `.sfw`, `.sfwlist` | 1 limit | `sfw-image.js` |

## info

| Command | Keterangan syarat | File |
|---|---|---|
| `.credit`, `.tqto` | — | `info-tqto.js` |

## islami

| Command | Keterangan syarat | File |
|---|---|---|
| `.sholat` | — | `sholat.js` |

## main

| Command | Keterangan syarat | File |
|---|---|---|
| `.info`, `.profile`, `.profil`, `.daftar` | — | `main-info.js` |
| `.menu`, `.help`, `.bantuan` | — | `main-menu.js` |
| `.ping`, `.speed` | — | `main-ping.js` |
| `.rent`, `.sewa`, `.rentstatus`, `.renew`, `.grouplist` | — | `rent.js` |

## nsfw

| Command | Keterangan syarat | File |
|---|---|---|
| `.nsfw`, `.nsfwstatus`, `.nsfwlist` | 1 limit | `nsfw-image.js` |

## owner

| Command | Keterangan syarat | File |
|---|---|---|
| `.ban`, `.unban` | — | `owner-ban.js` |
| `.broadcast` | owner | `owner-broadcast.js` |
| `.limitset`, `.limitcmd`, `.limitcat` | owner | `owner-limit.js` |
| `.menuset`, `.category`, `.cmdset` | owner | `owner-menu.js` |
| `.mod` | owner | `owner-mod.js` |
| `.mode` | owner | `owner-mode.js` |
| `.restart` | owner | `owner-restart.js` |
| `.premium`, `.limit`, `.resetlimit` | owner | `owner-user.js` |

## reaction

| Command | Keterangan syarat | File |
|---|---|---|
| `.kick`, `.hug`, `.kiss`, `.slap`, `.pat`, `.cuddle`, `.poke`, `.tickle`, `.highfive`, `.bite`, `.bonk`, `.feed`, `.wave`, `.blush`, `.smile`, `.wink`, `.stare`, `.facepalm`, `.yeet`, `.carry`, `.tendang`, `.peluk`, `.cium`, `.tampar`, `.sayang`, `.peluk2`, `.colok`, `.gelitik`, `.high5`, `.gigit`, `.lempar`, `.angkat`, `.reactionlist` | 1 limit | `reaction-gif.js` |

## rpg

| Command | Keterangan syarat | File |
|---|---|---|
| `.bank`, `.nabung`, `.tarik` | — | `rpg-bank.js` |
| `.daily` | — | `rpg-daily.js` |
| `.leaderboard`, `.top` | — | `rpg-leaderboard.js` |

## tools

| Command | Keterangan syarat | File |
|---|---|---|
| `.buylimit`, `.limitbeli` | — | `buy-limit.js` |
| `.smeme`, `.stikermeme` | 1 limit | `sticker-smeme.js` |
| `.calc`, `.kalkulator` | — | `tools-calc.js` |
| `.qr`, `.qrcode` | — | `tools-qr.js` |
| `.togif`, `.tomp4`, `.topng`, `.tojpg` | 1 limit | `tools-sticker-convert.js` |
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
| _(event otomatis)_ | — | `_dm-intro.js` |
| _(event otomatis)_ | — | `_reaction-loader.js` |
| _(event otomatis)_ | — | `_rent-guard.js` |
| _(event otomatis)_ | — | `_welcome.js` |

