import { ImageResponse } from 'next/og';
import { getListing } from '@/lib/domain/catalogue';
import { formatPence } from '@/lib/format';

// The picture shown when an item link is shared (WhatsApp, iMessage, social). Used when there is no photo.
export const alt = 'Item on Provenance';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const l = await getListing((await params).id).catch(() => null);
  const title = l?.title ?? 'Pre-loved, with proof.';
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 72, background: '#F3EEE7', color: '#3E3B33' }}>
        <div style={{ fontSize: 40, fontFamily: 'serif' }}>Provenance</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 72, lineHeight: 1.1, fontFamily: 'serif' }}>{title}</div>
          {l ? <div style={{ fontSize: 48, fontWeight: 600 }}>{formatPence(l.pricePence)}</div> : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 30 }}>
          <div style={{ width: 28, height: 28, borderRadius: 14, background: '#B7BFAA' }} />
          Sold with its chain of custody
        </div>
      </div>
    ),
    size,
  );
}
