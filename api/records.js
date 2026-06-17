import crypto from 'node:crypto';
import { requireAuth } from './_lib/auth.js';
import {
  assertCollection,
  listCollection,
  getRecord,
  putRecord,
  deleteRecord,
} from './_lib/store.js';

const MAX_BODY = 256 * 1024; // 256 kB na záznam (kresby/hlas jdou přes /api/media)
const RESERVED = ['id', 'author', 'createdAt', 'updatedAt'];

function sanitize(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (RESERVED.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  const collection = (req.query.collection || '').toString();
  try {
    assertCollection(collection);
  } catch {
    res.status(400).json({ error: 'bad_collection' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const all = await listCollection(collection);
      // Soukromé záznamy (scope === 'personal') vidí jen jejich autor – osobní finance se
      // nesmí dostat k ostatním ani po drátě, proto se filtruje na serveru, ne až v klientu.
      const items = all.filter((r) => r.scope !== 'personal' || r.author === session.u);
      items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      res.status(200).json({ items });
      return;
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      if (JSON.stringify(body).length > MAX_BODY) {
        res.status(413).json({ error: 'too_large' });
        return;
      }
      const now = new Date().toISOString();
      const record = {
        ...sanitize(body),
        id: crypto.randomUUID(),
        author: session.u,
        createdAt: now,
        updatedAt: now,
      };
      await putRecord(collection, record);
      res.status(201).json({ item: record });
      return;
    }

    if (req.method === 'PUT') {
      const id = (req.query.id || '').toString();
      const existing = await getRecord(collection, id);
      if (!existing) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const body = req.body || {};
      if (JSON.stringify(body).length > MAX_BODY) {
        res.status(413).json({ error: 'too_large' });
        return;
      }
      const record = {
        ...existing,
        ...sanitize(body),
        id: existing.id,
        author: existing.author,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
        editedBy: session.u,
      };
      await putRecord(collection, record);
      res.status(200).json({ item: record });
      return;
    }

    if (req.method === 'DELETE') {
      const id = (req.query.id || '').toString();
      // Mazat smí jen autor záznamu. Výjimka: notifikaci smí zrušit i její adresát (target).
      const existing = await getRecord(collection, id);
      if (existing && existing.author && existing.author !== session.u) {
        const isNotifTarget = collection === 'notifications' && existing.target === session.u;
        if (!isNotifTarget) {
          res.status(403).json({ error: 'not_owner' });
          return;
        }
      }
      await deleteRecord(collection, id);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'server_error' });
  }
}
