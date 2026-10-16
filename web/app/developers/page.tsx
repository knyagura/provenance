import type { Metadata } from 'next';
import { RATE_LIMIT_PER_MINUTE } from '@/lib/api/auth';
import { openApi } from '@/lib/api/openapi';
import { SCOPES } from '@/lib/api/keys';
import { config } from '@/lib/config';

export const metadata: Metadata = {
  title: 'Developers',
  description: 'The NuTuYu API: read the catalogue from your own shop or tools.',
};

type Param = { name: string; schema: { type?: string; enum?: readonly string[] }; description?: string };

const PROBLEMS: [string, number, string][] = [
  ['invalid-request', 400, 'A parameter is wrong. "errors" lists each one and why.'],
  ['unauthenticated', 401, 'No key, a mistyped key, or a revoked key.'],
  ['forbidden', 403, 'The key works but lacks the scope this call needs.'],
  ['not-found', 404, 'No such listing, or no such endpoint.'],
  ['rate-limited', 429, `More than ${RATE_LIMIT_PER_MINUTE} calls in a minute. Wait for the number of seconds in Retry-After.`],
  ['unavailable', 503, 'Something on our side is down. Try again shortly.'],
];

const COMING: [string, string][] = [
  ['Inventory and listings (write)', 'Create, update and end listings; webhooks when an item sells.'],
  ['Orders and custody', 'Read orders and each custody step as it is recorded.'],
  ['Messages and offers', 'Answer buyers and respond to offers from your own tools.'],
  ['Item passport', 'Check an item’s history by its Item ID; a service other shops can use.'],
  ['Payouts and analytics', 'Premium+: payout reports, margins, Xero and QuickBooks exports.'],
];

export default function DevelopersPage() {
  const spec = openApi(config.siteUrl);
  const base = `${config.siteUrl}/api/v1`;
  return (
    <div className="pv-doc">
      <header className="pv-section">
        <p className="pv-eyebrow">Developers</p>
        <h1>NuTuYu API</h1>
        <p className="pv-lead">
          Read the catalogue from your own shop, spreadsheet or tools. Our own website runs on the same code, so what
          you see here is what the site sees.
        </p>
      </header>

      <section className="pv-section" aria-labelledby="keys">
        <h2 id="keys">Keys</h2>
        <p>
          Premium and Premium+ members create keys in their account settings (that screen arrives with accounts). Each
          key has scopes, is shown once when you make it, and can be revoked at any time. Send it with every call:
        </p>
        <pre className="pv-code" tabIndex={0}><code>{`curl ${base}/listings?q=barbour \\
  -H "Authorization: Bearer pv_live_XXXXXXXX_…"`}</code></pre>
        <p>
          Each key can make <strong>{RATE_LIMIT_PER_MINUTE} calls a minute</strong>. Every response says how many are
          left in <code>RateLimit-Remaining</code>.
        </p>
        <p className="pv-note">Scopes: {SCOPES.join(', ')}.</p>
      </section>

      <section className="pv-section" aria-labelledby="endpoints">
        <h2 id="endpoints">Endpoints available now</h2>
        {Object.entries(spec.paths).map(([path, ops]) =>
          Object.entries(ops).map(([method, op]) => (
            <article key={`${method} ${path}`} className="pv-endpoint">
              <h3>
                <span className="pv-endpoint__method">{method.toUpperCase()}</span>{' '}
                <code>/api/v1{path}</code>
              </h3>
              <p>{op.summary}. {'description' in op ? op.description : null}</p>
              <p className="pv-note">Needs the <code>{op['x-scope']}</code> scope.</p>
              {'parameters' in op && op.parameters.length ? (
                <div className="pv-table-wrap" tabIndex={0} role="region" aria-label={`Parameters for ${path}`}>
                  <table className="pv-table">
                    <thead><tr><th scope="col">Parameter</th><th scope="col">Type</th><th scope="col">About</th></tr></thead>
                    <tbody>
                      {(op.parameters as Param[]).map((p) => (
                        <tr key={p.name}>
                          <td><code>{p.name}</code></td>
                          <td>{p.schema.enum ? p.schema.enum.join(' | ') : p.schema.type}</td>
                          <td>{p.description ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </article>
          )),
        )}
        <p>
          The full description is at <a href="/api/v1/openapi.json">/api/v1/openapi.json</a> (OpenAPI 3.1). Most tools can
          generate a client from it.
        </p>
      </section>

      <section className="pv-section" aria-labelledby="errors">
        <h2 id="errors">Errors</h2>
        <p>Errors come back as <code>application/problem+json</code> with a title, a status and a plain-English detail.</p>
        <div className="pv-table-wrap" tabIndex={0} role="region" aria-label="Error types">
          <table className="pv-table">
            <thead><tr><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Meaning</th></tr></thead>
            <tbody>
              {PROBLEMS.map(([code, status, meaning]) => (
                <tr key={code} id={`problem-${code}`}><td><code>{code}</code></td><td>{status}</td><td>{meaning}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="pv-section" aria-labelledby="coming">
        <h2 id="coming">Coming next</h2>
        <ul className="pv-list">
          {COMING.map(([t, d]) => <li key={t}><strong>{t}.</strong> {d}</li>)}
        </ul>
      </section>

      <section className="pv-section" aria-labelledby="rules">
        <h2 id="rules">What the API will never do</h2>
        <ul className="pv-list">
          <li>Buy or make offers automatically.</li>
          <li>Let anyone copy the whole catalogue. Paging stops after 1,000 results; narrow the search instead.</li>
          <li>Mark a custody step as done. Only the people present can do that, in the app.</li>
          <li>Share personal details beyond what the member has agreed to.</li>
        </ul>
      </section>
    </div>
  );
}
