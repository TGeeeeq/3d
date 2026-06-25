// Datová vrstva nad Vercel Blob (privátní store).
// Každý záznam = jeden JSON blob -> bezpečné při souběžných zápisech více uživatelů.
import { put, head, list, del } from '@vercel/blob';

// Povolené kolekce (whitelist brání path traversal a zneužití).
export const COLLECTIONS = new Set([
  'notes', // body/plochy v mapě
  'tracks', // nahrané trasy (GPS)
  'diary', // terénní deník (text/kresba/hlas)
  'time', // výkazy hodin
  'finance', // příjmy/výdaje
  'rewards', // odměny / body
  'localities', // spravované lokality (do budoucna)
  'areas', // chráněná území (ZCHÚ/VKP/ÚSES) – editovatelné hranice v mapě
  'notifications', // upozornění (návrhy na smazání) směrované konkrétnímu uživateli
  'chat', // týmový live chat
]);

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function assertCollection(c) {
  if (!COLLECTIONS.has(c)) {
    const e = new Error('bad_collection');
    e.statusCode = 400;
    throw e;
  }
}

export function assertId(id) {
  if (!ID_RE.test(id)) {
    const e = new Error('bad_id');
    e.statusCode = 400;
    throw e;
  }
}

const recPath = (c, id) => `records/${c}/${id}.json`;

function parseJSON(txt) {
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

// Čtení obsahu blobu přes kanonický URL z výpisu (list) nebo z head().
// Jeden HTTP požadavek na záznam, s autorizací (funguje pro public i private store).
// `listed` = objekt blobu z list() (obsahuje url/downloadUrl), pokud je k dispozici.
export async function readJSON(pathname, listed = null) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  let url = listed && (listed.downloadUrl || listed.url);
  if (!url) {
    try {
      const h = await head(pathname);
      url = h && (h.downloadUrl || h.url);
    } catch (e) {
      if (e && (e.name === 'BlobNotFoundError' || e.status === 404)) return null;
      throw e;
    }
  }
  if (!url) return null;
  const res = await fetch(url, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
  if (res.status === 404) return null;
  if (!res.ok) {
    let host = '';
    try {
      host = new URL(url).host;
    } catch {
      /* ignore */
    }
    throw new Error(`blob ${res.status} @ ${host}`);
  }
  return parseJSON(await res.text());
}

export async function writeJSON(pathname, obj, contentType = 'application/json') {
  await put(pathname, typeof obj === 'string' ? obj : JSON.stringify(obj), {
    access: 'public', // veřejně čitelné přes downloadUrl (cesty mají neuhodnutelné UUID)
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

export async function getRecord(c, id) {
  assertCollection(c);
  assertId(id);
  return readJSON(recPath(c, id));
}

export async function putRecord(c, record) {
  assertCollection(c);
  assertId(record.id);
  await writeJSON(recPath(c, record.id), record);
  return record;
}

export async function deleteRecord(c, id) {
  assertCollection(c);
  assertId(id);
  await del(recPath(c, id)).catch(() => {});
}

export async function listCollection(c) {
  assertCollection(c);
  const prefix = `records/${c}/`;
  const blobs = [];
  let cursor;
  do {
    const res = await list({ prefix, cursor, limit: 1000 });
    blobs.push(...res.blobs);
    cursor = res.hasMore ? res.cursor : undefined;
  } while (cursor);
  if (!blobs.length) return [];
  // Čteme po malých dávkách (omezený souběh) – jinak Vercel Blob vrací „Too many requests".
  // Jeden nečitelný blob neshodí celý výpis; když selžou VŠECHNY, vyhodíme první chybu
  // (ať je v diagnostice vidět skutečná příčina).
  const CONCURRENCY = 4;
  const items = [];
  let firstErr = null;
  for (let i = 0; i < blobs.length; i += CONCURRENCY) {
    const batch = blobs.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((b) => readJSON(b.pathname, b)));
    for (const s of settled) {
      if (s.status === 'fulfilled') {
        if (s.value) items.push(s.value);
      } else if (!firstErr) {
        firstErr = s.reason;
      }
    }
  }
  if (!items.length && firstErr) throw firstErr;
  return items;
}
