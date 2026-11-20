import KnowledgeBase from '@/components/tatva/KnowledgeBase';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Knowledge Base' };

export default function KnowledgePage() {
  return <KnowledgeBase />;
}
