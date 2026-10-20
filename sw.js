// Offline support: keep a copy of the app so it works with no signal.
// Recipes live in localStorage and photos of cards in IndexedDB, not here.
// Network first, so a new version shows up as soon as you're online.

const CACHE = 'from-scratch-v2'; // bump the number when the file list changes
const SHELL = [
  './', 'index.html', 'icon.svg', 'manifest.webmanifest',
  'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png',
  'css/app.css', 'fonts/figtree.woff2', 'fonts/fraunces.woff2', 'fonts/caveat.woff2',
  'js/app.js', 'js/cook.js', 'js/density.js', 'js/edit.js', 'js/ingredients.js', 'js/photos.js', 'js/print.js',
  'js/recipe-page.js', 'js/recipe.js', 'js/samples.js', 'js/share.js', 'js/store.js', 'js/sync.js', 'js/text.js',
  'js/timers.js', 'js/ui.js', 'js/units.js', 'js/view.js',
  'samples/rosa-card.jpg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

// Every tool at junkdrawer.works/REPO/ shares this origin's Cache Storage, so only this project's old copies go,
// by their exact names: a project called from-scratch-something keeps its own.
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && /^from-scratch-v[0-9]+$/.test(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fresh(e.request)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))),
  );
});

// GitHub Pages lets browsers keep files for ten minutes, so without this an update can take that long to show up.
// Ask the server every time instead; a file that hasn't changed comes back as a quick "not modified".
function fresh(request) {
  const got = request.mode === 'navigate'
    // A page load can't be answered with a redirected response, so fall back to the plain request if there was one.
    ? fetch(request.url, { cache: 'no-cache' }).then(res => (res.redirected ? fetch(request) : res))
    : fetch(request, { cache: 'no-cache' });
  return got.then(askAgainNextTime);
}

// The open tab keeps its own copy of each file too, and would reuse it on a reload without asking.
// Marking the copy it gets from here no-cache sends that reload back through fresh() as well.
function askAgainNextTime(res) {
  if (res.status !== 200 || res.type !== 'basic' || res.redirected) return res;
  const headers = new Headers(res.headers);
  headers.set('cache-control', 'no-cache');
  headers.delete('content-encoding'); // the body here is already unpacked
  headers.delete('content-length');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
