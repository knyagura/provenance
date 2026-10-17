import type { Metadata } from 'next';
import { ItemPassport } from '@/components/market/ItemPassport';

export const metadata: Metadata = {
  title: 'Item Passport',
  description: 'The recorded history of an item sold on NuTuYu: its photos, protection level and each completed handover step, without anyone’s personal details.',
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ItemPassport listingId={(await params).id} />;
}
