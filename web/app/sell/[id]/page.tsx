import type { Metadata } from 'next';
import { DraftEditor } from '@/components/sell/DraftEditor';

export const metadata: Metadata = { title: 'Your draft', robots: { index: false } };

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DraftEditor id={id} />;
}
