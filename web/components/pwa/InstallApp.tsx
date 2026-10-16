'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';

type Prompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

/** Registers the service worker once, site-wide. */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  return null;
}

/** "Install the app": the browser's own prompt where there is one, and a short how-to on iPhone. */
export function InstallApp() {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    setInstalled(window.matchMedia('(display-mode: standalone)').matches);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as Prompt);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return <p className="pv-note">NuTuYu is installed on this device.</p>;
  if (prompt) {
    return (
      <Button variant="secondary" onClick={async () => { await prompt.prompt(); const c = await prompt.userChoice; if (c.outcome === 'accepted') setInstalled(true); setPrompt(null); }}>
        Install the NuTuYu app
      </Button>
    );
  }
  if (ios) return <p className="pv-note">To install NuTuYu, tap Share, then “Add to Home Screen”.</p>;
  return null;
}
