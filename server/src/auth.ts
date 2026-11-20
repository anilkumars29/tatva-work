// Who may call the server.
//
//  /health                 anyone (Render health check)
//  /v1/*                   the voice agent; its own Bearer key (routes/chat.ts)
//  /api/*                  only:
//    - the web app's server side: header x-tatva-key = TATVA_SERVER_KEY
//      (Vercel adds it when it proxies /tatva/* to here; browsers never see it)
//    - the Chrome extension: header x-tatva-access-code = TATVA_ACCESS_CODE
//      (the same code the user logs into the web app with)
//    - direct browser uploads (files too large for Vercel's proxy): header
//      x-tatva-upload = a short-lived token the web app mints with TATVA_SERVER_KEY
//
// Local development: with TATVA_SERVER_KEY unset, /api is open on localhost
// but never through the Cloudflare quick tunnel (requests carrying cf-ray).
// With NODE_ENV=production and no key, /api refuses everything.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const SERVER_KEY = process.env.TATVA_SERVER_KEY?.trim() || '';
export const ACCESS_CODE = process.env.TATVA_ACCESS_CODE?.trim() || '';
const PRODUCTION = process.env.NODE_ENV === 'production';

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** `<expiresAtSeconds>.<base64url hmac>`; the web app mints the same format (lib/auth.ts). */
export function verifyUploadToken(token: string, key = SERVER_KEY, now = Date.now()): boolean {
  const [exp, sig] = token.split('.');
  if (!key || !exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) * 1000 < now) return false;
  const expected = createHmac('sha256', key).update(`upload:${exp}`).digest('base64url');
  return safeEqual(sig, expected);
}

export function mintUploadToken(key: string, ttlSeconds = 600, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  return `${exp}.${createHmac('sha256', key).update(`upload:${exp}`).digest('base64url')}`;
}

/** Upload endpoints that accept an upload token instead of the server key. */
const UPLOAD_ROUTES = [/^\/meetings\/[0-9a-f-]{36}\/attachments$/i, /^\/documents$/];

/** Express middleware for /api. */
export function apiAuth(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'OPTIONS') return next(); // CORS preflight (handled by cors())
  if (!SERVER_KEY) {
    if (PRODUCTION) {
      res.status(503).json({ error: 'Server is not configured: set TATVA_SERVER_KEY.' });
      return;
    }
    // Dev: localhost only, never via the quick tunnel.
    if (req.get('cf-ray')) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    return next();
  }
  const key = req.get('x-tatva-key');
  if (key && safeEqual(key, SERVER_KEY)) return next();
  const code = req.get('x-tatva-access-code');
  if (code && ACCESS_CODE && safeEqual(code, ACCESS_CODE)) return next();
  const upload = req.get('x-tatva-upload');
  if (upload && req.method === 'POST' && UPLOAD_ROUTES.some((r) => r.test(req.path)) && verifyUploadToken(upload)) return next();
  res.status(401).json({ error: code || key ? 'Wrong access code.' : 'Not authorised.' });
}

/** Browser origins allowed by CORS: localhost, the extension, and WEB_ORIGINS (comma-separated). */
export function allowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // server-to-server and extension service worker requests
  if (/^chrome-extension:\/\//.test(origin)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  const allowed = (process.env.WEB_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return allowed.includes(origin);
}
