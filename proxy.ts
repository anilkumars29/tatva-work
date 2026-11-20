// Runs before every request (Next.js 16 "proxy", formerly middleware).
//  1. Access-code login: every page and API route needs a valid session cookie,
//     except /login and /api/login (and static files, see `config.matcher`).
//  2. /tatva/* is forwarded to server/ /api/* with the shared server key added
//     server-side, so the browser never sees it.
import { NextResponse, type NextRequest } from 'next/server';
import { accessCode, isProduction, SESSION_COOKIE, serverKey, serverUrl, verifySession } from '@/lib/auth';

const PUBLIC_PATHS = new Set(['/login', '/api/login']);

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isApi = pathname.startsWith('/api/') || pathname.startsWith('/tatva/');

  if (!PUBLIC_PATHS.has(pathname)) {
    const code = accessCode();
    if (!code && isProduction()) {
      // Fail closed: a deployment without an access code serves nothing.
      return new NextResponse('Tatva is not configured: set TATVA_ACCESS_CODE.', { status: 503 });
    }
    if (code && !(await verifySession(req.cookies.get(SESSION_COOKIE)?.value))) {
      if (isApi) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
      const login = new URL('/login', req.url);
      if (pathname !== '/') login.searchParams.set('next', `${pathname}${search}`);
      return NextResponse.redirect(login);
    }
  }

  if (pathname.startsWith('/tatva/')) {
    const target = new URL(`${serverUrl()}/api/${pathname.slice('/tatva/'.length)}${search}`);
    const headers = new Headers(req.headers);
    headers.delete('cookie'); // the session cookie stays on Vercel
    const key = serverKey();
    if (key) headers.set('x-tatva-key', key);
    return NextResponse.rewrite(target, { request: { headers } });
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next's static assets and public files (logo, icons, manifest).
  matcher: ['/((?!_next/static|_next/image|brand/|favicon|apple-touch-icon|android-chrome|site\\.webmanifest|.*\\.(?:png|svg|ico|jpg|webp)$).*)'],
};
