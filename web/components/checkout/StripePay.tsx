'use client';

import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { useMemo, useState } from 'react';
import { formatPence } from '@/lib/format';

const cache = new Map<string, Promise<Stripe | null>>();
function stripeFor(key: string) {
  if (!cache.has(key)) cache.set(key, loadStripe(key));
  return cache.get(key)!;
}

/** Stripe's card form. Card details go straight to Stripe; they never touch NuTuYu. */
export function StripePay(props: { clientSecret: string; publishableKey: string; amountPence: number; orderId: string; onPaid: () => void; returnPath?: string }) {
  const stripe = useMemo(() => stripeFor(props.publishableKey), [props.publishableKey]);
  return (
    <Elements
      stripe={stripe}
      options={{
        clientSecret: props.clientSecret,
        appearance: {
          theme: 'stripe',
          variables: { colorPrimary: '#9C5238', colorText: '#3E3B33', colorDanger: '#A13A2E', fontFamily: '"IBM Plex Sans", system-ui, sans-serif', borderRadius: '6px' },
        },
      }}
    >
      <PayForm {...props} />
    </Elements>
  );
}

function PayForm({ amountPence, orderId, onPaid, returnPath }: { amountPence: number; orderId: string; onPaid: () => void; returnPath?: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const { error: err } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}${returnPath ?? `/orders/${orderId}?paid=1`}` },
      redirect: 'if_required',
    });
    setBusy(false);
    if (err) setError(err.message ?? 'The payment didn’t go through. Try again or use another card.');
    else onPaid();
  }

  return (
    <form className="pv-form" onSubmit={pay}>
      <PaymentElement />
      {error ? <p className="pv-errors" role="alert">{error}</p> : null}
      <button type="submit" className="pv-btn pv-btn--primary pv-btn--block" disabled={!stripe || busy}>
        {busy ? 'Paying…' : `Pay ${formatPence(amountPence)}`}
      </button>
    </form>
  );
}
