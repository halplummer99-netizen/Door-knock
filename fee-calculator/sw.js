// The stand-alone Fee Calculator has been folded into the main Griffin app.
// This retires its old offline copy: clear its caches, unregister, and reload
// any open window so it lands on the redirect page.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('fee-')).map((k) => caches.delete(k)));
    await self.registration.unregister();
    const wins = await self.clients.matchAll({ type: 'window' });
    for (const w of wins) w.navigate(w.url);
  })());
});
