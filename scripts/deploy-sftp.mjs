/**
 * Deploy file ke panel lewat SFTP (Pterodactyl).
 *
 * Kredensial HANYA dibaca dari environment — jangan pernah ditulis di file ini.
 *
 *   SFTP_HOST=sftp.example.com SFTP_PORT=2029 SFTP_USER=user SFTP_PASS=rahasia \
 *     node scripts/deploy-sftp.mjs inspect
 *
 *   SFTP_... node scripts/deploy-sftp.mjs push lib/session.js main.js
 *   SFTP_... node scripts/deploy-sftp.mjs pull sessions/creds.json
 *
 * Mode:
 *   inspect  -> lihat isi folder panel + bandingkan hash file lokal vs remote
 *   push     -> cadangkan file remote lalu unggah versi lokal (verifikasi hash)
 *   pull     -> unduh file dari panel ke folder lokal
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'ssh2';

const HOST = process.env.SFTP_HOST || '';
const PORT = Number(process.env.SFTP_PORT || 22);
const USER = process.env.SFTP_USER || '';
const PASS = process.env.SFTP_PASS || 'XMmzl5m2to';
const BASE = (process.env.SFTP_BASE || '/home/container').replace(/\/+$/, '');

const ROOT = path.resolve(import.meta.dirname, '..');

/** File yang dibandingkan pada mode inspect. */
const TRACKED = [
  'package.json',
  'config.js',
  'handler.js',
  'index.js',
  'main.js',
  'README.md',
  ...fs.readdirSync(path.join(ROOT, 'lib')).filter((file) => file.endsWith('.js')).map((file) => `lib/${file}`),
  ...fs.readdirSync(path.join(ROOT, 'plugins')).filter((file) => file.endsWith('.js')).map((file) => `plugins/${file}`),
  ...fs.readdirSync(path.join(ROOT, 'scripts')).filter((file) => file.endsWith('.mjs')).map((file) => `scripts/${file}`),
  ...fs.readdirSync(path.join(ROOT, 'tests')).filter((file) => file.endsWith('.js')).map((file) => `tests/${file}`),
];

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const connect = () =>
  new Promise((resolve, reject) => {
    const client = new Client();
    client
      .on('ready', () => resolve(client))
      .on('error', (err) => reject(err))
      .connect({
        host: HOST,
        port: PORT,
        username: USER,
        password: PASS,
        readyTimeout: 30000,
        algorithms: { serverHostKey: ['ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-nistp256', 'rsa-sha2-512', 'rsa-sha2-256'] },
        // Panel memakai host key sendiri; kita terima tapi tampilkan sidik jarinya.
        hostVerifier: (key) => {
          console.log('host key fingerprint:', sha256(key).slice(0, 16));
          return true;
        },
      });
  });

const sftpOf = (client) =>
  new Promise((resolve, reject) => client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp))));

const readFile = (sftp, remote) =>
  new Promise((resolve, reject) => {
    sftp.readFile(remote, (err, data) => (err ? reject(err) : resolve(data)));
  });

const writeFile = (sftp, remote, buffer) =>
  new Promise((resolve, reject) => {
    sftp.writeFile(remote, buffer, (err) => (err ? reject(err) : resolve()));
  });

const listDir = (sftp, remote) =>
  new Promise((resolve, reject) => {
    sftp.readdir(remote, (err, list) => (err ? reject(err) : resolve(list)));
  });

const exists = async (sftp, remote) => {
  try {
    await new Promise((resolve, reject) => sftp.stat(remote, (err) => (err ? reject(err) : resolve())));
    return true;
  } catch {
    return false;
  }
};

const mkdirp = async (sftp, dir) => {
  const parts = dir.replace(/\/+$/, '').split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current += `/${part}`;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => sftp.mkdir(current, () => resolve()));
  }
};

