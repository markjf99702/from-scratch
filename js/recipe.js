// A recipe, the box that holds them, and merging two boxes (for Google Drive, backups and links).
// No page code here, so the tests run it in Node.
import { normalize, readNumber, kitchen } from './ingredients.js';

// Every recipe that comes in — from storage, Drive, a link, a file or the form — goes through cleanRecipe,
// so the rest of the page can trust its shape. Empty fields are left out to keep the Drive file small.
const str = (v, n) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim().slice(0, n) : '');
const para = (v, n) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, n) : '');
const day = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const cleanId = v => str(v, 60).replace(/[^\w.-]/g, '');

export function uid() {
  const a = new Uint8Array(8);
  (globalThis.crypto?.getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.random() * 256; }));
  return 'r' + Array.from(a, x => (x % 36).toString(36)).join('');
}

export function today(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Ingredient lines may arrive as text, or as { h: 'For the glaze' } headings, or as { qty, unit, item, note } parts.
function ingredientLine(x) {
  if (typeof x === 'string' || typeof x === 'number') return str(x, 300);
  if (!x || typeof x !== 'object') return '';
  const h = x.h ?? x.heading ?? x.section;
  if (h) { const t = str(h, 80).replace(/:$/, ''); return t ? t + ':' : ''; }
  if (x.text) return str(x.text, 300);
  const amount = [x.qty ?? x.q ?? x.amount, x.unit ?? x.u].map(v => str(v, 40)).filter(Boolean).join(' ');
  const main = [amount, str(x.item ?? x.name, 200)].filter(Boolean).join(' ');
  const note = str(x.note, 200);
  return main ? main + (note ? ', ' + note : '') : '';
}

function lines(v, max, each, fn = x => str(x, each)) {
  const a = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\n/) : [];
  return a.map(fn).filter(Boolean).slice(0, max);
}

function tagList(v) {
  const a = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\s*,\s*/) : [];
  const seen = new Set(), out = [];
  for (const x of a) {
    const t = str(x, 30).replace(/^#/, '');
    const k = fold(t);
    if (t && !seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out.slice(0, 12);
}

export function cleanRecipe(o) {
  if (!o || typeof o !== 'object') return null;
  const id = cleanId(o.id), t = +o.t > 0 ? Math.floor(+o.t) : 0;
  if (o.del) {
    if (!id) return null;
    const tomb = { id, t, del: 1 };
    if (o.to && cleanId(o.to)) tomb.to = cleanId(o.to);
    return tomb;
  }
  const title = str(o.title ?? o.name, 200);
  if (!title) return null;
  const r = {
    id: id || uid(), t, title,
    from: str(o.from ?? o.whose ?? o.by, 100),
    serves: str(o.serves ?? o.servings, 30),
    makes: str(o.makes ?? o.yield, 80),
    prep: str(o.prep, 40),
    cook: str(o.cook, 40),
    total: str(o.total, 40),
    ingredients: lines(o.ingredients, 150, 300, ingredientLine),
    steps: lines(o.steps ?? o.directions ?? o.method, 80, 3000, x => para(typeof x === 'object' && x ? x.text : x, 3000).replace(/\n+/g, ' ')),
    notes: para(o.notes ?? o.story, 5000),
    tags: tagList(o.tags),
    source: str(o.source, 200),
    check: str(o.check ?? o.unsure, 500),
    added: day(o.added),
    sample: o.sample ? 1 : 0,
  };
  for (const k of Object.keys(r)) {
    const v = r[k];
    if (k !== 't' && (v === '' || v === 0 || (Array.isArray(v) && !v.length))) delete r[k];
  }
  return r;
}

// A box: { recipes: { id: recipe } }. A removed recipe stays as { id, t, del: 1 } so the removal reaches other devices.
export function cleanBox(o) {
  const src = o?.box ?? o ?? {};
  const list = Array.isArray(src.recipes) ? src.recipes : src.recipes && typeof src.recipes === 'object' ? Object.values(src.recipes) : [];
  const recipes = {};
  for (const x of list) {
    const r = cleanRecipe(x);
    if (r && (!recipes[r.id] || newer(r, recipes[r.id]))) recipes[r.id] = r;
  }
  return { recipes: sortKeys(recipes) };
}

// JSON with its keys in order, so the same box always compares equal.
export function canon(x) {
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().filter(k => x[k] !== undefined).map(k => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
  return JSON.stringify(x ?? null);
}
const sortKeys = o => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));
// A removal wins a tie, so merging something already merged never brings back what it removed.
export const newer = (x, y) => x.t > y.t || (x.t === y.t && (!!x.del !== !!y.del ? !!x.del : canon(x) > canon(y)));

export const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();

// Two recipes with the same words are the same recipe, even with different ids (typed on two devices, or a link opened on both).
// Every word counts, notes, tags and times included, so two copies that differ anywhere both stay instead of one
// losing its notes. Tags count in any order.
export function fingerprint(r) {
  return [r.title, r.from, r.serves, r.makes, r.prep, r.cook, r.total, (r.ingredients || []).join('\n'), (r.steps || []).join('\n'),
    r.notes, (r.tags || []).map(fold).sort().join(','), r.source].map(fold).join('|');
}

// Recipe by recipe, the most recently changed copy wins, and a removal wins over anything older.
// Merging is order-free and repeatable, so every device that syncs ends up with the same box.
// A device's first sync loses nothing: recipes only on one side are kept, and the same recipe made word for word on
// two devices collapses into one (the other id becomes a removal pointing at the one kept).
export function mergeBoxes(a, b) {
  const recipes = {};
  for (const d of [a, b]) {
    for (const [id, r] of Object.entries(d?.recipes || {})) {
      if (!recipes[id] || newer(r, recipes[id])) recipes[id] = r;
    }
  }
  const byPrint = {};
  for (const id of Object.keys(recipes).sort()) {
    const r = recipes[id];
    if (r.del) continue;
    const fp = fingerprint(r);
    if (byPrint[fp]) recipes[id] = { id, t: r.t, del: 1, to: byPrint[fp] };
    else byPrint[fp] = id;
  }
  return { recipes: sortKeys(recipes) };
}

export const live = box => Object.values(box?.recipes || {}).filter(r => !r.del);

export function byTitle(a, b) {
  const k = r => fold(r.title).replace(/^(the|a|an) /, '');
  return k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0;
}

// Every word of the search has to be somewhere in the recipe: its title, whose it is, tags, ingredients, notes or steps.
export function matches(r, q) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([r.title, r.from, (r.tags || []).join(' '), (r.ingredients || []).join(' '), r.notes, r.source, (r.steps || []).join(' ')].join(' \n '));
  return words.every(w => hay.includes(w));
}

