import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'NuTuYu',
    short_name: 'NuTuYu',
    description: 'Buy and sell pre-loved things, with every handover recorded.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F9F7F3',
    theme_color: '#5C6A4B',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Inbox', url: '/inbox' },
      { name: 'Sell an item', url: '/sell' },
      { name: 'Saved items', url: '/saved' },
    ],
  };
}
