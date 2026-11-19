// PNUtify service worker: push notifications only (no offline caching).
const VERSION = 'v3';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: 'PNUtify', body: 'You have a new update.', url: '/', tag: undefined };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      // Same tag = the new notification replaces the old one instead of stacking a duplicate.
      tag: data.tag,
      renotify: false,
      data: { url: data.url || '/', version: VERSION },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Reuse an open PNUtify window: tell it where to go, then focus it.
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        client.postMessage({ type: 'open', url: target });
        try {
          await client.focus();
          return;
        } catch {
          // Focus can be refused; fall through and open a new window.
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
