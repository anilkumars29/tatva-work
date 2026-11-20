import { Suspense } from 'react';
import TalkToTatva from '@/components/tatva/talk/TalkToTatva';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Talk to Tatva' };

export default function TalkPage() {
  // useSearchParams (?meeting=, ?brief=) needs a Suspense boundary.
  return (
    <Suspense>
      <TalkToTatva />
    </Suspense>
  );
}
