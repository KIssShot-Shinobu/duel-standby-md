/**
 * Dispatcher pesan: serialisasi -> hook before -> cek permission -> jalankan plugin.
 *
 * Alur (mirip handler.js RTXZY-MD, tapi bisa dibaca):
 *   1. smsg()  : ubah WAMessage menjadi objek `m`
 *   2. before  : hook `handler.before` dijalankan berurutan (false = stop)
 *   3. gating  : mode bot, self/public, pcOnly/gcOnly, banned, mute, limit
 *   4. command : cocokkan prefix + nama command ke plugin, lalu jalankan
 *   5. all     : hook `handler.all` dijalankan untuk pesan tanpa command
 */
import { smsg, hasMeaningfulContent } from './lib/serialize.js';
import * as Perm from './lib/permissions.js';
import { Func, cleanJid, bareNumber } from './lib/functions.js';
import { errorLog, errorText, isFriendlyError } from './lib/errors.js';
import { isAdultCategory, pluginEnabled } from './lib/menu-config.js';
import { resolveLimit } from './lib/limit-config.js';
import print from './lib/print.js';

/** Pisahkan prefix, nama command dan argumen dari teks pesan. */
export function parseCommand(text = '', prefixes = ['.']) {
  const value = String(text || '');
  if (!value) return null;
  if (!prefixes.length) return null;
  const first = value[0];
  if (!prefixes.includes(first)) return null;
  const body = value.slice(1).trim();
  if (!body) return null;
  const parts = body.split(/\s+/);
  const command = parts.shift().toLowerCase();
  if (!command) return null;
  return { usedPrefix: first, command, text: parts.join(' '), args: parts };
}

/** Cari plugin untuk sebuah command (literal atau regex). */
export function matchPlugin(plugins, command) {
  return plugins?.find?.(command) || null;
}

function buildContext({ conn, m, db, config, plugins, groupCache, api, parsed, flags }) {
  const user = db.user(m.sender);
  const chat = db.chat(m.chat);
  const common = {
    conn,
    m,
    db,
    config,
    plugins,
    groupCache,
    Api: api,
    Func,
    runtime: globalThis.runtime || null,
    command: parsed?.command,
    args: parsed?.args || [],
    text: parsed?.text || '',
    usedPrefix: parsed?.usedPrefix || '',
    prefix: parsed?.usedPrefix || config.bot.prefix[0],
    sender: m.sender,
    chatId: m.chat,
    pushname: m.pushName,
    user,
    chatData: chat,
    isOwner: flags.isOwner,
    isMods: flags.isMods,
    isAdmin: flags.isAdmin,
    isBotAdmin: flags.isBotAdmin,
    isPremium: flags.isPremium,
    isPrems: flags.isPremium,
    isBanned: flags.isBanned,
    isRooftop: flags.isOwner,
    participants: flags.participants,
    groupMetadata: flags.groupMetadata,
    getName: (jid) => conn.getName?.(jid),
  };

  common.wait = async () => {
    const sent = await m.reply(config.messages.wait);
    return async (text) => {
      try {
        await conn.sendMessage(m.chat, { text: String(text), edit: sent.key });
      } catch {
        await m.reply(text);
      }
    };
  };

  return common;
}

/**
 * Handle satu pesan masuk.
 * @param {any} conn socket Baileys
 * @param {any} raw WAMessage
 * @param {{plugins: any, db: any, config: any, groupCache?: any, api?: any, logger?: any, upsertType?: string}} deps
 */
