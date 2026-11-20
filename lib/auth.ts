// Access-code login for the web app, and the keys it uses to talk to server/.
//
// TATVA_ACCESS_CODE   the code people type on /login (and into the extension).
//                     Unset in local development = no login.
// TATVA_SERVER_KEY    shared secret with server/: sent as x-tatva-key when
//                     proxying /tatva/* and used to mint upload tokens. Never
//                     reaches the browser.
// TATVA_SERVER_URL    where server/ runs (Render URL, or http://localhost:4000).
//
// Web Crypto only, so this runs in proxy.ts and in route handlers alike.

export const SESSION_COOKIE = 'tatva_session';
export const SESSION_DAYS = 7;

export const accessCode = () => process.env.TATVA_ACCESS_CODE?.trim() || '';
export const serverKey = () => process.env.TATVA_SERVER_KEY?.trim() || '';
export const serverUrl = () => (process.env.TATVA_SERVER_URL?.trim() || 'http://localhost:4000').replace(/\/$/, '');
export const isProduction = () => process.env.NODE_ENV === 'production';

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer): string {
  let binary = '';
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(await crypto.subtle.sign('HMAC', k, encoder.encode(message)));
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Sessions are signed with the access code itself, so changing the code logs everyone out.
const sessionKey = () => `session|${accessCode()}|${serverKey()}`;

/** `<expiresAtSeconds>.<hmac>` */
export async function createSession(now = Date.now()): Promise<{ value: string; maxAge: number }> {
  const maxAge = SESSION_DAYS * 24 * 3600;
  const exp = Math.floor(now / 1000) + maxAge;
  return { value: `${exp}.${await hmac(sessionKey(), `session:${exp}`)}`, maxAge };
}

export async function verifySession(value: string | undefined, now = Date.now()): Promise<boolean> {
  if (!value) return false;
  const [exp, sig] = value.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) * 1000 < now) return false;
  return safeEqual(sig, await hmac(sessionKey(), `session:${exp}`));
}

/** Same format server/src/auth.ts verifies: lets the browser upload files straight to server/. */
export async function mintUploadToken(ttlSeconds = 600, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  return `${exp}.${await hmac(serverKey(), `upload:${exp}`)}`;
}
