// Saving the recipe box to Google Drive, so it follows a person from device to device.
// The box in this browser stays the working copy and the page never waits for Drive. When sync is on, the
// recipes are copied into one file, "From Scratch recipes.json", in a "From Scratch" folder in the person's
// own Drive, and what their other devices saved there is merged in, recipe by recipe (newest change wins,
// removals are kept as markers). Photos of cards stay on the device they were added on.
// Nothing about this shows away from https://junkdrawer.works, the one address Google accepts this client from.
import { box } from './store.js';
import { mergeBoxes, cleanBox, canon } from './recipe.js';
import { esc, icon } from './ui.js';

// The junkdrawer.works OAuth client, shared by every junkdrawer.works project (Shelfmark, Terraville, Lotería).
const ORIGINS = ['https://junkdrawer.works'];
const CLIENT_ID = '897653851078-p5jrh2bto6h3bj0lc4jist3k1vsc1pj4.apps.googleusercontent.com';
// drive.file: Google lets the projects on this client see only the files they made themselves.
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/';
const FOLDER = { name: 'From Scratch', mimeType: 'application/vnd.google-apps.folder', appProperties: { fromscratch: 'folder' } };
const FILE = { name: 'From Scratch recipes.json', mimeType: 'application/json', appProperties: { fromscratch: 'recipes' } };
// KT is shared by every junkdrawer.works project: one sign-in, good for an hour, serves them all.
const KT = 'junkdrawer.google', KS = 'fromscratch.drive';
const RETRY = { retry: true };

export const available = () => ORIGINS.includes(location.origin) && !('single' in document.documentElement.dataset);

const get = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const put = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };
const fresh = () => ({ on: false, email: '', fileId: '', version: '', last: 0, pending: false });

let st = { ...fresh(), ...(get(KS) || {}) };
let tok = get(KT);
let status = 'off', note = '', busy = null, again = false, client = null, gisLoading = false, soon = null;
const watchers = new Set();
const saveSt = () => put(KS, st);

function live() {
  tok = get(KT);
  return !!(tok && tok.token && tok.exp - 60000 > Date.now() && String(tok.scope || '').includes(SCOPE));
}
function setStatus(s, n = '') { status = s; note = n; watchers.forEach(f => { try { if (f() === false) watchers.delete(f); } catch { watchers.delete(f); } }); }

// ---------- Drive calls ----------
async function api(method, path, body, type) {
  if (!tok?.token) throw { auth: true };
  const headers = { Authorization: 'Bearer ' + tok.token };
  if (type) headers['Content-Type'] = type;
  let r;
  try { r = await fetch(API + path, { method, headers, body }); } catch { throw { net: true }; }
  if (r.status === 401) {
    const g = get(KT);
    if (g && g.token === tok.token) put(KT, null);
    tok = null;
    throw { auth: true };
  }
  if (r.status === 404) throw { gone: true };
  if (!r.ok) throw { http: r.status };
  return r.status === 204 ? null : r.json();
}
async function find(meta, fields) {
  const [k, v] = Object.entries(meta.appProperties)[0];
  const q = `appProperties has { key='${k}' and value='${v}' } and trashed=false`;
  const x = await api('GET', `drive/v3/files?spaces=drive&orderBy=createdTime&pageSize=10&fields=${encodeURIComponent(`files(${fields})`)}&q=${encodeURIComponent(q)}`);
  return x?.files || [];
}
async function download(id) {
  const tokNow = tok;
  const r = await fetch(`${API}drive/v3/files/${id}?alt=media`, { headers: { Authorization: 'Bearer ' + tokNow.token } }).catch(() => { throw { net: true }; });
  if (r.status === 401) { put(KT, null); tok = null; throw { auth: true }; }
  if (r.status === 404) throw { gone: true };
  if (!r.ok) throw { http: r.status };
  const text = await r.text();
  let o = null;
  try { o = JSON.parse(text); } catch { /* checked below */ }
  if (!o || !o.fromScratch || !o.box) throw { bad: true };
  return cleanBox(o.box);
}
const body = b => JSON.stringify({ fromScratch: 1, box: b });
async function folderId() {
  const found = await find(FOLDER, 'id');
  if (found.length) return found[0].id;
  return (await api('POST', 'drive/v3/files?fields=id', JSON.stringify(FOLDER), 'application/json')).id;
}
async function create(b) {
  const dir = await folderId();
  const bd = 'fromscratch' + Date.now().toString(36);
  const meta = { ...FILE, parents: [dir] };
  const payload = `--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${bd}\r\nContent-Type: application/json\r\n\r\n${body(b)}\r\n--${bd}--`;
  const x = await api('POST', 'upload/drive/v3/files?uploadType=multipart&fields=id,version', payload, `multipart/related; boundary=${bd}`);
  return { id: x.id, version: String(x.version) };
}
// The recipes file, by the id this device remembers or by its appProperties. If two devices each made one
// before either could see the other's, their recipes are merged here and the extra files go to the Drive trash.
async function findFile() {
  if (st.fileId) {
    try {
      const f = await api('GET', `drive/v3/files/${st.fileId}?fields=id,version,trashed`);
      if (f && !f.trashed) return { id: f.id, version: String(f.version), extra: null };
    } catch (e) { if (!e.gone) throw e; }
  }
  const files = await find(FILE, 'id,version');
  if (!files.length) return null;
  return { id: files[0].id, version: String(files[0].version), extra: files.slice(1) };
}

