import type { Metadata } from 'next';
import { PlanPicker } from '@/components/account/Growth';

export const metadata: Metadata = {
  title: 'Plans',
  description: 'NuTuYu account plans: Standard, Premium and Premium+. Every order has full buyer protection on every plan.',
  alternates: { canonical: '/plans' },
};

export default function PlansPage() {
  return (
    <section className="pv-section pv-plans-page" aria-labelledby="plans-h">
      <h1 id="plans-h">Plans</h1>
      <p className="pv-lead">Every plan has full buyer protection and the custody record on every order. Premium plans are for people who sell regularly.</p>
      <PlanPicker />
    </section>
  );
}
