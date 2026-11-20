import { Suspense } from 'react';
import Tracker from '@/components/tatva/Tracker';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Tracker' };

export default function TrackerPage() {
  // useSearchParams (?view=, ?filter=) needs a Suspense boundary.
  return (
    <Suspense>
      <Tracker />
    </Suspense>
  );
}
