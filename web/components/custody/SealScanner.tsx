'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { normaliseSeal } from '@/lib/domain/custody';

/** Seal labels carry a QR code of "nutuyu:seal:<code>". A bare code also scans. */
export function sealFromQr(text: string): string | null {
  const m = text.trim().match(/^(?:nutuyu:seal:)?([A-Za-z0-9]{2}-?[A-Za-z0-9]{4}-?[A-Za-z0-9]{4})$/i);
  return m ? normaliseSeal(m[1]) : null;
}

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

/** Opens the back camera and reads the seal's QR code. Typing the code always still works. */
export function SealScanner({ onCode }: { onCode: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const cb = useRef(onCode);
  useEffect(() => {
    cb.current = onCode;
  }, [onCode]);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let raf = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch {
        setMsg('We couldn’t open the camera. Allow camera access, or type the code instead.');
        setOpen(false);
        return;
      }
      const v = video.current;
      if (!v || stopped) return;
      v.srcObject = stream;
      await v.play().catch(() => {});
      const Native = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
      const native = Native ? new Native({ formats: ['qr_code'] }) : null;
      const jsQR = native ? null : (await import('jsqr')).default;

      const tick = async () => {
        if (stopped || !v.videoWidth) {
          raf = requestAnimationFrame(tick);
          return;
        }
        let text: string | null = null;
        if (native) {
          const found = await native.detect(v).catch(() => []);
          text = found[0]?.rawValue ?? null;
        } else if (jsQR && ctx) {
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          ctx.drawImage(v, 0, 0);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          text = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
        }
        const code = text ? sealFromQr(text) : null;
        if (code) {
          cb.current(code);
          setMsg(`Read ${code}.`);
          setOpen(false);
          return;
        }
        if (text) setMsg('That QR code isn’t a NuTuYu seal.');
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open]);

  const canScan = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  if (!canScan) return null;
  return (
    <div className="pv-scan">
      {open ? (
        <>
          <video ref={video} className="pv-scan__video" muted playsInline aria-label="Camera view. Point it at the seal’s QR code." />
          <Button variant="quiet" onClick={() => setOpen(false)}>Stop scanning</Button>
        </>
      ) : (
        <Button variant="secondary" onClick={() => { setMsg(null); setOpen(true); }}>Scan the seal’s QR code</Button>
      )}
      {msg ? <span className="pv-note" role="status">{msg}</span> : null}
    </div>
  );
}
