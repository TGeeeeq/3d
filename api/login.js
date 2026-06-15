import { setSessionCookie, safeEqual } from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const body = req.body || {};
  const code = (body.code || '').toString();
  const name = (body.name || '').toString().trim().slice(0, 40);
  const expected = process.env.TEAM_ACCESS_CODE || '';

  if (!expected) {
    res.status(500).json({ error: 'server_not_configured' });
    return;
  }
  if (!code || !safeEqual(code, expected)) {
    // malá prodleva ztěžuje hádání kódu
    await new Promise((r) => setTimeout(r, 400));
    res.status(401).json({ error: 'bad_code' });
    return;
  }
  if (!name) {
    res.status(400).json({ error: 'name_required' });
    return;
  }
  setSessionCookie(res, { u: name, iat: Date.now() }, req);
  res.status(200).json({ ok: true, user: { name } });
}
