// Datová vrstva nad Vercel Blob (privátní store).
// Každý záznam = jeden JSON blob -> bezpečné při souběžných zápisech více uživatelů.
import { put, get, head, list, del } from '@vercel/blob';

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

// Robustní čtení obsahu blobu. Zkusí postupně víc cest, protože samotné get() umí
// na některých storech/verzích vrátit chybu i pro existující privátní blob:
//   1) přímý fetch downloadUrl/url z výpisu (list) – nejspolehlivější,
//   2) get() se streamem,
//   3) autorizovaný fetch přes head() (pro jednotlivé záznamy bez výpisu).
// `listed` = objekt blobu z list() (má url/downloadUrl), pokud je k dispozici.
export async function readJSON(pathname, listed = null) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  let lastErr = null;

  // 1) URL z výpisu – stáhneme rovnou
  const listedUrl = listed && (listed.downloadUrl || listed.url);
  if (listedUrl) {
    try {
      const res = await fetch(listedUrl);
      if (res.ok) return parseJSON(await res.text());
      if (res.status === 404) return null;
    } catch (e) {
      lastErr = e;
    }
  }

  // 2) SDK get() se streamem
  try {
    const r = await get(pathname, { access: 'private' });
    if (r === null) return null; // 404 = neexistuje
    if (r.statusCode === 200 && r.stream) return parseJSON(await new Response(r.stream).text());
    if (r.statusCode === 304) return null;
  } catch (e) {
    lastErr = e;
  }

  // 3) head() + autorizovaný fetch (záchrana pro jednotlivý záznam bez `listed`)
  try {
    const info = await head(pathname);
    const url = info.downloadUrl || info.url;
    if (url) {
      const res = await fetch(url, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
      if (res.ok) return parseJSON(await res.text());
      if (res.status === 404) return null;
    }
  } catch (e) {
    lastErr = e;
  }

  if (lastErr) throw lastErr; // ať je skutečná příčina vidět v diagnostice
  return null;
}

export async function writeJSON(pathname, obj, contentType = 'application/json') {
  await put(pathname, typeof obj === 'string' ? obj : JSON.stringify(obj), {
    access: 'private',
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
  // Jeden nečitelný blob nesmí shodit celý výpis (žádné 500). Pokud ale selžou VŠECHNY,
  // vyhodíme první chybu, ať je v diagnostice vidět skutečná příčina.
  const settled = await Promise.allSettled(blobs.map((b) => readJSON(b.pathname, b)));
  const items = [];
  let firstErr = null;
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      if (s.value) items.push(s.value);
    } else if (!firstErr) {
      firstErr = s.reason;
    }
  }
  if (!items.length && firstErr) throw firstErr;
  return items;
}
