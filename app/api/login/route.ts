import { NextResponse, type NextRequest } from 'next/server';
import { accessCode, createSession, isProduction, SESSION_COOKIE, safeEqual } from '@/lib/auth';

// Slows down guessing: a few attempts per IP per window (per server instance).
const attempts = new Map<string, { count: number; since: number }>();
const WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 10;

export async function POST(req: NextRequest) {
  const code = accessCode();
  if (!code) return NextResponse.json({ ok: true, open: true });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const now = Date.now();
  const entry = attempts.get(ip);
  const current = entry && now - entry.since < WINDOW_MS ? entry : { count: 0, since: now };
  if (current.count >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a few minutes.' }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as { code?: unknown };
  const given = typeof body.code === 'string' ? body.code.trim() : '';
  if (!given || !safeEqual(given, code)) {
    attempts.set(ip, { count: current.count + 1, since: current.since });
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: 'That code is not right.' }, { status: 401 });
  }
  attempts.delete(ip);

  const session = await createSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, session.value, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge: session.maxAge,
  });
  return res;
}
