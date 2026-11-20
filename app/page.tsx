import Dashboard from '@/components/tatva/Dashboard';
import type { Metadata } from 'next';

// The root segment's own title skips the layout's "%s · Tatva" template.
export const metadata: Metadata = { title: { absolute: 'Dashboard · Tatva' } };

export default function Home() {
  return <Dashboard />;
}
