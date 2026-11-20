import MeetingsList from '@/components/tatva/MeetingsList';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Meetings' };

export default function MeetingsPage() {
  return <MeetingsList />;
}
