/**
 * Server HTTP kecil untuk health check (cocok untuk Render/Heroku/Pterodactyl).
 *   GET /        -> status bot
 *   GET /health  -> ringkasan runtime (uptime, plugin, koneksi)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export function writeStatus(file, data) {
  try {
    const absolute = path.resolve(file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const tmp = `${absolute}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, absolute);
    return true;
  } catch {
    return false;
  }
}

export function readStatus(file) {
  try {
    const absolute = path.resolve(file);
    if (!fs.existsSync(absolute)) return null;
    return JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {{port?: number, host?: string, statusFile?: string, meta?: object}} options
 * @returns {Promise<{server: http.Server, port: number, url: string, close: () => Promise<void>}>}
 */
export function startHealthServer({ port = 0, host = '0.0.0.0', statusFile = '', meta = {} } = {}) {
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }

    if (url === '/' || url === '/health' || url === '/status') {
      const status = statusFile ? readStatus(statusFile) : null;
      const payload = {
        status: true,
        ok: true,
        message: 'Bot Successfully Activated!',
        ...meta,
        uptime: Math.round(process.uptime()),
        pid: process.pid,
        node: process.version,
        memory: Math.round(process.memoryUsage().rss / 1024 / 1024),
        ...(status || {}),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(url === '/' ? { response: payload } : payload, null, 2));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  return new Promise((resolve, reject) => {
    const listen = (targetPort) => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && targetPort !== 0) {
          listen(0);
          return;
        }
        reject(err);
      });
      server.listen(targetPort, host, () => {
        const actual = server.address().port;
        resolve({
          server,
          port: actual,
          url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actual}`,
          close: () =>
            new Promise((done) => {
              server.close(() => done());
            }),
        });
      });
    };
    listen(port);
  });
}

export default { startHealthServer, writeStatus, readStatus };
