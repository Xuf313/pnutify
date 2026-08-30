self.addEventListener('push', (event) => {
  let data = { title: 'New PNU Notice', body: 'You have a new notice.', url: '/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon.png',
      badge: '/icon.png',
      data: { url: data.url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  // Always open/navigate to this notification's own target. The previous
  // version reused an already-open window with a plain focus() and never
  // told it where to go, so every notification after the first landed on a
  // stale screen instead of its own notice.
  event.waitUntil(self.clients.openWindow(url));
});