export function allTags(recipes) {
  const count = {};
  for (const r of recipes) for (const t of r.tags || []) {
    const k = fold(t);
    count[k] = count[k] || { tag: t, n: 0 };
    count[k].n++;
  }
  return Object.values(count).sort((a, b) => (fold(a.tag) < fold(b.tag) ? -1 : 1));
}
export const hasTag = (r, tag) => (r.tags || []).some(t => fold(t) === fold(tag));

// "Grandma Rosa" → "Grandma Rosa’s"; "Aunt June’s" stays as it is.
export function possessive(name) {
  const n = String(name || '').trim();
  if (!n) return '';
  if (/['’]s?$/i.test(n) && /['’]/.test(n.slice(-2))) return n;
  return n + '’s';
}

// How many the recipe makes, as a number to scale by: "Serves 6–8" → 6, "Makes 4 dozen cookies" → 4 (dozen cookies).
export function yieldOf(r) {
  if (r.serves) {
    const s = normalize(r.serves), n = readNumber(s);
    if (n && n.v > 0 && !n.article) {
      const range = /^\s*(?:-|–|to|or)\s*(\d+)/.exec(s.slice(n.len));
      return { n: n.v, n2: range ? +range[1] : null, kind: 'serves', rest: '' };
    }
  }
  if (r.makes) {
    const all = normalize(r.makes), lead = /^(about|approximately|approx\.?|around)\s+/i.exec(all);
    const s = lead ? all.slice(lead[0].length) : all;
    const n = readNumber(s);
    if (n && n.v > 0) {
      const after = s.slice(n.len);
      const range = /^\s*(?:-|–|to|or)\s*(\d+)/.exec(after);
      const rest = (range ? after.slice(range[0].length) : after).trim();
      return { n: n.v, n2: range ? +range[1] : null, kind: 'makes', rest, pre: lead ? lead[1] : '' };
    }
  }
  return null;
}

// The yield line for a scaled recipe: "Serves 12", "Makes about 6 dozen cookies".
export function yieldText(r, factor = 1) {
  const y = yieldOf(r);
  const num = x => (Number.isInteger(Math.round(x * 100) / 100) ? String(Math.round(x)) : kitchen(x, [2, 3, 4]));
  if (!y) return r.serves ? `Serves ${r.serves}` : r.makes ? `Makes ${r.makes}` : '';
  const amount = num(y.n * factor) + (y.n2 ? '–' + num(y.n2 * factor) : '');
  if (y.kind === 'serves') return `Serves ${amount}`;
  return `Makes ${y.pre ? y.pre + ' ' : ''}${amount}${y.rest ? ' ' + y.rest : ''}`;
}

export function timeLine(r) {
  return [r.prep && `Prep ${r.prep}`, r.cook && `Cook ${r.cook}`, r.total && `Total ${r.total}`].filter(Boolean).join(' · ');
}
