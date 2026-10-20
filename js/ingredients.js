// Reading an ingredient line ("1 1/2 c. flour, sifted") into quantity, unit, item and note,
// and writing it back out: scaled, in kitchen fractions, in cups or grams.
// No page code here, so the tests run it in Node.
import { UNITS, UNIT_NAMES, isMeasure, isContainer } from './units.js';
import { densityFor, source } from './density.js';

const VULGAR = { '¼': '1/4', '½': '1/2', '¾': '3/4', '⅐': '1/7', '⅑': '1/9', '⅒': '1/10', '⅓': '1/3', '⅔': '2/3', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8' };
const VULGAR_RX = /[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g;
const GLYPH = { '1/16': '1/16', '1/8': '⅛', '1/4': '¼', '1/3': '⅓', '3/8': '⅜', '1/2': '½', '5/8': '⅝', '2/3': '⅔', '3/4': '¾', '7/8': '⅞', '1/6': '⅙', '5/6': '⅚', '1/5': '⅕' };
const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };
const PARTS = { 'a half': 0.5, 'one half': 0.5, half: 0.5, 'a quarter': 0.25, 'one quarter': 0.25, 'three quarters': 0.75, 'a third': 1 / 3, 'one third': 1 / 3, 'two thirds': 2 / 3 };
const VAGUE = /^(little|few|bit|couple|splash|drizzle|dollop|knob|squeeze|sprinkle|sprinkling|touch|lot|bunch of|good|generous|smidgen|glug|some|more|bit)\b/i;
const MODS = ['approximately', 'approx.', 'approx', 'about', 'around', 'roughly', 'scant', 'heaping', 'heaped', 'rounded', 'level', 'generous', 'good', 'large', 'big', 'small'];

// Unicode fractions become "1/2" with a space after any whole number, fraction slashes become "/", spaces collapse.
export function normalize(s) {
  return String(s ?? '')
    .replace(/[⁄∕]/g, '/')
    .replace(/(\d)\s*([¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/g, (m, d, f) => d + ' ' + VULGAR[f])
    .replace(VULGAR_RX, f => VULGAR[f])
    .replace(/[   \t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A number at the start of s: "1 1/2", "1-1/2", "3/4", "1.5", "1,5 dl", "one", "one and a half", "half a".
export function readNumber(s) {
  let m;
  if ((m = /^(\d+)(?:\s+|-)(\d+)\/(\d+)(?![\d/])/.exec(s)) && +m[3]) return { v: +m[1] + m[2] / m[3], len: m[0].length };
  if ((m = /^(\d+)\/(\d+)(?![\d/])/.exec(s)) && +m[2]) return { v: m[1] / m[2], len: m[0].length };
  if ((m = /^(\d+) and (?:(\d+)\/(\d+)|(a half|one half|a quarter|three quarters|a third|two thirds))(?![\d/])/.exec(s))) {
    const part = m[4] ? PARTS[m[4]] : m[3] ? m[2] / m[3] : 0;
    return { v: +m[1] + part, len: m[0].length };
  }
  if ((m = /^(\d+),(\d{1,2})(?=\s*[a-zA-Z])/.exec(s))) return { v: +(m[1] + '.' + m[2]), len: m[0].length };
  if ((m = /^(\d*\.\d+|\d+)(?![\d/])/.exec(s))) return { v: +m[1], len: m[0].length };
  const low = s.toLowerCase();
  if ((m = /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\b(?: and (a half|one half|a quarter|three quarters|a third|two thirds))?/.exec(low))) {
    return { v: WORDNUM[m[1]] + (m[2] ? PARTS[m[2]] : 0), len: m[0].length, word: true };
  }
  if ((m = /^(?:a |one )?half(?: an?| of an?)?\b/.exec(low))) return { v: 0.5, len: m[0].length, word: true };
  if ((m = /^(?:a |one )?quarter(?: of an?| an?)?\b/.exec(low))) return { v: 0.25, len: m[0].length, word: true };
  if ((m = /^(?:a|one) third(?: of an?| an?)?\b/.exec(low))) return { v: 1 / 3, len: m[0].length, word: true };
  if ((m = /^(an?)\b/.exec(low))) return { v: 1, len: m[0].length, article: true };
  return null;
}

// A unit name at the start of s, with an optional full stop, not running into a longer word.
export function readUnit(s) {
  const low = s.toLowerCase();
  for (const { name, key, exact } of UNIT_NAMES) {
    const head = exact ? s.slice(0, name.length) : low.slice(0, name.length);
    if (head !== (exact ? name : name.toLowerCase())) continue;
    let len = name.length;
    if (s[len] === '.') len++;
    const next = s[len];
    if (next && /[a-zA-Z0-9]/.test(next) && name !== '#') continue;
    if (name === '#' && !/^#\s/.test(s)) continue;
    return { key, len };
  }
  return null;
}

// A quantity with an optional range after it: "2", "2-3", "2 to 3", "1/2–3/4", "3 or 4".
function readAmount(s) {
  const a = readNumber(s);
  if (!a) return null;
  let len = a.len, q2 = null, m;
  const rest = s.slice(len);
  if ((m = /^\s*(?:-|–|—|to|or)\s*/.exec(rest)) && !a.article) {
    const b = readNumber(rest.slice(m[0].length));
    if (b && !b.article && b.v > a.v) { q2 = b.v; len += m[0].length + b.len; }
  }
  return { q: a.v, q2, len, article: a.article, word: a.word };
}

// An amount with a measuring unit at the start of s: "7oz", "1 stick", "240 ml", "1/2 lb".
function readMeasure(s) {
  const b = readAmount(s);
  if (!b || b.article) return null;
  const gap = /^\s*/.exec(s.slice(b.len))[0];
  const u = readUnit(s.slice(b.len + gap.length));
  if (!u || !isMeasure(u.key)) return null;
  return { q: b.q, q2: b.q2, u: u.key, len: b.len + gap.length + u.len };
}

// "15 oz" or "15-ounce" (the size of a can or package).
function readSize(s) {
  const n = readNumber(s);
  if (!n || n.article || n.word) return null;
  let i = n.len;
  const sep = /^\s*-?\s*/.exec(s.slice(i))[0];
  const u = readUnit(s.slice(i + sep.length));
  if (!u || !isMeasure(u.key)) return null;
  return { q: n.v, u: u.key, len: i + sep.length + u.len };
}

export function headingOf(line) {
  const s = String(line ?? '').trim();
  let m;
  if ((m = /^#{1,6}\s*(.+?)\s*#*$/.exec(s))) return m[1].replace(/:$/, '').trim();
  if ((m = /^(?:\*\*|__)(.+?)(?:\*\*|__):?$/.exec(s))) return m[1].replace(/:$/, '').trim();
  if (/:$/.test(s) && s.length <= 60 && !/^[\d¼½¾⅓⅔⅛⅜⅝⅞]/.test(s) && !/,/.test(s)) return s.slice(0, -1).trim();
  if (/^for (the |a |an )?[a-z][a-z' -]*$/i.test(s) && s.split(/\s+/).length <= 6) return s;
  return null;
}

// One ingredient line → { q, q2, u, size, alt, mod, pre, item, note } or { h } for a section heading.
// q is null when the line has no amount ("salt and pepper to taste").
export function parseLine(line) {
  const text = String(line ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const h = headingOf(text);
  if (h) return { h };
  let s = normalize(text).replace(/^(?:[-•*·▪◦–]|\d+[.)])\s+(?=\S)/, '');
  const out = { q: null, q2: null, u: '', size: null, alt: null, mod: '', pre: '', item: '', note: '' };
  let m;

  // "Juice of 1 lemon", "Zest of 2 oranges"
  if ((m = /^((?:the )?(?:finely |freshly )?(?:grated )?(?:juice|zest|rind|peel|zest and juice|juice and zest) of)\s+/i.exec(s))) {
    const a = readAmount(s.slice(m[0].length));
    if (a && !a.article) { out.pre = m[1]; s = s.slice(m[0].length); }
  }

  // Words before the amount: "about 2 cups", "scant 1 cup", "a scant cup"
  const lead = new RegExp('^(' + MODS.map(x => x.replace('.', '\\.')).join('|') + ')\\s+', 'i');
  if ((m = lead.exec(s)) && readAmount(s.slice(m[0].length))) { out.mod = m[1].toLowerCase().replace(/\.$/, ''); s = s.slice(m[0].length); }

  let a = readAmount(s);
  if (!a && (m = /^(pinch|dash|handful|sprig|splash)(es)?\b/i.exec(s)) && /^(pinch|dash|handful|sprig)$/i.test(m[1])) a = { q: 1, q2: null, len: 0 };
  if (a) {
    let rest = s.slice(a.len).replace(/^\s+/, '');
    let mod = '';
    if ((m = /^(scant|heaping|heaped|rounded|level|generous|good|large|big|small)\s+/i.exec(rest))) {
      const u = readUnit(rest.slice(m[0].length));
      if (u) { mod = m[1].toLowerCase(); rest = rest.slice(m[0].length); }
    }
    // "1 (15 oz) can", "2 8-ounce packages"
    let size = null;
    if ((m = /^\(\s*([^)]*?)\s*(?:each)?\s*\)\s*/.exec(rest))) {
      const sz = readSize(m[1]);
      if (sz && sz.len === m[1].length) { size = { q: sz.q, u: sz.u }; rest = rest.slice(m[0].length); }
    } else {
      const sz = readSize(rest);
      if (sz) {
        const after = rest.slice(sz.len).replace(/^\s+/, '');
        const u2 = readUnit(after);
        if (u2 && isContainer(u2.key)) { size = { q: sz.q, u: sz.u }; rest = after; }
      }
    }
    const u = readUnit(rest);
    // "an egg" and "a lemon" are amounts, but "a little milk" and "a few sprigs" aren't.
    if (a.article && !u && !size && (!/^[a-z]/i.test(rest) || VAGUE.test(rest))) {
      out.item = text;
      return out;
    }
    out.q = a.q; out.q2 = a.q2;
    if (mod) out.mod = out.mod ? out.mod + ' ' + mod : mod;
    if (u) {
      rest = rest.slice(u.len).replace(/^\s+/, '');
      out.u = u.key;
      // "12 oz. pkg. chips": the amount was the package's size.
      if (!size && isMeasure(u.key) && !a.q2) {
        const u2 = readUnit(rest);
        if (u2 && isContainer(u2.key)) { size = { q: a.q, u: u.key }; out.q = 1; out.u = u2.key; rest = rest.slice(u2.len).replace(/^\s+/, ''); }
      }
      // "1 cup plus 2 tablespoons", "1 lb 4 oz"
      if (isMeasure(out.u) && !out.q2) {
        const cm = /^(?:(?:plus|\+|and)\s+)?/i.exec(rest);
        const b = readNumber(rest.slice(cm[0].length));
        if (b && !b.article && !b.word) {
          const r2 = rest.slice(cm[0].length + b.len).replace(/^\s+/, '');
          const u2 = readUnit(r2);
          if (u2 && UNITS[u2.key].kind === UNITS[out.u].kind && (cm[0] || UNITS[out.u].kind === 'mass')) {
            out.q += b.v * factorBetween(u2.key, out.u);
            out.extra = true;
            rest = r2.slice(u2.len).replace(/^\s+/, '');
          }
        }
      }
      // "200g/7oz flour": the same amount again, after a slash
      if ((m = /^\/\s*/.exec(rest)) && !out.q2) {
        const b = readMeasure(rest.slice(m[0].length));
        if (b) { out.alt = { q: b.q, q2: b.q2, u: b.u }; rest = rest.slice(m[0].length + b.len).replace(/^\s+/, ''); }
      }
      // "1 can (15 oz) beans", or "1 cup (2 sticks) butter"
      if ((m = /^\(\s*([^)]*?)\s*\)\s*/.exec(rest))) {
        const inner = m[1];
        const sz = readSize(inner);
        if (sz && sz.len === inner.length && isContainer(out.u) && !size) { size = { q: sz.q, u: sz.u }; rest = rest.slice(m[0].length); }
        else {
          const b = readAmount(inner), r2 = b ? inner.slice(b.len).replace(/^\s+/, '') : '';
          const u2 = b && !b.article ? readUnit(r2) : null;
          if (u2 && u2.len >= r2.replace(/\.$/, '').length) { out.alt = { q: b.q, q2: b.q2, u: u2.key }; rest = rest.slice(m[0].length); }
          else if (!/\d/.test(inner) && inner.split(/\s+/).length <= 3) { out.note = inner; rest = rest.slice(m[0].length); }
        }
      }
    }
    out.size = size;
    s = rest.replace(/^of\s+/i, '');
  }

  // What's left is the item, then any note: after a comma, a dash, in brackets at the end, or "to taste".
  let item = s, note = '';
  const split = topLevelSplit(item);
  if (split) { item = split[0]; note = split[1]; }
  if ((m = /\s*\(([^()]*)\)\s*$/.exec(item)) && m.index > 0) {
    // A bracket at the end that is only an amount scales with the line: "butter (1 stick)", "milk (240 ml)", or the
    // size of a can, "crushed tomatoes (28 oz)". It stays after the item, where the card put it.
    const inner = m[1].trim(), box = isContainer(out.u);
    const sz = box ? inner.replace(/\s+each\.?$/i, '') : inner;
    const b = out.q != null ? readMeasure(sz) : null;
    const whole = b && b.len >= sz.replace(/\.$/, '').length;
    if (whole && box && !out.size && b.q2 == null) out.size = { q: b.q, u: b.u };
    else if (whole && !box && !out.alt) out.alt = { q: b.q, q2: b.q2, u: b.u, end: true };
    else note = note ? m[1] + ', ' + note : m[1];
    item = item.slice(0, m.index);
  }
  if ((m = /\s+(to taste|as needed|if needed|optional|for serving|for garnish|or to taste)$/i.exec(item)) && m.index > 0) { note = note ? m[1] + ', ' + note : m[1]; item = item.slice(0, m.index); }
  if (out.note) note = note ? out.note + ', ' + note : out.note;
  out.item = item.trim().replace(/^of\s+/i, '');
  out.note = note.trim();
  if (!out.item && out.q == null) out.item = text;
  if (out.q != null && !out.u && !out.size) readPlus(out);
  return out;
}

// "2 large eggs plus 1 yolk", "3 eggs + 2 whites", "2 eggs, plus 1 yolk": a second thing counted after the first.
// It's kept apart from the item as plus: { q, q2, item, word, text, at } so it scales with the line. Anything else
// after "plus" ("plus 1 tablespoon water", "plus enough milk to make 1 cup") stays where it was, as written.
function readPlus(out) {
  let m = /\s(plus|\+)\s+/i.exec(out.item), at = 'item', head = out.item, tail;
  if (m) { head = out.item.slice(0, m.index).trim(); tail = out.item.slice(m.index + m[0].length); }
  else if ((m = /^(plus|\+)\s+/i.exec(out.note))) { at = 'note'; tail = out.note.slice(m[0].length); }
  else return;
  const a = readAmount(tail);
  if (!a || !head) return;
  let noun = tail.slice(a.len).trim(), rest = '';
  const comma = at === 'note' ? noun.indexOf(',') : -1;
  if (comma >= 0) { rest = noun.slice(comma + 1).trim(); noun = noun.slice(0, comma).trim(); }
  if (!/^[a-z]/i.test(noun) || /[\d()+]|\bplus\b/i.test(noun) || readUnit(noun) || (a.article && VAGUE.test(noun))) return;
  const text = `${m[1]} ${tail.slice(0, a.len).trim()} ${noun}`;
  out.plus = { q: a.q, q2: a.q2, item: noun, word: m[1], text, at };
  if (at === 'item') out.item = head;
  else out.note = rest;
}

function topLevelSplit(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && c === ',' && i > 0) return [s.slice(0, i), s.slice(i + 1).trim()];
    else if (depth === 0 && /^\s[–—-]{1,2}\s/.test(s.slice(i - 1, i + 3)) && i > 1) return [s.slice(0, i - 1), s.slice(i + 2).trim()];
  }
  return null;
}

// How many of `to` make one `from` (both the same kind).
export function factorBetween(from, to) {
  const a = UNITS[from], b = UNITS[to];
  if (a.kind === 'vol') return a.ml / b.ml;
  return a.g / b.g;
}

// ---------- writing amounts ----------

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// A number as a cook would write it, using only the given denominators: 1.5 → "1½", 0.333 → "⅓".
export function kitchen(x, dens = [2, 3, 4, 8]) {
  if (!(x > 0)) return '0';
  let best = null;
  for (const d of dens) {
    const n = Math.round(x * d), err = Math.abs(x - n / d);
    if (!best || err < best.err - 1e-9) best = { n, d, err };
  }
  let { n, d } = best;
  if (n === 0) { n = 1; d = Math.max(...dens); }
  const whole = Math.floor(n / d);
  let r = n - whole * d;
  if (!r) return String(whole);
  const g = gcd(r, d);
  const f = GLYPH[`${r / g}/${d / g}`] || `${r / g}/${d / g}`;
  return (whole || '') + f;
}

// Metric amounts are written as decimals: 1.5 kg, 0.75 L.
export function decimal(x, places = 2) {
  const v = +x.toFixed(places);
  return String(v);
}

const round = (x, step) => Math.round(x / step) * step;

export function grams(g) {
  if (g >= 1000) return { q: decimal(g / 1000, 2), u: 'kg' };
  if (g < 10) return { q: decimal(round(g, 0.5), 1), u: 'g' };
  return { q: String(round(g, g < 500 ? 1 : 5)), u: 'g' };
}

export function millilitres(ml) {
  if (ml >= 1000) return { q: decimal(ml / 1000, 2), u: 'l' };
  if (ml < 10) return { q: decimal(round(ml, 0.5), 1), u: 'ml' };
  return { q: String(round(ml, ml < 250 ? 5 : 10)), u: 'ml' };
}

// A US volume in the way a cook would measure it: 16 tbsp → 1 cup, 3 tsp → 1 tbsp, 1⅛ cups → 1 cup + 2 tbsp.
// Candidates are scored by how far off they are, plus a little for every extra spoonful to count.
export function bestUS(ml, { single = false, spoons = false, loose = false } = {}) {
  const tsp = ml / UNITS.tsp.ml;
  if (tsp < 0.1) return [{ q: null, u: 'pinch', text: 'a pinch' }];
  const cands = [];
  const add = (parts, value, penalty) => cands.push({ parts, err: Math.abs(value - tsp) / tsp + penalty });
  const CUPF = [0, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4];
  // A second spoon to count costs a little; converting from metric is approximate anyway, so it costs more there.
  const two = loose ? 0.06 : 0.035;
  if (!spoons && tsp >= 12 * 0.97) {
    // Only the whole cups either side of the amount can win, so 20,000 cups doesn't try every cup up to it.
    for (let w = Math.max(0, Math.floor(tsp / 48) - 1); w <= Math.ceil(tsp / 48) + 1; w++) for (const f of CUPF) {
      const c = w + f;
      if (c < 0.25) continue;
      add([{ q: c, u: 'cup' }], c * 48, 0);
      if (!single) for (let t = 1; t <= 3; t += 0.5) add([{ q: c, u: 'cup' }, { q: t, u: 'tbsp' }], c * 48 + t * 3, two);
    }
  }
  for (let t = 1; t <= 8; t += 0.5) {
    if (t > 5 && !Number.isInteger(t)) continue;
    add([{ q: t, u: 'tbsp' }], t * 3, t > 3 ? 0.008 * (t - 3) : 0);
    if (!single && Number.isInteger(t) && t < 8) for (const x of [0.5, 1, 2]) add([{ q: t, u: 'tbsp' }, { q: x, u: 'tsp' }], t * 3 + x, two);
  }
  if (tsp < 3.5) for (let x = 1 / 8; x <= 3; x += 1 / 8) add([{ q: x, u: 'tsp' }], x, x >= 3 ? 1 : 0);
  if (spoons && tsp > 24) for (let t = 9; t <= Math.ceil(tsp / 3) + 1; t++) add([{ q: t, u: 'tbsp' }], t * 3, 0.1);
  cands.sort((a, b) => a.err - b.err);
  return cands[0].parts;
}

// A US weight: ounces up to a pound, then pounds, or pounds and ounces.
export function bestUSMass(g, { single = false } = {}) {
  const oz = g / UNITS.oz.g;
  if (oz < 16 * 0.97) {
    if (oz < 1) return [{ q: Math.max(0.25, round(oz, 0.25)), u: 'oz' }];
    if (oz < 4) return [{ q: round(oz, 0.25), u: 'oz' }];
    if (oz < 8) return [{ q: round(oz, 0.5), u: 'oz' }];
    return [{ q: Math.round(oz), u: 'oz' }];
  }
  const lb = oz / 16;
  const nice = [2, 3, 4].map(d => Math.round(lb * d) / d).sort((a, b) => Math.abs(a - lb) - Math.abs(b - lb))[0];
  if (single || Math.abs(nice - lb) / lb <= 0.03) return [{ q: single ? nice : nice, u: 'lb' }];
  const whole = Math.floor(lb), rest = Math.round((lb - whole) * 16);
  if (rest === 16) return [{ q: whole + 1, u: 'lb' }];
  return rest ? [{ q: whole, u: 'lb' }, { q: rest, u: 'oz' }] : [{ q: whole, u: 'lb' }];
}

const DENS = { tsp: [2, 4, 8], tbsp: [2], cup: [2, 3, 4], oz: [2, 4], lb: [2, 3, 4], stick: [2, 4], floz: [2, 4], pint: [2, 4], quart: [2, 4], gallon: [2, 4] };

// An amount in a given unit as text, in that unit's usual fractions (metric units as decimals).
export function amountText(q, u, exact = false) {
  if (q == null) return '';
  if (typeof q === 'string') return q;
  const U = UNITS[u];
  if (U && U.sys === 'metric') return decimal(q, q < 10 ? 2 : 1);
  if (exact) {
    // As written: keep the card's own fraction, or its decimal if it isn't a kitchen fraction.
    const near = [2, 3, 4, 8, 16].some(d => Math.abs(q * d - Math.round(q * d)) < 0.01 * d);
    return near ? kitchen(q, [2, 3, 4, 8, 16]) : decimal(q, 2);
  }
  if (q >= 20 && !['tsp'].includes(u)) return String(Math.round(q));
  if (q >= 10) return kitchen(q, [2]);
  return kitchen(q, DENS[u] || [2, 3, 4]);
}

const unitWord = (u, n) => (UNITS[u] ? (n > 1 || n === 0 ? UNITS[u].many : UNITS[u].one) : '');

// ---------- plurals for things counted without a unit (1 egg, 2 eggs) ----------
const IRREGULAR = { leaf: 'leaves', loaf: 'loaves', half: 'halves', knife: 'knives', potato: 'potatoes', tomato: 'tomatoes', mango: 'mangoes', hero: 'heroes', mouse: 'mice', goose: 'geese', radish: 'radishes', peach: 'peaches', dish: 'dishes', box: 'boxes', clove: 'cloves' };
const SINGULAR = Object.fromEntries(Object.entries(IRREGULAR).map(([a, b]) => [b, a]));
export function plural(w) {
  const low = w.toLowerCase();
  if (IRREGULAR[low]) return keepCase(w, IRREGULAR[low]);
  if (SINGULAR[low] || /[^s]s$/.test(low) && !/(us|is|ss)$/.test(low)) return w;
  if (/(s|x|z|ch|sh)$/.test(low)) return w + 'es';
  if (/[^aeiou]y$/.test(low)) return w.slice(0, -1) + 'ies';
  return w + 's';
}
export function singular(w) {
  const low = w.toLowerCase();
  if (SINGULAR[low]) return keepCase(w, SINGULAR[low]);
  if (/ies$/.test(low) && low.length > 4) return w.slice(0, -3) + 'y';
  if (/(ches|shes|xes|zes|sses|oes)$/.test(low)) return w.slice(0, -2);
  if (/[^su]s$/.test(low) && low.length > 3) return w.slice(0, -1);
  return w;
}
const keepCase = (orig, w) => (orig[0] === orig[0].toUpperCase() ? w[0].toUpperCase() + w.slice(1) : w);

function recount(item, n) {
  const m = /^(.*?)([A-Za-z]+)$/.exec(item);
  if (!m || item.split(/\s+/).length > 4 || /\b(of|and|or|with)\b/i.test(item)) return item;
  return m[1] + (n > 1 ? plural(m[2]) : singular(m[2]));
}

// ---------- scaling and converting ----------
// present(parsed line, { factor, mode }) → what to show: { qty, unit, item, note, pre, size, conv }.
// mode: 'as' (the recipe's own units), 'us' (cups and spoons, ounces and pounds), 'metric' (grams and millilitres).
// In metric, teaspoons and tablespoons stay spoons (metric kitchens use 5 ml and 15 ml spoons), except for
// ingredients weighed from the USDA table; everything else by volume becomes millilitres.
export function present(p, { factor = 1, mode = 'as' } = {}) {
  if (!p) return null;
  if (p.h) return { h: p.h };
  const base = { pre: p.pre, item: p.item, note: p.note, mod: p.mod, qty: '', unit: '', size: '', conv: null };
  if (p.q == null) return base;
  const q = p.q * factor, q2 = p.q2 == null ? null : p.q2 * factor;
  const U = UNITS[p.u];
  const scaled = Math.abs(factor - 1) > 1e-9;
  let parts = null, conv = null;

  if (U && U.kind === 'vol') {
    const ml = q * U.ml, ml2 = q2 == null ? null : q2 * U.ml;
    const d = densityFor(p.item);
    if (mode === 'metric' && U.sys === 'us') {
      if (d && p.u !== 'tsp') {
        const g = p.u === 'stick' && d.name === 'butter' ? q * 113 : ml * d.gPerMl;
        parts = [grams(g)];
        if (ml2 != null) parts = rangeParts(parts[0], p.u === 'stick' && d.name === 'butter' ? q2 * 113 : ml2 * d.gPerMl, grams);
        conv = { density: d, source: source(d) };
      } else if (ml < 60 && ['tsp', 'tbsp'].includes(p.u)) {
        parts = scaled || p.extra ? spoonParts(ml, ml2) : [{ q, q2, u: p.u }];
      } else {
        parts = [millilitres(ml)];
        if (ml2 != null) parts = rangeParts(parts[0], ml2, millilitres);
        conv = { sys: true };
      }
    } else if (mode === 'us' && U.sys === 'metric') {
      parts = usVolume(ml, ml2, true);
      conv = { sys: true };
    } else if (U.sys === 'metric') {
      parts = scaled ? [millilitres(ml)] : [{ q: decimal(q, 2), u: p.u }];
      if (q2 != null) parts = scaled ? rangeParts(parts[0], ml2, millilitres) : [{ q: decimal(q, 2), q2: decimal(q2, 2), u: p.u }];
    } else if (p.u === 'stick' && Math.abs(q * 2 - Math.round(q * 2)) < 1e-6 && (q2 == null || Math.abs(q2 * 2 - Math.round(q2 * 2)) < 1e-6)) {
      parts = [{ q, q2, u: 'stick' }];
    } else if (scaled || p.extra) {
      parts = usVolume(ml, ml2);
    } else {
      parts = [{ q, q2, u: p.u }];
    }
  } else if (U && U.kind === 'mass') {
    const g = q * U.g, g2 = q2 == null ? null : q2 * U.g;
    if (mode === 'metric' && U.sys === 'us') {
      parts = [grams(g)];
      if (g2 != null) parts = rangeParts(parts[0], g2, grams);
      conv = { sys: true };
    } else if (mode === 'us' && U.sys === 'metric') {
      const d = densityFor(p.item);
      if (d) {
        parts = usVolume(g / d.gPerMl, g2 == null ? null : g2 / d.gPerMl, true);
        conv = { density: d, source: source(d) };
      } else {
        parts = g2 == null ? bestUSMass(g) : bestUSMass(g, { single: true });
        if (g2 != null) parts = [{ ...parts[0], q2: g2 / UNITS[parts[0].u].g }];
        conv = { sys: true };
      }
    } else if (U.sys === 'metric') {
      parts = scaled ? [grams(g)] : [{ q: decimal(q, 2), u: p.u }];
      if (q2 != null) parts = scaled ? rangeParts(parts[0], g2, grams) : [{ q: decimal(q, 2), q2: decimal(q2, 2), u: p.u }];
    } else if (U.keep || !scaled && !p.extra) {
      parts = [{ q, q2, u: p.u }];
    } else {
      parts = g2 == null ? bestUSMass(g) : bestUSMass(g, { single: true });
      if (g2 != null) parts = [{ ...parts[0], q2: g2 / UNITS[parts[0].u].g }];
    }
  } else {
    parts = [{ q, q2, u: p.u }];
  }

  const exact = !scaled && !conv && !p.extra;
  const text = parts.map(pt => {
    if (pt.text) return { qty: pt.text, unit: '' };
    const top = pt.q2 != null ? pt.q2 : pt.q;
    const n = typeof top === 'string' ? +top : top;
    const qs = amountText(pt.q, pt.u, exact) + (pt.q2 != null ? '–' + amountText(pt.q2, pt.u, exact) : '');
    return { qty: qs, unit: pt.u ? unitWord(pt.u, n > 1 ? 2 : 1) : '' };
  });
  const out = { ...base, conv };
  out.qty = text[0].qty;
  out.unit = text[0].unit;
  if (text[1]) out.more = text.slice(1).map(t => `${t.qty} ${t.unit}`).join(' + ');
  if (p.size) out.size = sizeText(p.size, mode);
  if (['pinch', 'dash', 'handful'].includes(parts[0].u)) out.of = true;
  // The card's other amount, unless it now says the same as the first ("¾ cup sugar (¾ cup)").
  if (p.alt && !conv && !(parts.length === 1 && parts[0].u === p.alt.u)) {
    const alt = altText(p.alt, factor, !scaled);
    if (alt) { out.alt = alt; if (p.alt.end) out.altEnd = true; }
  }
  if (!p.u && !pAmbiguousCount(p)) {
    // The card's own word stays ("8 jumbo shrimp", "6 Eier"). Only a scale that takes the count across one
    // changes it, and only its last word: 1 egg → 2 eggs, 2 eggs → 1 egg.
    const was = p.q2 != null ? p.q2 : p.q, n = q2 != null ? q2 : q;
    if ((was > 1) !== (n > 1)) out.item = recount(p.item, n);
    if (scaled && /\beggs?\b/i.test(p.item) && q2 == null && Math.abs(q - Math.round(q)) > 0.01) {
      const part = { '¼': 'a quarter', '⅓': 'a third', '½': 'half', '⅔': 'two thirds', '¾': 'three quarters' }[kitchen(q - Math.floor(q), [2, 3, 4])];
      if (part) out.hint = `beat the last egg and use ${part} of it`;
    }
    // "plus 1 yolk" goes back where the card had it, scaled the same way: ×2 "plus 2 yolks", ×½ "plus ½ yolk".
    if (p.plus) {
      const plus = plusText(p.plus, scaled ? factor : 1);
      if (p.plus.at === 'note') out.note = out.note ? plus + ', ' + out.note : plus;
      else out.item += ' ' + plus;
    }
  }
  return out;
}

function plusText(plus, factor) {
  if (factor === 1) return plus.text;
  const n = plus.q * factor, n2 = plus.q2 == null ? null : plus.q2 * factor;
  const was = plus.q2 ?? plus.q, top = n2 ?? n;
  const qty = amountText(n, '') + (n2 != null ? '–' + amountText(n2, '') : '');
  return `${plus.word} ${qty} ${(was > 1) !== (top > 1) ? recountThing(plus.item, top) : plus.item}`;
}

// Only the thing counted changes number, not the words about what it's for: "plus 2 beaten eggs for glazing",
// "plus 2 for brushing", "plus 2 more if needed".
function recountThing(item, n) {
  const m = /\s*\b(?:for|to|if|as|in|into|on|at|from|until|when)\b/i.exec(item);
  const thing = m ? item.slice(0, m.index) : item;
  if (!thing || /\b(?:more|extra|other)$/i.test(thing)) return item;
  return recount(thing, n) + item.slice(thing.length);
}

const pAmbiguousCount = p => p.q == null || !p.item;

function rangeParts(first, value2, fn) {
  const second = fn(value2);
  if (second.u === first.u) return [{ ...first, q2: second.q }];
  return [first];
}

function usVolume(ml, ml2, loose = false) {
  if (ml2 == null) return bestUS(ml, { loose });
  const [a] = bestUS(ml, { single: true });
  if (!a.u || a.q == null) return [a];
  return [{ q: a.q, q2: roundTo(ml2 / UNITS[a.u].ml, a.u), u: a.u }];
}

function spoonParts(ml, ml2) {
  if (ml2 != null) {
    const [a] = bestUS(ml, { single: true, spoons: true });
    if (a.q == null) return [a];
    return [{ q: a.q, q2: roundTo(ml2 / UNITS[a.u].ml, a.u), u: a.u }];
  }
  return bestUS(ml, { spoons: true });
}

function roundTo(x, u) {
  const d = Math.max(...(DENS[u] || [4]));
  return Math.round(x * d) / d;
}

function sizeText(size, mode) {
  const U = UNITS[size.u];
  if (mode === 'metric' && U.sys === 'us') {
    const r = U.kind === 'mass' ? grams(size.q * U.g) : millilitres(size.q * U.ml);
    return `${r.q} ${unitWord(r.u, 2)}`;
  }
  if (mode === 'us' && U.sys === 'metric') {
    const oz = U.kind === 'mass' ? size.q * U.g / UNITS.oz.g : size.q * U.ml / UNITS.floz.ml;
    // A packet of yeast is about ¼ oz: quarters under an ounce, never 0.
    const q = oz < 1 ? Math.max(0.25, round(oz, 0.25)) : round(oz, 0.5);
    return `${amountText(q, 'oz')} ${U.kind === 'mass' ? 'oz' : 'fl oz'}`;
  }
  return `${amountText(size.q, size.u, true)} ${unitWord(size.u, size.q > 1 ? 2 : 1)}`;
}

// The card's other amount, "(1 stick)" or "(240 ml)". At the card's own amounts it's the card's own figure, so
// "(3/8 cup)" isn't rounded to ⅓. Scaled, it's in that unit's usual fractions, or left out ('') when they can't
// say it closely: half of ⅛ cup is a tablespoon, not ¼ cup.
function altText(alt, factor, exact = false) {
  const q = alt.q * factor, q2 = alt.q2 == null ? null : alt.q2 * factor;
  const text = x => amountText(x, alt.u, exact);
  const off = x => Math.abs(readNumber(normalize(text(x)))?.v - x) > x * 0.1;
  if (!exact && (off(q) || (q2 != null && off(q2)))) return '';
  return `${text(q)}${q2 != null ? '–' + text(q2) : ''} ${unitWord(alt.u, (q2 ?? q) > 1 ? 2 : 1)}`;
}

// The shown line as plain text, for printing, copying and tests: "1½ cups all-purpose flour, sifted".
export const modBefore = mod => /^(about|approximately|approx|around|roughly)/.test(mod || '');
export function amountWords(v) {
  const before = modBefore(v.mod) ? v.mod : '', within = v.mod && !before ? v.mod : '';
  return [before, v.qty, within, v.unit].filter(Boolean).join(' ') + (v.more ? ' + ' + v.more : '') + (v.of ? ' of' : '');
}
export function lineText(v) {
  if (!v) return '';
  if (v.h) return v.h;
  const amount = amountWords(v);
  const alt = v.alt && !v.altEnd ? `(${v.alt})` : '';
  let head;
  if (v.pre) head = [v.pre, amount, v.item].filter(Boolean).join(' ');
  else head = [amount, alt, v.item].filter(Boolean).join(' ');
  if (v.alt && v.altEnd) head += ` (${v.alt})`;
  if (v.size) head += ` (${/s$/.test(v.unit) ? v.size + ' each' : v.size})`;
  const note = [v.note, v.hint].filter(Boolean).join('; ');
  return head + (note ? ', ' + note : '');
}

// The amount of an ingredient as a number in its own unit (for "I only have 3 eggs").
export function amountOf(line) {
  const p = parseLine(line);
  return p && p.q != null ? { q: p.q, u: p.u, item: p.item } : null;
}

// Ingredient lines split into sections: [{ h: 'For the glaze' | '', lines: [{ i, text, p }] }]
export function sections(lines) {
  const out = [{ h: '', lines: [] }];
  (lines || []).forEach((text, i) => {
    const p = parseLine(text);
    if (!p) return;
    if (p.h) out.push({ h: p.h, lines: [] });
    else out[out.length - 1].lines.push({ i, text, p });
  });
  return out.filter((s, i) => s.lines.length || (i > 0 && s.h));
}
