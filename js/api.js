// Klientská vrstva nad /api – autentizace, sdílené záznamy, média.
'use strict';

async function req(path, opts = {}) {
  const init = { credentials: 'same-origin', ...opts };
  if (opts.json !== undefined) {
    init.method = init.method || 'POST';
    init.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    init.body = JSON.stringify(opts.json);
    delete init.json;
  }
  const res = await fetch(path, init);
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* prázdná/binární odpověď */
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `http_${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const Api = {
  async me() {
    const d = await req('/api/me');
    return d.user;
  },
  async login(code, name) {
    const d = await req('/api/login', { json: { code, name } });
    return d.user;
  },
  async logout() {
    await req('/api/logout', { method: 'POST' });
  },

  async list(collection) {
    const d = await req(`/api/records?collection=${encodeURIComponent(collection)}`);
    return d.items || [];
  },
  async create(collection, data) {
    const d = await req(`/api/records?collection=${encodeURIComponent(collection)}`, { json: data });
    return d.item;
  },
  async update(collection, id, data) {
    const d = await req(
      `/api/records?collection=${encodeURIComponent(collection)}&id=${encodeURIComponent(id)}`,
      { method: 'PUT', json: data }
    );
    return d.item;
  },
  async remove(collection, id) {
    await req(
      `/api/records?collection=${encodeURIComponent(collection)}&id=${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    );
  },

  // Média: nahraje binární blob (hlas/kresba/foto) a vrátí klíč.
  async uploadMedia(blob, ext) {
    const res = await fetch(`/api/media?ext=${encodeURIComponent(ext)}`, {
      method: 'POST',
      credentials: 'same-origin',
      body: blob,
    });
    if (!res.ok) throw new Error('upload_failed');
    const d = await res.json();
    return d.key;
  },
  mediaUrl(key) {
    return `/api/media?key=${encodeURIComponent(key)}`;
  },
};
