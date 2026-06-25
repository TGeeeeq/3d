// Jednorázová migrace: převede existující bloby z 'private' na veřejně čitelné ('public').
// Děje se serverově přes copy() (Vercel kopíruje interně – není nutné obsah nejdřív stáhnout),
// takže to funguje i tam, kde přímé čtení privátního blobu vrací 403.
// Volá se po jedné kolekci (?collection=notes | media | …), aby se to vešlo do časového limitu.
import { list, copy } from '@vercel/blob';
import { requireAuth } from './_lib/auth.js';
import { COLLECTIONS } from './_lib/store.js';

const EXT_CT = {
  webm: 'audio/webm', m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
};
function contentTypeFor(pathname) {
  if (pathname.endsWith('.json')) return 'application/json';
  const ext = (pathname.split('.').pop() || '').toLowerCase();
  return EXT_CT[ext] || 'application/octet-stream';
}

async function listAll(prefix) {
  const blobs = [];
  let cursor;
  do {
    const r = await list({ prefix, cursor, limit: 1000 });
    blobs.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return blobs;
}

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const collection = (req.query.collection || '').toString();
  let prefix;
  if (collection === 'media') {
    prefix = 'media/';
  } else if (COLLECTIONS.has(collection)) {
    prefix = `records/${collection}/`;
  } else {
    res.status(400).json({ error: 'bad_collection' });
    return;
  }

  try {
    const blobs = await listAll(prefix);
    let copied = 0;
    let errors = 0;
    let firstError = null;
    const CONCURRENCY = 4;
    for (let i = 0; i < blobs.length; i += CONCURRENCY) {
      const batch = blobs.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map((b) =>
          copy(b.url, b.pathname, {
            access: 'public',
            addRandomSuffix: false,
            allowOverwrite: true,
            contentType: contentTypeFor(b.pathname),
          })
        )
      );
      for (const s of settled) {
        if (s.status === 'fulfilled') {
          copied += 1;
        } else {
          errors += 1;
          if (!firstError) firstError = String((s.reason && s.reason.message) || s.reason).slice(0, 160);
        }
      }
    }
    res.status(200).json({ ok: true, collection, total: blobs.length, copied, errors, firstError });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
