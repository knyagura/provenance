import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Terms', description: 'The rules for buying and selling on NuTuYu.' };

export default function TermsPage() {
  return (
    <article className="pv-doc pv-legal">
      <header className="pv-section">
        <p className="pv-eyebrow">Terms</p>
        <h1>Terms of use</h1>
        <p className="pv-lead">The short version: describe items honestly, record each handover step truthfully, and pay through NuTuYu so both sides are protected.</p>
        <p className="pv-note">Last updated 17 October 2026.</p>
      </header>
      <section className="pv-section" aria-labelledby="t-acc">
        <h2 id="t-acc">Your account</h2>
        <p>You must be 18 or over. Keep your sign-in safe; you’re responsible for what happens on your account. One person, one account.</p>
      </section>
      <section className="pv-section" aria-labelledby="t-sell">
        <h2 id="t-sell">Selling</h2>
        <p>List only items you own and are allowed to sell. Photos and descriptions must show the actual item and any faults. No counterfeit, stolen, unsafe or prohibited items.</p>
      </section>
      <section className="pv-section" aria-labelledby="t-buy">
        <h2 id="t-buy">Buying and fees</h2>
        <p>The price you see at checkout includes the item, postage, the buyer protection fee and the processing fee. Each fee is shown on its own line before you pay. Payment is held until the buyer confirms the item, or until the protection window ends.</p>
      </section>
      <section className="pv-section" aria-labelledby="t-custody">
        <h2 id="t-custody">Handover steps</h2>
        <p>Each step in an order’s handover (photos, videos, seals, weights) becomes part of a record that can’t be changed afterwards. Record steps truthfully. Faking evidence ends your account.</p>
      </section>
      <section className="pv-section" aria-labelledby="t-disputes">
        <h2 id="t-disputes">Problems and disputes</h2>
        <p>If something isn’t as described, report it from the order before you confirm. NuTuYu staff look at the recorded evidence and decide whether the payment goes to the seller or back to the buyer.</p>
      </section>
      <section className="pv-section" aria-labelledby="t-more">
        <h2 id="t-more">Everything else</h2>
        <p>We may suspend accounts that break these terms. These terms are governed by the law of England and Wales. Read how we handle your information in our <Link href="/privacy">privacy notice</Link>. For questions, use the <Link href="/contact">contact form</Link>.</p>
      </section>
    </article>
  );
}
