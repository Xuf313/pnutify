import type { MetadataRoute } from 'next';

// Required for "Add to Home Screen" as a real app, and for push
// notifications on iPhone (iOS only allows web push for installed apps).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'PNUtify — PNU notices, deadlines & daily briefing',
    short_name: 'PNUtify',
    description: 'Your department and International notices, your deadlines and a daily briefing for Pusan National University students.',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#EEF3FD',
    theme_color: '#143F90',
    lang: 'en',
    categories: ['education', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
