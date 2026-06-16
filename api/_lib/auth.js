// Session a autentizace pro terénní app ČSOP Trosečníci.
// Sdílený týmový kód -> HMAC-podepsaná httpOnly cookie. Bez DB, bez třetích stran.
import crypto from 'node:crypto';

const SECRET = process.env.SESSION_SECRET || '';
const COOKIE = 'ochr_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 dní

const b64url = (buf) => Buffer.from(buf).toString('base64url');

// Porovnání odolné vůči časovým útokům (a neúniku délky – obě strany se zahashují).
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Pojmenované profily: env TEAM_MEMBERS="Jméno:heslo,Jméno2:heslo2".
// Každý profil = vlastní heslo; heslo jednoznačně určuje, kdo se přihlásil.
export function getMembers() {
  return (process.env.TEAM_MEMBERS || '')
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf(':');
      if (i < 1) return null;
      return { name: pair.slice(0, i).trim(), code: pair.slice(i + 1).trim() };
    })
    .filter((m) => m && m.name && m.code);
}

// Vrátí profil odpovídající heslu, nebo null. Projde všechny (bez předčasného
// návratu), aby čas odpovědi neprozrazoval, který profil sedí.
export function findMemberByCode(code) {
  if (!code) return null;
  let found = null;
  for (const m of getMembers()) {
    if (safeEqual(code, m.code)) found = m;
  }
  return found ? { name: found.name } : null;
}

export function sign(payloadObj) {
  const payload = b64url(JSON.stringify(payloadObj));
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(token) {
  if (!token || !token.includes('.') || !SECRET) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let obj;
  try {
    obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!obj || typeof obj.iat !== 'number') return null;
  if (Date.now() - obj.iat > MAX_AGE * 1000) return null;
  return obj;
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

export function getSession(req) {
  return verifyToken(parseCookies(req)[COOKIE]);
}

function isSecure(req) {
  return process.env.VERCEL === '1' || req.headers['x-forwarded-proto'] === 'https';
}

export function setSessionCookie(res, payload, req) {
  const token = sign(payload);
  const secure = isSecure(req) ? ' Secure;' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`
  );
}

export function clearSessionCookie(res, req) {
  const secure = isSecure(req) ? ' Secure;' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=0`);
}

// Vrátí session, nebo odešle 401 a vrátí null.
export function requireAuth(req, res) {
  const s = getSession(req);
  if (!s) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  return s;
}
