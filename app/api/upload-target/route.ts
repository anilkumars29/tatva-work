import { NextResponse } from 'next/server';
import { mintUploadToken, serverKey, serverUrl } from '@/lib/auth';

/**
 * Where the browser sends file uploads. Vercel functions accept request bodies
 * up to 4.5 MB, so files (PDFs up to 25 MB, images up to 15 MB) go straight to
 * server/ with a 10-minute upload token. Without a server key (local dev) the
 * browser uses the /tatva proxy instead. Protected by the session (proxy.ts).
 */
export async function GET() {
  if (!serverKey()) return NextResponse.json({ base: '/tatva', token: null });
  return NextResponse.json({ base: `${serverUrl()}/api`, token: await mintUploadToken() }, { headers: { 'Cache-Control': 'no-store' } });
}
