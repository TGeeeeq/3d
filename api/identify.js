// Proxy na Pl@ntNet – rozpoznání rostliny z fotky. API klíč zůstává na serveru
// (stejný princip jako Blob token), klient ho nikdy nevidí. Same-origin → bez CSP změn.
import { requireAuth } from './_lib/auth.js';

// Binární tělo čteme sami (vypneme automatický parser) – stejně jako /api/media.
export const config = { api: { bodyParser: false } };

const MAX_UPLOAD = 6 * 1024 * 1024; // 6 MB (zmenšená fotka má ~0,5 MB)
const PROJECT = 'weurope'; // flóra západní + střední Evropy
const ENDPOINT = `https://my-api.plantnet.org/v2/identify/${PROJECT}`;

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
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const key = process.env.PLANTNET_API_KEY;
  if (!key) {
    res.status(503).json({ error: 'identify_unavailable' });
    return;
  }

  try {
    const data = await readRaw(req);
    if (!data.length) {
      res.status(400).json({ error: 'empty' });
      return;
    }

    // Pl@ntNet chce multipart pole `images` (+ volitelně `organs`). Node 22 má global FormData/Blob/fetch.
    const form = new FormData();
    form.append('images', new Blob([data], { type: 'image/jpeg' }), 'plant.jpg');
    form.append('organs', 'auto');

    const url = `${ENDPOINT}?api-key=${encodeURIComponent(key)}&lang=cs&nb-results=5`;
    const r = await fetch(url, { method: 'POST', body: form });

    if (r.status === 404) {
      res.status(200).json({ results: [], remaining: null }); // nic nerozpoznáno
      return;
    }
    if (r.status === 429) {
      res.status(429).json({ error: 'rate_limited' }); // vyčerpaný denní limit
      return;
    }
    if (!r.ok) {
      res.status(502).json({ error: 'identify_failed' });
      return;
    }

    const j = await r.json();
    const results = (j.results || [])
      .slice(0, 5)
      .map((it) => ({
        scientificName:
          it.species?.scientificNameWithoutAuthor || it.species?.scientificName || '',
        commonName: (it.species?.commonNames && it.species.commonNames[0]) || '',
        score: Math.round((it.score || 0) * 100) / 100,
        family: it.species?.family?.scientificNameWithoutAuthor || '',
        gbifId: it.species?.gbif?.id ?? null,
      }))
      .filter((x) => x.scientificName);

    res.status(200).json({ results, remaining: j.remainingIdentificationRequests ?? null });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'server_error' });
  }
}