export async function handleMessage(conn, raw, deps) {
  const { plugins, db, config, groupCache, api, logger = console, upsertType = 'notify' } = deps;
  if (!raw?.message) return { handled: false, reason: 'empty' };

  const chatJid = cleanJid(raw.key?.remoteJid || '');
  if (!chatJid || chatJid === 'status@broadcast' || chatJid.endsWith('@newsletter')) return { handled: false, reason: 'skipped-chat' };

  const m = smsg(conn, raw);
  if (!m) return { handled: false, reason: 'unserializable' };

  // WhatsApp kadang mengirim protocolMessage / senderKeyDistributionMessage
  // tanpa teks apa pun — jangan diproses sebagai pesan user.
  if (!hasMeaningfulContent(raw.message)) return { handled: false, reason: 'no-content' };

  // Selesaikan identitas LID -> nomor telepon supaya permission konsisten.
  if (m.senderLid && m.senderPn) db.mapLid(m.senderLid, m.senderPn);
  if (String(m.sender).endsWith('@lid')) {
    const resolved = db.resolveLid(m.sender);
    if (resolved !== m.sender) {
      m.senderLid = m.senderLid || m.sender;
      m.sender = resolved;
    }
  }
  m.mentionedJid = [...new Set((m.mentionedJid || []).map((jid) => db.resolveLid(jid)))];

  db.data.stats.messages = (db.data.stats.messages || 0) + 1;
  const chat = db.chat(m.chat);
  chat.commandCount = chat.commandCount || 0;

  // Mode nyimak: hanya log.
  if (config.flags.nyimak) {
    print.printMessage({ ...m, timeZone: config.bot.timezone });
    return { handled: false, reason: 'nyimak' };
  }

  if (config.flags.autoread) m.read().catch(() => {});

  const isGroup = m.isGroup;
  let groupMetadata = null;
  let participants = [];
  if (isGroup && groupCache && conn.groupMetadata) {
    groupMetadata = await groupCache.get(conn, m.chat).catch(() => null);
    participants = groupMetadata?.participants || [];
  }

  const isOwner = Perm.isOwner(m.sender, config);
  const isMods = Perm.isMods(m.sender, config);
  const isAdmin = participants.length ? Perm.isParticipantAdmin(groupMetadata, m.sender) : false;
  const isBotAdmin = participants.length ? Perm.isParticipantAdmin(groupMetadata, conn.user?.id) : false;
  const user = db.user(m.sender);
  const isPremium = Perm.isPremiumUser(user, m.sender, config);

  const flags = { isOwner, isMods, isAdmin, isBotAdmin, isPremium, isBanned: Perm.isBanned(user), participants, groupMetadata };

  const parsed = parseCommand(m.text, config.bot.prefix);

  const ctx = buildContext({ conn, m, db, config, plugins, groupCache, api, parsed, flags });

  // 1) Hook before
  for (const entry of plugins.hooks.before) {
    try {
      const result = await entry.plugin.before(m, ctx);
      if (result === false) return { handled: false, reason: `before:${entry.name}` };
    } catch (err) {
      db.data.stats.errors = (db.data.stats.errors || 0) + 1;
      logger.error?.(`[handler] before ${entry.name}: ${errorLog(err)}`);
    }
  }

  print.printMessage({ ...m, timeZone: config.bot.timezone });
  db.touch();

  // 1b) Hadiah tiap pesan: XP & saldo acak (config.rewards.chat)
  //     Tidak ada pesan apa pun ke user — hanya dicatat di terminal.
  const rewardEnabled = !m.fromMe && !ctx.user.banned && !(chat.mute && !isOwner && !isAdmin);
  const reward = rewardEnabled ? Perm.rewardChatMessage(db, m.sender, config) : null;
  if (reward) {
    m.exp = reward.exp;
    m.saldo = reward.saldo;
    if (config.rewards?.chat?.log !== false) {
      logger.info?.(
        `[reward] ${bareNumber(m.sender)} +${reward.exp} xp +${reward.saldo} saldo | total ${reward.totalExp} xp, ${reward.totalSaldo} saldo, level ${reward.level}${reward.levelUp ? ' (NAIK LEVEL)' : ''}`,
      );
    }
    if (reward.levelUp && config.rewards?.chat?.levelUpNotice) {
      await m
        .reply(`🎉 *${m.pushName || m.sender.split('@')[0]}* naik ke *level ${reward.level}*`, m.chat, { mentions: [m.sender] })
        .catch(() => {});
    }
  }

  // 2) Cari plugin
  let entry = parsed ? matchPlugin(plugins, parsed.command) : null;

  // Dukungan command tanpa prefix (handler.prefix === false)
  if (!entry && !parsed && m.text) {
    const first = m.text.trim().split(/\s+/)[0]?.toLowerCase();
    const candidate = first ? matchPlugin(plugins, first) : null;
    if (candidate && candidate.plugin.prefix === false) {
      entry = candidate;
      ctx.command = first;
      ctx.args = m.text.trim().split(/\s+/).slice(1);
      ctx.text = ctx.args.join(' ');
      ctx.usedPrefix = '';
    }
  }

  // 3) Kalau tidak ada command -> jalankan hook `all`
  if (!entry) {
    for (const hook of plugins.hooks.all) {
      try {
        await hook.plugin.all(m, ctx);
      } catch (err) {
        db.data.stats.errors = (db.data.stats.errors || 0) + 1;
        logger.error?.(`[handler] all ${hook.name}: ${errorLog(err)}`);
      }
    }
    return { handled: false, reason: 'no-plugin', reward };
  }

  // 4) Gating
  if (config.bot.mode === 'self' && !isOwner && !isMods) return { handled: false, reason: 'self-mode', reward };
  if (config.flags.pcOnly && isGroup) return { handled: false, reason: 'pconly', reward };
  if (config.flags.gcOnly && !isGroup) return { handled: false, reason: 'gconly', reward };

  // Menu config: command/kategori yang dimatikan owner tidak boleh dijalankan.
  if (!pluginEnabled(db, entry)) {
    // Kategori dewasa (nsfw) yang masih tertutup diabaikan diam-diam.
    if (isAdultCategory(entry.category)) return { handled: false, reason: 'adult-disabled', reward };
    await m.reply(config.messages.disabled || '_*Fitur ini sedang dimatikan oleh owner.*_').catch(() => {});
    return { handled: false, reason: 'disabled', reward };
  }

  if (ctx.user.banned) {
    await m.reply(config.messages.banned).catch(() => {});
    return { handled: false, reason: 'banned', reward };
  }
  if (chat.mute && !isOwner && !isAdmin) return { handled: false, reason: 'muted', reward };
  if (chat.expired && Date.now() > chat.expired && !isOwner) return { handled: false, reason: 'expired-chat', reward };

  const plugin = entry.plugin;
  if (plugin.owner && !isOwner) {
    await m.reply(config.messages.owner).catch(() => {});
    return { handled: false, reason: 'need-owner' };
  }
  if (plugin.premium && !isPremium) {
    await m.reply(config.messages.premium).catch(() => {});
    return { handled: false, reason: 'need-premium' };
  }
  if (plugin.admin && !isAdmin) {
    await m.reply(config.messages.admin).catch(() => {});
    return { handled: false, reason: 'need-admin' };
  }
  if (plugin.botAdmin && isGroup && !isBotAdmin) {
    await m.reply(config.messages.botAdmin).catch(() => {});
    return { handled: false, reason: 'need-bot-admin' };
  }
  if (plugin.group && !isGroup) {
    await m.reply(config.messages.group).catch(() => {});
    return { handled: false, reason: 'need-group' };
  }
  if (plugin.private && isGroup) {
    await m.reply(config.messages.private).catch(() => {});
    return { handled: false, reason: 'need-private' };
  }
  if (plugin.register && !ctx.user.registered) {
    await m.reply(config.messages.register).catch(() => {});
    return { handled: false, reason: 'need-register' };
  }

  // Biaya limit: pengaturan owner (command/kategori) > bawaan plugin.
  const limitInfo = resolveLimit(db, entry);
  ctx.limitCost = limitInfo.cost;
  ctx.limitMode = limitInfo.mode;

  const limit = Perm.consumeLimitCost(db, user, limitInfo.cost, config);
  if (!limit.ok) {
    await m.reply(config.messages.limit).catch(() => {});
    return { handled: false, reason: 'no-limit', reward };
  }

  // 5) Jalankan
  print.printCommand({ command: ctx.command, sender: m.sender, chat: m.chat, isGroup, timeZone: config.bot.timezone });
  chat.commandCount += 1;
  user.totalCommands = (user.totalCommands || 0) + 1;
  db.data.stats.commands = (db.data.stats.commands || 0) + 1;
  db.touch();

  try {
    const started = Date.now();
    await plugin.call(plugin, m, ctx);
    // EXP sudah diberikan tiap pesan (lihat rewardChatMessage), jadi tidak ada bonus terpisah.
    logger.debug?.(`[handler] ${entry.name} selesai dalam ${Date.now() - started} ms`);
    return { handled: true, plugin: entry.name, command: ctx.command, limit: limit.cost, upsertType, reward };
  } catch (err) {
    db.data.stats.errors = (db.data.stats.errors || 0) + 1;
    db.touch();
    logger.error?.(`[handler] ${entry.name}: ${errorLog(err)}`);

    if (isFriendlyError(err)) {
      // Plugin melempar pesan ramah (string / userError) -> teruskan ke pengguna.
      await m.reply(errorText(err)).catch(() => {});
      return { handled: false, plugin: entry.name, reason: 'user-error' };
    }

    const detail = config.flags.debug ? `\n\n\`\`\`${errorText(err)}\`\`\`` : '';
    await m.reply(`${config.messages.error}${detail}`).catch(() => {});
    return { handled: false, plugin: entry.name, error: errorText(err) };
  }
}

