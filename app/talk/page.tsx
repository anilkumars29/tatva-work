import { Suspense } from 'react';
import TalkToTatva from '@/components/tatva/talk/TalkToTatva';

export default function TalkPage() {
  // useSearchParams (?meeting=, ?brief=) needs a Suspense boundary.
  return (
    <Suspense>
      <TalkToTatva />
    </Suspense>
  );
}
