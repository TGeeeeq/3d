import { getSession } from './_lib/auth.js';

export default async function handler(req, res) {
  const s = getSession(req);
  res.status(200).json({ user: s ? { name: s.u } : null });
}
