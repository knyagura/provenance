import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What NuTuYu collects, why, who it is shared with, how long it is kept and your rights.',
};

const UPDATED = '17 October 2026';

export default function PrivacyPage() {
  return (
    <article className="pv-doc pv-legal">
      <header className="pv-section">
        <p className="pv-eyebrow">Privacy</p>
        <h1>Your privacy on NuTuYu</h1>
        <p className="pv-lead">NuTuYu is a marketplace for pre-loved things where every handover is recorded. This page explains what we collect to run it, why, who else handles it, how long we keep it, and what you can ask us to do.</p>
        <p className="pv-note">Last updated {UPDATED}.</p>
      </header>

      <section className="pv-section" aria-labelledby="p-who">
        <h2 id="p-who">Who we are</h2>
        <p>NuTuYu is responsible (the “controller”) for the personal information described here. To ask about your information, or to use any of your rights, use the <Link href="/contact?topic=privacy">contact form</Link> and choose “Privacy”.</p>
      </section>

      <section className="pv-section" aria-labelledby="p-what">
        <h2 id="p-what">What we collect, and why</h2>
        <ul className="pv-list">
          <li><strong>Your account:</strong> email address, username, and your password (stored only as a secure hash) or passkey. If you sign in with Google or Facebook, we receive your name and email address from them, nothing else. <em>Why:</em> to give you an account and keep it secure.</li>
          <li><strong>Your profile:</strong> anything you choose to add, such as a bio or holiday mode. Your username, listings and reviews are public.</li>
          <li><strong>Listings:</strong> titles, descriptions, prices, photos and videos you upload. <em>Why:</em> to show your items to buyers.</li>
          <li><strong>Orders and custody records:</strong> what was bought and sold, prices and fees, and each handover step: photos, videos, seal codes, parcel weights, tracking numbers and when each step happened. <em>Why:</em> to carry out the sale, protect both sides, and settle disputes with evidence.</li>
          <li><strong>Messages, offers and reviews</strong> between buyers and sellers, kept with the order. <em>Why:</em> so both sides, and our staff if there is a problem, can see what was agreed.</li>
          <li><strong>Baskets and gifts:</strong> the people you shop for, the sizes, budgets and notes you enter, and a delivery address if you add one. <em>Why:</em> to run multi-basket shopping and send gifts. Only the sellers of an item see the delivery address, and only after you have paid.</li>
          <li><strong>Payments</strong> are handled by Stripe. Your card details go straight to Stripe and never reach NuTuYu; we only see that a payment succeeded.</li>
          <li><strong>Contact form messages</strong>: your name, email and message, so we can reply.</li>
        </ul>
        <p>We use this information to provide the service you asked for (our contract with you), to meet legal duties such as keeping sales records, and for our legitimate interest in preventing fraud and keeping the marketplace safe.</p>
        <p>We don’t sell your information. We don’t show advertising or use advertising trackers, and we don’t use third-party analytics.</p>
      </section>

      <section className="pv-section" aria-labelledby="p-who-else">
        <h2 id="p-who-else">Who else handles it</h2>
        <ul className="pv-list">
          <li><strong>Supabase</strong>: our database, sign-in and file storage.</li>
          <li><strong>Netlify</strong>: hosts the website.</li>
          <li><strong>Stripe</strong>: takes payments.</li>
          <li><strong>Google and Facebook</strong>: only if you choose to sign in with them.</li>
          <li><strong>Have I Been Pwned</strong>: when you choose a password, we check it hasn’t appeared in a data breach. Only the first five characters of a scrambled version of the password are sent, never the password itself.</li>
          <li><strong>The other person in a sale</strong>, plus couriers and authentication hubs for the steps they carry out. Each sees only what their step needs.</li>
          <li><strong>NuTuYu staff</strong>, who can see an order’s full record when settling a problem. Everything they do is logged.</li>
        </ul>
        <p>Some of these providers may store information outside the UK. Where they do, they use the safeguards UK law requires.</p>
      </section>

      <section className="pv-section" aria-labelledby="p-public">
        <h2 id="p-public">What is public</h2>
        <p>Your username, listings, public profile and reviews. Each item’s <strong>Item Passport</strong> shows its photos, protection level and each completed handover step with its date and whether seals matched. It never shows names, codes, weights, videos or tracking numbers.</p>
      </section>

      <section className="pv-section" aria-labelledby="p-device">
        <h2 id="p-device">On your device</h2>
        <p>We keep only what the site needs to work: your sign-in session and a few settings, such as your basket view. We don’t use cookies or local storage for advertising or tracking.</p>
      </section>

      <section className="pv-section" aria-labelledby="p-keep">
        <h2 id="p-keep">How long we keep it</h2>
        <p>We keep your account while you have one. Orders, payments and their custody records are kept for as long as the law requires for sales records, typically six years, because they are the evidence for the sale. Contact form messages are kept for up to two years. When you close your account, we delete or anonymise the rest.</p>
      </section>

      <section className="pv-section" aria-labelledby="p-rights">
        <h2 id="p-rights">Your rights</h2>
        <p>You can ask us to give you a copy of your information, correct it, delete it, limit how we use it, object to how we use it, or send it to you in a portable format. Use the <Link href="/contact?topic=privacy">contact form</Link>. We’ll reply within one month.</p>
        <p>If you’re unhappy with how we’ve handled your information, you can complain to the Information Commissioner’s Office at <a href="https://ico.org.uk/make-a-complaint/">ico.org.uk</a>.</p>
      </section>

      <section className="pv-section" aria-labelledby="p-children">
        <h2 id="p-children">Children</h2>
        <p>NuTuYu is for people aged 18 and over.</p>
      </section>

      <section className="pv-section" aria-labelledby="p-changes">
        <h2 id="p-changes">Changes</h2>
        <p>If we change this page in a way that matters, we’ll tell you on the site before the change takes effect.</p>
      </section>
    </article>
  );
}
