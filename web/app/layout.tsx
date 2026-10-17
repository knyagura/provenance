import type { Metadata, Viewport } from 'next';
import '@fontsource/newsreader/500.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import './tokens.css';
import './globals.css';
import './browse.css';
import './sell.css';
import './baskets.css';
import '@/components/ui/ui.css';
import { BottomNav, TopBar } from '@/components/ui';
import { SiteFooter } from '@/components/SiteFooter';
import { MemberProvider } from '@/components/auth/MemberProvider';
import { MarketStateProvider } from '@/components/market/MarketState';
import { ServiceWorker } from '@/components/pwa/InstallApp';
import { BasketsProvider } from '@/components/baskets/BasketsState';
import { BasketRail } from '@/components/baskets/BasketRail';
import { config } from '@/lib/config';

export const metadata: Metadata = {
  metadataBase: new URL(config.siteUrl),
  title: { default: 'NuTuYu', template: '%s · NuTuYu' },
  description: 'Pre-loved, with proof. A second-hand marketplace where every item carries its chain of custody.',
  applicationName: 'NuTuYu',
  appleWebApp: { title: 'NuTuYu', capable: true, statusBarStyle: 'default' },
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
        <a className="pv-skip" href="#main">Skip to content</a>
        <MemberProvider>
          <MarketStateProvider>
          <BasketsProvider>
          <TopBar />
          <main className="pv-main" id="main">
            {children}
            <SiteFooter />
          </main>
          <BottomNav />
          <BasketRail />
          <ServiceWorker />
          </BasketsProvider>
          </MarketStateProvider>
        </MemberProvider>
      </body>
    </html>
  );
}
