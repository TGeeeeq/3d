import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { put, get } from '@vercel/blob';
import { requireAuth } from './_lib/auth.js';

// Vlastní čtení binárního těla (vypneme automatický parser).
export const config = { api: { bodyParser: false } };

const MAX_UPLOAD = 12 * 1024 * 1024; // 12 MB
const KEY_RE = /^media\/[a-zA-Z0-9_.-]+$/;

const EXT_CT = {
  webm: 'audio/webm',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

async function readRaw(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    const buf = typeof c === 'string' ? Buffer.from(c) : c;
    total += buf.length;
    if (total > MAX_UPLOAD) {
      const e = new Error('too_large');
      e.statusCode = 413;
      throw e;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    if (req.method === 'POST') {
      const ext = (req.query.ext || '').toString().toLowerCase();
      const contentType = EXT_CT[ext];
      if (!contentType) {
        res.status(400).json({ error: 'bad_ext' });
        return;
      }
      const data = await readRaw(req);
      if (!data.length) {
        res.status(400).json({ error: 'empty' });
        return;
      }
      const key = `media/${crypto.randomUUID()}.${ext}`;
      await put(key, data, {
        access: 'private',
        contentType,
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: 31536000,
      });
      res.status(201).json({ key });
      return;
    }

    if (req.method === 'GET') {
      const key = (req.query.key || '').toString();
      if (!KEY_RE.test(key)) {
        res.status(400).json({ error: 'bad_key' });
        return;
      }
      const r = await get(key, { access: 'private' });
      if (!r || !r.stream) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.setHeader('Content-Type', r.blob?.contentType || 'application/octet-stream');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      Readable.fromWeb(r.stream).pipe(res);
      return;
    }

    res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'server_error' });
  }
}