// ---------- one sync ----------
async function run(tries = 0) {
  try {
    const seq = box.seq;
    const file = await findFile();
    let local = box.state;
    if (file?.extra?.length) {
      for (const x of file.extra) {
        local = mergeBoxes(local, await download(x.id));
        await api('PATCH', `drive/v3/files/${x.id}`, JSON.stringify({ trashed: true }), 'application/json');
      }
    }
    // Nothing new on either side since the last sync: nothing to do.
    if (file && file.id === st.fileId && file.version === st.version && !st.pending && !file.extra?.length) return;
    let remote = null, merged = local, saved = file;
    if (file) {
      remote = await download(file.id);
      merged = mergeBoxes(local, remote);
      if (canon(merged) !== canon(remote)) {
        // Another device may have saved since we read the file; then start over with its version.
        const now = await api('GET', `drive/v3/files/${file.id}?fields=version`);
        if (String(now.version) !== file.version) throw RETRY;
        const x = await api('PATCH', `upload/drive/v3/files/${file.id}?uploadType=media&fields=id,version`, body(merged), 'application/json');
        saved = { id: file.id, version: String(x.version) };
      }
    } else {
      saved = await create(merged);
    }
    // Saved here while this ran: merge again rather than overwrite it.
    if (box.seq !== seq) throw RETRY;
    box.replace(merged, 'sync');
    st.fileId = saved.id;
    st.version = saved.version;
    st.pending = false;
    st.last = Date.now();
    saveSt();
  } catch (e) {
    if (e === RETRY && tries < 4) return run(tries + 1);
    throw e;
  }
}

export function sync() {
  if (!available() || !st.on) return Promise.resolve();
  if (!live()) { setStatus('tap'); return Promise.resolve(); }
  if (busy) { again = true; return busy; }
  clearTimeout(soon);
  setStatus('busy');
  busy = run().then(() => setStatus('ok'), e => {
    if (e?.auth) setStatus('tap');
    else if (e?.bad) setStatus('error', 'The recipe file in your Drive isn’t readable, so From Scratch left it alone. Save a backup here, then remove that file from Drive to start it fresh.');
    else if (e === RETRY) setStatus('error', 'Another device kept saving. Try again in a moment.');
    else setStatus('error', 'Couldn’t reach Google Drive. Check the connection and try again.');
  }).then(() => {
    busy = null;
    if (again) { again = false; return sync(); }
  });
  return busy;
}

// A save on this page: sync a couple of seconds later.
function changed() {
  if (!available() || !st.on) return;
  st.pending = true;
  saveSt();
  clearTimeout(soon);
  if (live()) soon = setTimeout(sync, 2000); else setStatus('tap');
}

// ---------- signing in (Google Identity Services, in a pop-up) ----------
function loadGis() {
  if (!available() || client) return;
  if (window.google?.accounts?.oauth2) { initClient(); return; }
  if (gisLoading) return;
  gisLoading = true;
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.onload = initClient;
  s.onerror = () => { gisLoading = false; setStatus(st.on ? 'tap' : 'off', 'Google sign-in didn’t load. Check the connection.'); };
  document.head.appendChild(s);
}
function initClient() {
  if (client) return;
  client = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: gotToken,
    error_callback: e => setStatus(st.on ? 'tap' : 'off', e?.type === 'popup_closed' ? '' : 'Google sign-in didn’t finish. If your browser blocks pop-ups, allow them for this page.'),
  });
  setStatus(status, note);
}
async function gotToken(r) {
  if (!r || r.error || !r.access_token || !google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) {
    setStatus(st.on ? 'tap' : 'off', 'Google Drive wasn’t allowed, so nothing was saved there. Try again and leave the Drive box ticked.');
    return;
  }
  tok = { token: r.access_token, exp: Date.now() + (+r.expires_in || 3600) * 1000, scope: r.scope || SCOPE, email: st.email || get(KT)?.email || '' };
  put(KT, tok);
  st.on = true;
  saveSt();
  if (!st.email) await whoami();
  sync();
}
// The account's address, to show where recipes are saved and to skip Google's account chooser next time.
async function whoami() {
  try {
    const x = await api('GET', 'drive/v3/about?fields=' + encodeURIComponent('user(displayName,emailAddress)'));
    st.email = x?.user?.emailAddress || '';
    saveSt();
    if (tok && st.email) { tok.email = st.email; put(KT, tok); }
  } catch { /* shown without it */ }
}
// Google only opens its window from a tap, so this has to run inside a click handler.
function signIn() {
  if (!client) { loadGis(); setStatus(status, 'Google sign-in is still loading. Tap again in a second.'); return; }
  const hint = st.email || get(KT)?.email || '';
  client.requestAccessToken(hint ? { prompt: '', login_hint: hint } : { prompt: 'select_account' });
}
// Turn it on. With a sign-in from any junkdrawer.works project still good, no Google window at all.
async function start() {
  if (!available()) return;
  if (!live()) { signIn(); return; }
  st.on = true;
  if (!st.email && tok.email) st.email = tok.email;
  saveSt();
  if (!st.email) await whoami();
  sync();
}
function now() { if (!st.on) start(); else if (!live()) signIn(); else sync(); }
// Stop on this device. The shared sign-in stays for the other projects, and nothing is revoked:
// revoking would cancel Google's permission for every project on this client.
function stop() {
  st = fresh();
  saveSt();
  clearTimeout(soon);
  setStatus('off');
}

