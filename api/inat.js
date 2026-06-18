// Publikace pozorování do iNaturalistu. Sdílený týmový účet – přihlašovací údaje
// zůstávají na serveru (stejný princip jako PLANTNET_API_KEY / BLOB token). Same-origin → bez CSP změn.
// Tělo je JSON (lat/lng/scientificName/…); fotku si server načte sám z privátního Blobu.
import { get } from '@vercel/blob';
import { requireAuth } from './_lib/auth.js';

const API = 'https://api.inaturalist.org/v1';
const SITE = 'https://www.inaturalist.org';
const UA = process.env.INAT_USER_AGENT || 'ochranar/1.0 (CSOP Trosecnici; +https://nechmerust.org)';
const KEY_RE = /^media\/[a-zA-Z0-9_.-]+$/;

// JWT cache – přežívá mezi warm invokacemi na téže instanci (Fluid Compute), best-effort.
let jwtCache = { token: null, exp: 0 };

async function mintJwt(c) {
  const tok = await fetch(`${SITE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({
      grant_type: 'password',
      client_id: c.id,
      client_secret: c.secret,
      username: c.user,
      password: c.pass,
    }),
  });
  if (!tok.ok) {
    const e = new Error('inat_auth_failed');
    e.statusCode = 502;
    throw e;
  }
  const { access_token } = await tok.json();
  const jr = await fetch(`${SITE}/users/api_token`, {
    headers: { Authorization: `Bearer ${access_token}`, 'User-Agent': UA },
  });
  if (!jr.ok) {
    const e = new Error('inat_jwt_failed');
    e.statusCode = 502;
    throw e;
  }
  return (await jr.json()).api_token;
}

async function getJwt(c, force = false) {
  if (!force && jwtCache.token && jwtCache.exp > Date.now()) return jwtCache.token;
  const token = await mintJwt(c);
  jwtCache = { token, exp: Date.now() + 23 * 3600 * 1000 }; // 23h rezerva proti 24h limitu
  return token;
}

// Volání iNat API s automatickým re-mintem JWT při 401.
async function inatFetch(c, path, init) {
  let jwt = await getJwt(c);
  const call = (t) =>
    fetch(`${API}${path}`, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${t}`, 'User-Agent': UA },
    });
  let res = await call(jwt);
  if (res.status === 401) {
    jwt = await getJwt(c, true);
    res = await call(jwt);
  }
  return res;
}

export default async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const env = process.env;
  if (!env.INAT_APP_ID || !env.INAT_APP_SECRET || !env.INAT_USERNAME || !env.INAT_PASSWORD) {
    res.status(503).json({ error: 'inat_unavailable' });
    return;
  }
  const c = { id: env.INAT_APP_ID, secret: env.INAT_APP_SECRET, user: env.INAT_USERNAME, pass: env.INAT_PASSWORD };

  const b = req.body || {};
  const lat = Number(b.lat);
  const lng = Number(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: 'bad_coords' });
    return;
  }
  const photoKey = (b.photoKey || '').toString();
  if (photoKey && !KEY_RE.test(photoKey)) {
    res.status(400).json({ error: 'bad_photo_key' });
    return;
  }

  try {
    const obsBody = {
      observation: {
        species_guess: (b.scientificName || '').toString().slice(0, 256) || undefined,
        observed_on_string: (b.observedOn || '').toString() || undefined,
        latitude: lat,
        longitude: lng,
        positional_accuracy: Number.isFinite(Number(b.accuracy)) ? Number(b.accuracy) : undefined,
        description: (b.description || '').toString().slice(0, 5000) || undefined,
        geoprivacy: ['open', 'obscured', 'private'].includes(b.geoprivacy) ? b.geoprivacy : 'open',
      },
    };
    const obsRes = await inatFetch(c, '/observations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obsBody),
    });
    if (obsRes.status === 429) {
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
    if (obsRes.status === 422) {
      res.status(422).json({ error: 'inat_rejected' });
      return;
    }
    if (!obsRes.ok) {
      res.status(502).json({ error: 'inat_create_failed' });
      return;
    }
    const obs = await obsRes.json();
    const id = obs?.results?.[0]?.id ?? obs?.id;
    if (!id) {
      res.status(502).json({ error: 'inat_no_id' });
      return;
    }

    let photoUploaded = false;
    if (photoKey) {
      try {
        const blobRes = await get(photoKey, { access: 'private' });
        if (blobRes && blobRes.stream) {
          const buf = await new Response(blobRes.stream).arrayBuffer();
          const form = new FormData();
          form.append('observation_photo[observation_id]', String(id));
          form.append('file', new Blob([buf], { type: blobRes.blob?.contentType || 'image/jpeg' }), 'photo.jpg');
          photoUploaded = (await inatFetch(c, '/observation_photos', { method: 'POST', body: form })).ok;
        }
      } catch {
        photoUploaded = false; // pozorování zůstane i bez fotky – nehroutíme publikaci
      }
    }

    res.status(200).json({ id, url: `${SITE}/observations/${id}`, photoUploaded });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'server_error' });
  }
}
