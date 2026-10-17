import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ContactForm } from '@/components/ContactForm';

export const metadata: Metadata = { title: 'Contact', description: 'Ask NuTuYu about your account, an order, or your privacy.' };

export default function ContactPage() {
  return (
    <section className="pv-section pv-narrow">
      <h1>Contact NuTuYu</h1>
      <p className="pv-lead">Questions about an order, your account or your privacy. We reply by email, usually within two working days.</p>
      <Suspense fallback={null}>
        <ContactForm />
      </Suspense>
    </section>
  );
}
