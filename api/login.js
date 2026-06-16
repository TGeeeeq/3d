import { setSessionCookie, safeEqual, findMemberByCode, getMembers } from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const body = req.body || {};
  const code = (body.code || '').toString();
  const name = (body.name || '').toString().trim().slice(0, 40);
  const teamCode = process.env.TEAM_ACCESS_CODE || '';

  if (!getMembers().length && !teamCode) {
    res.status(500).json({ error: 'server_not_configured' });
    return;
  }
  if (!code) {
    res.status(401).json({ error: 'bad_code' });
    return;
  }

  // 1) Pojmenovaný profil – heslo samo určí, kdo se přihlásil.
  const member = findMemberByCode(code);
  if (member) {
    setSessionCookie(res, { u: member.name, iat: Date.now() }, req);
    res.status(200).json({ ok: true, user: { name: member.name } });
    return;
  }

  // 2) Záložní sdílený týmový kód – kdo ho zná, přihlásí se a napíše si jméno.
  if (teamCode && safeEqual(code, teamCode)) {
    if (!name) {
      res.status(400).json({ error: 'name_required' });
      return;
    }
    setSessionCookie(res, { u: name, iat: Date.now() }, req);
    res.status(200).json({ ok: true, user: { name } });
    return;
  }

  // malá prodleva ztěžuje hádání hesla
  await new Promise((r) => setTimeout(r, 400));
  res.status(401).json({ error: 'bad_code' });
}
