import type { Metadata } from 'next';
import MeetingDetails from '@/components/tatva/MeetingDetails';

// The browser tab shows the meeting's title ("Q4 Vendor Review · Tatva").
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const res = await fetch(`${process.env.TATVA_SERVER_URL ?? 'http://localhost:4000'}/api/meetings/${encodeURIComponent(id)}?transcript=false`, { cache: 'no-store' });
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
