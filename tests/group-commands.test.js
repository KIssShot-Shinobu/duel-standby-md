import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Regresi: `plugins/group-kick.js` pernah memakai `friendlyNumber()` tanpa
 * mengimpornya -> ReferenceError setiap kali `.kick` dijalankan (pesan yang
 * keluar jadi "Ups, ada yang error di server").
 */
function makeCtx() {
  const replies = [];
  const calls = [];
  const conn = {
    user: { id: '628999999999@s.whatsapp.net' },
    groupParticipantsUpdate: async (chat, jids, action) => {
      calls.push({ chat, jids, action });
      return [{ status: '200' }];
    },
  };
  const m = {
    chat: '123@g.us',
    sender: '628111111111@s.whatsapp.net',
    fromMe: false,
    pushName: 'Admin',
    reply: async (text) => {
      replies.push(String(text));
      return { key: { id: 'R' } };
    },
  };
  const config = { bot: { prefix: ['.'] }, messages: {} };
  return { conn, m, config, replies, calls };
}

test('plugin .kick jalan dan membalas hasilnya (tanpa ReferenceError)', async () => {
  const { default: kick } = await import('../plugins/group-kick.js');
  const { conn, m, config, replies, calls } = makeCtx();

  await kick(m, { conn, args: ['628222333444'], config, groupMetadata: { participants: [] } });

  assert.equal(replies.length, 1, 'tidak ada balasan');
  assert.match(replies[0], /08222333444/, 'nomor harus ditampilkan ramah (08xx)');
  assert.match(replies[0], /dikeluarkan/i);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'remove');
});

test('plugin .kick melewati admin grup dan tetap membalas', async () => {
  const { default: kick } = await import('../plugins/group-kick.js');
  const { conn, m, config, replies, calls } = makeCtx();

  await kick(m, {
    conn,
    args: ['628222333444'],
    config,
    groupMetadata: { participants: [{ id: '628222333444@s.whatsapp.net', admin: 'admin' }] },
  });

  assert.match(replies[0], /admin/i);
  assert.equal(calls.length, 0, 'admin tidak boleh dikeluarkan');
});

test('plugin .gkick tanpa target memberi contoh pemakaian', async () => {
  const { default: kick } = await import('../plugins/group-kick.js');
  const { conn, m, config, replies } = makeCtx();

  await kick(m, { conn, args: [], config, groupMetadata: { participants: [] } });

  assert.match(replies[0], /Contoh: \.gkick/);
  assert.doesNotMatch(replies[0], /\*\*/);
});

test('plugin .promote/.demote dan .add membalas dengan gaya yang konsisten', async () => {
  const { default: promote } = await import('../plugins/group-promote.js');
  const { default: add } = await import('../plugins/group-add.js');

  const promoteCtx = makeCtx();
  await promote(promoteCtx.m, { ...promoteCtx, args: ['628222333444'], command: 'promote' });
  assert.match(promoteCtx.replies[0], /diangkat jadi admin/i);
  assert.equal(promoteCtx.calls[0].action, 'promote');
  assert.doesNotMatch(promoteCtx.replies[0], /\*\*/);

  const addCtx = makeCtx();
  await add(addCtx.m, { ...addCtx, args: ['628222333444'] });
  assert.match(addCtx.replies[0], /Tambah anggota selesai/i);
  assert.equal(addCtx.calls[0].action, 'add');
});
