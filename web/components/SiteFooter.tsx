import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="pv-footer">
      <nav aria-label="More">
        <ul>
          <li><Link href="/developers">Developers and API</Link></li>
          <li><Link href="/styleguide">Style guide</Link></li>
          <li><a href="https://knyagura.github.io/provenance/">The working prototype</a></li>
        </ul>
      </nav>
      <p className="pv-note">Provenance is being built in stages. Buying and selling arrive in the next steps.</p>
    </footer>
  );
}