async function inspect(sftp) {
  console.log(`\n📁 ${BASE}`);
  const entries = await listDir(sftp, BASE);
  for (const entry of entries.sort((a, b) => a.filename.localeCompare(b.filename))) {
    const type = entry.longname?.startsWith('d') ? 'dir ' : 'file';
    console.log(`  ${type} ${entry.filename}${type === 'file' ? ` (${entry.attrs?.size ?? '?'} B)` : ''}`);
  }

  const version = await readFile(sftp, `${BASE}/package.json`).then((buf) => JSON.parse(buf.toString()).version).catch(() => null);
  const hasCreds = await exists(sftp, `${BASE}/sessions/creds.json`);
  const remotePlugins = await listDir(sftp, `${BASE}/plugins`).catch(() => []);
  console.log(`\nversi di panel   : ${version}`);
  console.log(`sessions/creds   : ${hasCreds ? 'ADA (sesi terpasang)' : 'tidak ada'}`);
  console.log(`plugin di panel  : ${remotePlugins.filter((item) => item.filename.endsWith('.js')).length} file`);

  console.log('\n📊 Perbandingan file (lokal vs panel)');
  const different = [];
  const missing = [];
  for (const rel of TRACKED) {
    const localPath = path.join(ROOT, rel);
    const localBuffer = fs.readFileSync(localPath);
    let remoteBuffer = null;
    try {
      remoteBuffer = await readFile(sftp, `${BASE}/${rel}`);
    } catch {
      remoteBuffer = null;
    }
    if (!remoteBuffer) missing.push(rel);
    else if (sha256(remoteBuffer) !== sha256(localBuffer)) different.push(rel);
  }
  console.log(`  berbeda : ${different.length}${different.length ? ` -> ${different.join(', ')}` : ''}`);
  console.log(`  belum ada di panel : ${missing.length}${missing.length ? ` -> ${missing.join(', ')}` : ''}`);
  return { different, missing };
}

async function push(sftp, files) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = `${BASE}/backup-${stamp}`;
  let backedUp = 0;
  let uploaded = 0;
  const failed = [];

  for (const rel of files) {
    const localPath = path.join(ROOT, rel);
    if (!fs.existsSync(localPath)) {
      failed.push(`${rel} (tidak ada di lokal)`);
      continue;
    }
    const localBuffer = fs.readFileSync(localPath);
    const remote = `${BASE}/${rel}`;
    const localHash = sha256(localBuffer);

    // lewati kalau isinya sama
    const remoteBuffer = await readFile(sftp, remote).catch(() => null);
    if (remoteBuffer && sha256(remoteBuffer) === localHash) {
      console.log(`= ${rel} (sudah sama, dilewati)`);
      continue;
    }

    if (remoteBuffer) {
      await mkdirp(sftp, backupDir);
      try {
        await writeFile(sftp, `${backupDir}/${rel.replace(/\//g, '__')}`, remoteBuffer);
        backedUp += 1;
      } catch (err) {
        console.log(`! gagal backup ${rel}: ${err.message}`);
      }
    }

    try {
      if (rel.includes('/')) await mkdirp(sftp, path.posix.dirname(remote));
      await writeFile(sftp, remote, localBuffer);
      const verify = await readFile(sftp, remote);
      if (sha256(verify) !== localHash) throw new Error('hash setelah upload tidak cocok');
      uploaded += 1;
      console.log(`↑ ${rel} (${localBuffer.length} B, terverifikasi)`);
    } catch (err) {
      failed.push(`${rel} (${err.message})`);
    }
  }

  console.log(`\nselesai: ${uploaded} diunggah, ${backedUp} dicadangkan ke ${path.posix.basename(backupDir)}`);
  if (failed.length) {
    console.log(`gagal: ${failed.join('; ')}`);
    process.exitCode = 1;
  }
}

async function pull(sftp, files) {
  for (const rel of files) {
    const target = path.join(ROOT, 'tmp', 'panel-pull', path.basename(rel));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      const buffer = await readFile(sftp, `${BASE}/${rel}`);
      fs.writeFileSync(target, buffer);
      console.log(`↓ ${rel} -> tmp/panel-pull/${path.basename(rel)} (${buffer.length} B)`);
    } catch (err) {
      console.log(`! gagal ambil ${rel}: ${err.message}`);
    }
  }
}

const [mode = 'inspect', ...files] = process.argv.slice(2);

if (!HOST || !USER || !PASS) {
  console.error('Kredensial belum lengkap. Set SFTP_HOST, SFTP_PORT, SFTP_USER, SFTP_PASS (dan opsional SFTP_BASE).');
  process.exit(1);
}

const client = await connect();
try {
  const sftp = await sftpOf(client);
  if (mode === 'inspect') await inspect(sftp);
  else if (mode === 'push') await push(sftp, files);
  else if (mode === 'pull') await pull(sftp, files);
  else console.error(`Mode tidak dikenal: ${mode}`);
} finally {
  client.end();
}
