'use client';

/** Last resort, when even the site's frame fails. Plain HTML so it can't fail the same way. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en-GB">
      <body style={{ margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16, background: '#F3EEE7', color: '#3E3B33', font: '16px/1.5 system-ui, sans-serif' }}>
        <main style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1>NuTuYu is having a moment</h1>
          <p>Something went wrong loading the site. Anything you’ve recorded or paid for is safe.</p>
          <button type="button" onClick={reset} style={{ minHeight: 44, padding: '0 20px', borderRadius: 999, border: 0, background: '#5C6A4B', color: '#fff', font: 'inherit', fontWeight: 600, cursor: 'pointer' }}>Try again</button>
        </main>
      </body>
    </html>
  );
}
