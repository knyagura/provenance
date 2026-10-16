import Link from 'next/link';
import { LogoMark } from '@/components/ui';

export function SiteFooter() {
  return (
    <footer className="pv-footer">
      <div className="pv-footer__brand">
        <LogoMark className="pv-footer__mark" />
        <span>
          <strong>NuTuYu</strong>
          <span className="pv-note">Pre-loved, with proof.</span>
        </span>
      </div>
      <nav aria-label="More">
        <ul>
          <li><Link href="/search">Browse</Link></li>
          <li><Link href="/sell">Sell</Link></li>
          <li><Link href="/developers">Developers and API</Link></li>
          <li><Link href="/styleguide">Style guide</Link></li>
          <li><a href="https://knyagura.github.io/provenance/">The working prototype</a></li>
        </ul>
      </nav>
      <p className="pv-note">NuTuYu is being built in stages. You can list, buy and hand items over with their custody record now.</p>
    </footer>
  );
}
