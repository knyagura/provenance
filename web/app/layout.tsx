import type { Metadata, Viewport } from 'next';
import '@fontsource/newsreader/500.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import './tokens.css';
import './globals.css';
import './browse.css';
import '@/components/ui/ui.css';
import { BottomNav, TopBar } from '@/components/ui';
import { SiteFooter } from '@/components/SiteFooter';
import { config } from '@/lib/config';

export const metadata: Metadata = {
  metadataBase: new URL(config.siteUrl),
  title: { default: 'Provenance', template: '%s · Provenance' },
  description: 'Pre-loved, with proof. A second-hand marketplace where every item carries its chain of custody.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F3EEE7' },
    { media: '(prefers-color-scheme: dark)', color: '#23211D' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <TopBar />
        <main className="pv-main" id="main">
          {children}
          <SiteFooter />
        </main>
        <BottomNav />
      </body>
    </html>
  );
}
