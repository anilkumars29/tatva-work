import Dashboard from '@/components/tatva/Dashboard';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Dashboard' };

export default function Home() {
  return <Dashboard />;
}
