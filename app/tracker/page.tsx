import Tracker from '@/components/tatva/Tracker';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Tracker' };

export default function TrackerPage() {
  return <Tracker />;
}
