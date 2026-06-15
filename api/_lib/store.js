// Datová vrstva nad Vercel Blob (privátní store).
// Každý záznam = jeden JSON blob -> bezpečné při souběžných zápisech více uživatelů.
import { put, get, list, del } from '@vercel/blob';

// Povolené kolekce (whitelist brání path traversal a zneužití).
export const COLLECTIONS = new Set([
  'notes', // body/plochy v mapě
  'tracks', // nahrané trasy (GPS)
  'diary', // terénní deník (text/kresba/hlas)
  'time', // výkazy hodin
  'finance', // příjmy/výdaje
  'rewards', // odměny / body
  'localities', // spravované lokality (do budoucna)
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

export async function readJSON(pathname) {
  const r = await get(pathname, { access: 'private', useCache: false });
  if (!r || r.statusCode === 304 || !r.stream) return null;
  const txt = await new Response(r.stream).text();
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
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
  const items = await Promise.all(blobs.map((b) => readJSON(b.pathname)));
  return items.filter(Boolean);
}
