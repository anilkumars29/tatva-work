import { Suspense } from 'react';
import MeetingsList from '@/components/tatva/MeetingsList';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Meetings' };

export default function MeetingsPage() {
  // useSearchParams (?sort=) needs a Suspense boundary.
  return (
    <Suspense>
      <MeetingsList />
    </Suspense>
  );
}