// ---------- the bits of page ----------
function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' hr ago';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function title() {
  return status === 'busy' ? 'Saving to Google Drive' : status === 'tap' ? 'Tap to sign in to Google again and sync' : status === 'error' ? note + ' Tap to try again.' : 'Synced with Google Drive' + (st.last ? ' ' + ago(st.last) : '') + '. Tap to sync now.';
}

// The header button: a cloud with a dot (green synced, amber syncing, red needs a tap).
export function chip(btn) {
  if (!available()) { btn.hidden = true; return; }
  btn.innerHTML = icon.cloud + '<i class="dot"></i>';
  btn.addEventListener('click', now);
  watch(() => { btn.hidden = !st.on; btn.dataset.s = status; btn.title = title(); btn.setAttribute('aria-label', title()); });
}

// The settings card: turn it on, see where it saves, sync now, or stop.
export function card(host) {
  if (!host) return;
  if (!available()) { host.hidden = true; return; }
  host.hidden = false;
  loadGis();
  let armed = false;
  function draw() {
    if (!host.isConnected) return false;
    const line = status === 'busy' ? 'Syncing now.' : status === 'tap' ? 'Google signs this page out after an hour. Tap <b>Sync now</b> to sign back in; your recipes wait safely here meanwhile.' : status === 'error' ? esc(note) : st.last ? `Last synced ${ago(st.last)}.` : '';
    host.innerHTML = st.on
      ? `<h2>Google Drive</h2><p>Your recipes are saved to <b>${esc(st.email || 'your Google Drive')}</b>, in <span class="path">My Drive › From Scratch › From Scratch recipes.json</span>, and show up on every device where you turn this on. Photos of cards stay on the device they were added on. ${line}</p>
        <div class="row"><button class="btn" type="button" data-a="now"${status === 'busy' ? ' disabled' : ''}>Sync now</button><button class="btn quiet" type="button" data-a="off">${armed ? 'Tap again to stop' : 'Stop saving on this device'}</button></div>`
      : `<h2>Save to Google Drive</h2><p>Keep your recipes in your own Google Drive and they’ll be on every phone and computer where you turn this on. They go in a “From Scratch” folder that only the junkdrawer.works projects can open. Photos of cards stay on each device. <a href="https://junkdrawer.works/privacy.html">Privacy</a></p>${note ? `<p class="err">${esc(note)}</p>` : ''}
        <div class="row"><button class="btn primary" type="button" data-a="on">Save to Google Drive</button></div>`;
    host.querySelectorAll('button[data-a]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.a;
      if (a === 'on') start();
      else if (a === 'now') now();
      else if (!armed) { armed = true; draw(); }
      else { armed = false; stop(); }
    }));
  }
  watch(draw);
}
function watch(f) { watchers.add(f); f(); }

export const syncState = () => ({ ...st, status, note });

export function initSync() {
  box.onChange(why => { if (why !== 'sync' && why !== 'storage') changed(); });
  if (!available()) return;
  if (st.on) {
    loadGis(); // ready before the first tap
    status = live() ? 'ok' : 'tap';
    if (live()) setTimeout(sync, 0);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && st.on && live() && Date.now() - st.last > 30000) sync(); });
  setInterval(() => { if (document.visibilityState === 'visible' && st.on && live() && !busy) sync(); else if (st.on && !live() && status !== 'tap') setStatus('tap'); }, 60000);
  window.addEventListener('storage', e => {
    if (e.key === KS || e.key === KT) {
      st = { ...fresh(), ...(get(KS) || {}) };
      tok = get(KT);
      setStatus(st.on ? (live() ? 'ok' : 'tap') : 'off');
    }
  });
}
