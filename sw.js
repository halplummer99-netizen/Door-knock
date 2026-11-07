// Door Knock service worker: offline app shell + Android share target.
// Bump VERSION whenever the app files change so phones pick up the new copy.
const VERSION = 'dk-v7';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache so a new version gets fresh files.
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // Google APIs go straight to the network

  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith(handleShare(e.request));
    return;
  }
  if (e.request.method !== 'GET') return;

  // Serve from cache instantly (works with no signal), refresh the cache in the background.
  const key = e.request.mode === 'navigate' ? './index.html' : e.request;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(key, { ignoreSearch: true });
      const fresh = fetch(e.request.url, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      if (cached) {
        e.waitUntil(fresh.catch(() => {}));
        return cached;
      }
      return fresh;
    })
  );
});

// Share target: stash what was shared in IndexedDB, then open the app, which picks it up.
async function handleShare(request) {
  try {
    const form = await request.formData();
    const files = [];
    for (const f of form.getAll('file')) {
      if (f && typeof f.text === 'function') files.push({ name: f.name || 'shared.csv', text: await f.text() });
    }
    await kvPut('pendingShare', {
      title: form.get('title') || '',
      text: form.get('text') || '',
      url: form.get('url') || '',
      files,
      at: Date.now()
    });
  } catch (err) {
    // Fall through and open the app anyway.
  }
  return Response.redirect(new URL('./?share=1', self.registration.scope).href, 303);
}

// Same database and schema as app.js.
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('doorknock', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('runs')) db.createObjectStore('runs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kvPut(key, value) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