/** Dispatch update peserta grup ke plugin hook `onGroupParticipants`. */
export async function dispatchGroupParticipants(conn, update, deps) {
  const { plugins, db, config, logger = console } = deps;
  if (!update?.id) return;
  const chat = db.chat(update.id);
  let groupMetadata = null;
  try {
    groupMetadata = await conn.groupMetadata(update.id);
  } catch {
    /* ignore */
  }
  const sender = conn.user?.id;
  const ctx = {
    conn,
    db,
    config,
    update,
    chat,
    chatData: chat,
    groupMetadata,
    participants: groupMetadata?.participants || [],
    getName: (jid) => conn.getName?.(jid),
    sender,
  };
  for (const entry of plugins.hooks.onGroupParticipants) {
    try {
      await entry.plugin.onGroupParticipants(conn, update, ctx);
    } catch (err) {
      db.data.stats.errors = (db.data.stats.errors || 0) + 1;
      logger.error?.(`[handler] onGroupParticipants ${entry.name}: ${err.message}`);
    }
  }
}

/** Dispatch perubahan info grup. */
export async function dispatchGroupsUpdate(conn, updates, deps) {
  const { plugins, db, config, logger = console } = deps;
  const ctx = { conn, db, config, updates };
  for (const entry of plugins.hooks.onGroupsUpdate) {
    try {
      await entry.plugin.onGroupsUpdate(conn, updates, ctx);
    } catch (err) {
      logger.error?.(`[handler] onGroupsUpdate ${entry.name}: ${err.message}`);
    }
  }
}

/** Dispatch panggilan masuk. */
export async function dispatchCall(conn, calls, deps) {
  const { plugins, db, config, logger = console } = deps;
  const ctx = { conn, db, config, calls };
  for (const entry of plugins.hooks.onCall) {
    try {
      await entry.plugin.onCall(conn, calls, ctx);
    } catch (err) {
      logger.error?.(`[handler] onCall ${entry.name}: ${err.message}`);
    }
  }
}

export default { handleMessage, parseCommand, matchPlugin, dispatchGroupParticipants, dispatchGroupsUpdate, dispatchCall };
