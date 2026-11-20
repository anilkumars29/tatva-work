import type { Metadata } from 'next';
import MeetingDetails from '@/components/tatva/MeetingDetails';
import { serverKey, serverUrl } from '@/lib/auth';

// The browser tab shows the meeting's title ("Q4 Vendor Review · Tatva").
// Server-to-server, so it sends the shared key like the /tatva proxy does.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const key = serverKey();
    const res = await fetch(`${serverUrl()}/api/meetings/${encodeURIComponent(id)}?transcript=false`, {
      cache: 'no-store',
      headers: key ? { 'x-tatva-key': key } : undefined,
    });
    if (res.status === 404) return { title: 'Meeting not found' };
    const { meeting } = (await res.json()) as { meeting?: { title?: string | null } };
    return { title: meeting?.title || 'Meeting' };
  } catch {
    return { title: 'Meeting' };
  }
}

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MeetingDetails id={id} />;
}
