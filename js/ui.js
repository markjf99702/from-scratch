// Small pieces every screen uses: escaping, icons, the toast, the sheet, copying a link, and one set of event
// handlers for whichever screen is showing.

export const app = document.getElementById('app');
export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// Things that only matter while the page is open: the search, the scale of each recipe, what's ticked off.
export const ui = { q: '', tag: '', sort: 'az', scale: {}, ticked: {}, step: {}, units: null };

export function go(path, replace = false) {
  const hash = '#' + path;
  if (replace) location.replace(hash); else location.hash = hash;
}

// One set of listeners on the page; each screen says what they do.
let handlers = {};
export function on(h) { handlers = h; }
for (const type of ['click', 'input', 'change', 'keydown', 'submit', 'pointerdown', 'pointerup', 'pointercancel']) {
  app.addEventListener(type, e => handlers[type]?.(e));
}

let toastTimer;
export function toast(message, action, ms = action ? 6500 : 3000) {
  const el = $('toast');
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  el.hidden = false;
  if (action) el.querySelector('button').onclick = () => { el.hidden = true; action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// The sheet that slides up (scale, share, print, confirmations). bind() wires up what's inside once it's drawn.
export function sheet(html, bind) {
  const dlg = $('sheet');
  // A fresh body each time, so listeners from the last sheet don't stay attached.
  const old = dlg.querySelector('.sheet-body'), body = old.cloneNode(false);
  old.replaceWith(body);
  body.innerHTML = html;
  if (!dlg.open) {
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }
  const close = () => { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); };
  bind?.(body, close);
  return close;
}
export const sheetOpen = () => $('sheet').open;
// A tap on the dimmed page around the sheet closes it.
$('sheet').addEventListener('click', e => { if (e.target === e.currentTarget) closeSheet(); });
export function closeSheet() { const d = $('sheet'); if (d.open) { if (d.close) d.close(); else d.removeAttribute('open'); } }

export async function copy(text, field) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Link copied');
  } catch {
    // Some browsers and embedded views refuse the clipboard: select the link so it can be copied by hand.
    field?.focus();
    field?.select();
    let done = false;
    try { done = document.execCommand('copy'); } catch { /* not allowed here either */ }
    toast(done ? 'Link copied' : 'The link is selected. Copy it from there.');
  }
}

// The one-file copy shown inside another page can't start a download.
export function canDownload() {
  if (!('single' in document.documentElement.dataset)) return true;
  try { return window.top === window.self; } catch { return false; }
}

export function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// The line back to the drawer, at the foot of every screen but cook mode (and never in print).
export function footer() {
  return `<footer class="foot"><a href="https://junkdrawer.works/">Part of junkdrawer.works</a><span aria-hidden="true">·</span><a href="https://junkdrawer.works/privacy.html">Privacy</a><span aria-hidden="true">·</span><a href="https://github.com/markjf99702/from-scratch">Source</a></footer>`;
}

// Kitchen fractions are drawn from the font's own digits with its fraction feature, so ⅓ and ⅛ match ½.
const FR = { '⅛': '1⁄8', '¼': '1⁄4', '⅓': '1⁄3', '⅜': '3⁄8', '½': '1⁄2', '⅝': '5⁄8', '⅔': '2⁄3', '¾': '3⁄4', '⅞': '7⁄8', '⅙': '1⁄6', '⅚': '5⁄6', '⅕': '1⁄5' };
export function amountHTML(s) {
  return esc(s).replace(/(\d?)([⅛¼⅓⅜½⅝⅔¾⅞⅙⅚⅕])/g, (m, whole, f) => `${whole}${whole ? '\u2009' : ''}<span class="fr">${FR[f]}</span>`)
    .replace(/(\d+)\/(\d+)/g, '<span class="fr">$1⁄$2</span>');
}

const svg = (body, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;
export const icon = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  cloud: svg('<path d="M7 18.5h10.5a4 4 0 0 0 .7-7.94A6 6 0 0 0 6.7 9.1 4.7 4.7 0 0 0 7 18.5z"/>'),
  share: svg('<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/>'),
  print: svg('<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'),
  timer: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 2h6"/>'),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  next: svg('<path d="M9 18l6-6-6-6"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  clip: svg('<path d="M21.4 11.1 12.2 20.3a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>'),
  camera: svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  pause: svg('<path d="M9 5v14M15 5v14"/>'),
  play: svg('<path d="M7 4l13 8-13 8z"/>'),
  scale: svg('<path d="M4 20h16"/><path d="M6 20V9h4v11"/><path d="M14 20V4h4v16"/>'),
  pot: svg('<path d="M4 10h16v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M2 10h20"/><path d="M9 6c0-1 1-1 1-2M14 6c0-1 1-1 1-2"/>'),
  flag: svg('<path d="M4 22V4"/><path d="M4 4h13l-2 4 2 4H4"/>'),
  spoon: svg('<ellipse cx="12" cy="6.5" rx="4" ry="4.5"/><path d="M12 11v11"/>'),
};
