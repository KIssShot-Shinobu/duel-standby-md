/**
 * Klien REST API opsional (dipakai plugin downloader/stalker).
 *
 * Bot ini TIDAK butuh API key untuk fitur inti. Kalau API_BASE / API_KEY kosong,
 * plugin yang membutuhkannya akan menampilkan pesan yang jelas (bukan crash).
 */
export class ApiClient {
  constructor({ base = '', key = '', timeout = 60000 } = {}) {
    this.base = String(base || '').replace(/\/+$/, '');
    this.key = key || '';
    this.timeout = timeout;
  }

  get configured() {
    return Boolean(this.base);
  }

  buildUrl(pathname, params = {}) {
    if (!this.configured) throw new Error('API belum dikonfigurasi (isi API_BASE dan API_KEY di .env)');
    const url = new URL(this.base + (pathname.startsWith('/') ? pathname : `/${pathname}`));
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    if (this.key) url.searchParams.set('apikey', this.key);
    return url;
  }

  async request(pathname, { method = 'GET', params = {}, body, headers = {} } = {}) {
    const url = this.buildUrl(pathname, params);
    const response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}),
        'User-Agent': 'rtxzy-md-clean/1.0',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeout),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`API ${response.status}: ${text.slice(0, 200)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return { result: text };
    }
  }

  get(pathname, params) {
    return this.request(pathname, { params });
  }

  post(pathname, body, params) {
    return this.request(pathname, { method: 'POST', body, params });
  }
}

export function createApi(config) {
  return new ApiClient(config?.api || {});
}

export default ApiClient;
