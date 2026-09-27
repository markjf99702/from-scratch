// Reading the words of a recipe: times in the steps ("bake 25–30 minutes"), oven temperatures and pan sizes,
// which ingredients each step uses, and a whole recipe pasted in as one block of text.
// No page code here, so the tests run it in Node.
import { parseLine, headingOf, normalize, singular } from './ingredients.js';
import { fToC, cToF } from './units.js';

// ---------- times ----------
const NUMWORD = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, fifty: 50, sixty: 60, ninety: 90 };
const NUM = String.raw`(?:\d+(?:\.\d+)?(?:\s*(?:½|¼|¾|1/2|1/4|3/4))?|½|¼|¾|half(?:\s+an?)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty-five|forty|fifty|sixty|ninety)`;
const TUNIT = String.raw`(?:hours?|hrs?\.?|minutes?|mins?\.?|seconds?|secs?\.?)`;
const TIME_RX = new RegExp(String.raw`\b(${NUM})(?:\s*(?:-|–|—|to|or)\s*(${NUM}))?\s*-?\s*(${TUNIT})(?:\s*,?\s*(?:and\s+)?(${NUM})\s*-?\s*(minutes?|mins?\.?))?(?![a-z])`, 'gi');
const VERBS = /^(bake|roast|simmer|boil|cook|fry|saut[eé]|braise|steam|poach|broil|grill|toast|rest|let|leave|chill|refrigerate|freeze|cool|rise|proof|prove|knead|beat|whisk|stir|mix|blend|soak|marinate|steep|cover|microwave|reduce|brown|sear|caramelize|set|stand|heat|preheat|cream|process|pulse|shake|drain|bring|continue|keep)$/i;

function numValue(s) {
  s = s.trim().toLowerCase();
  if (/^half/.test(s)) return 0.5;
  if (NUMWORD[s] != null) return NUMWORD[s];
  const m = /^(\d+(?:\.\d+)?)?\s*(½|¼|¾|1\/2|1\/4|3\/4)?$/.exec(s);
  if (!m) return NaN;
  const frac = { '½': 0.5, '¼': 0.25, '¾': 0.75, '1/2': 0.5, '1/4': 0.25, '3/4': 0.75 }[m[2]] || 0;
  return (m[1] ? +m[1] : 0) + frac;
}
const unitSecs = u => (/^h/i.test(u) ? 3600 : /^m/i.test(u) ? 60 : 1);

// Every time in a step: [{ start, end, text, secs, secs2, label }]. secs2 is the top of a range ("25–30 minutes").
export function findTimes(step) {
  const text = String(step || ''), out = [];
  TIME_RX.lastIndex = 0;
  let m;
  while ((m = TIME_RX.exec(text))) {
    const per = unitSecs(m[3]);
    const a = numValue(m[1]), b = m[2] ? numValue(m[2]) : null;
    if (!(a > 0) || (b != null && !(b > a))) continue;
    if (/^an?$/i.test(m[1]) && m[2]) continue;
    let secs = Math.round(a * per), secs2 = b != null ? Math.round(b * per) : null;
    if (m[4] && !m[2] && per === 3600) secs += Math.round(numValue(m[4]) * 60);
    if (!(secs > 0) || secs > 48 * 3600) continue;
    out.push({ start: m.index, end: m.index + m[0].length, text: m[0], secs, secs2, label: labelFor(text, m.index) });
  }
  return out;
}

// The verb that starts the sentence a time is in ("Bake", "Let rise"), for naming a timer.
function labelFor(text, at) {
  const before = text.slice(0, at);
  const cut = Math.max(...['. ', '; ', ': ', '! ', '\n'].map(x => before.lastIndexOf(x)));
  const words = before.slice(cut + 1).trim().split(/\s+/).map(w => w.replace(/[^A-Za-zé-]/g, '')).filter(Boolean);
  const cap = w => w[0].toUpperCase() + w.slice(1).toLowerCase();
  for (let i = words.length - 1; i >= 0; i--) {
    if (!VERBS.test(words[i]) || /^(let|leave|set|keep|continue)$/i.test(words[i]) && i < words.length - 1) continue;
    if (i > 0 && /^(let|leave)$/i.test(words[i - 1])) return cap(words[i - 1]) + ' ' + words[i].toLowerCase();
    return cap(words[i]);
  }
  return '';
}

export function formatDuration(secs) {
  if (secs >= 3600) {
    const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
    return m ? `${h} hr ${m} min` : `${h} hr`;
  }
  if (secs >= 60) {
    const m = Math.floor(secs / 60), s = secs % 60;
    return s ? `${m} min ${s} sec` : `${m} min`;
  }
  return `${secs} sec`;
}

// "25–30 min", "1–1½ hr"
export function formatRange(a, b) {
  if (b < 3600 && a % 60 === 0 && b % 60 === 0) return `${a / 60}–${b / 60} min`;
  if (a % 1800 === 0 && b % 1800 === 0 && a >= 3600) { const h = x => (x / 3600 % 1 ? Math.floor(x / 3600) + '½' : x / 3600); return `${h(a)}–${h(b)} hr`; }
  return `${formatDuration(a)} to ${formatDuration(b)}`;
}

// A clock face for a running timer: 24:05, 1:02:09.
export function clock(secs) {
  secs = Math.max(0, Math.ceil(secs));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  const two = n => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

// ---------- oven temperatures and pan sizes ----------
const TEMP_RX = /\b(\d{3})\s*(?:°|º|˚|degrees?\b|deg\b)(?:\s*(F|C|fahrenheit|celsius|centigrade)\b)?/gi;
const BARE_RX = /\b((?:bake|roast|oven|heat|preheat(?:ed)?(?: the)?(?: oven)?|set(?: the)?(?: oven)?)?\s*(?:at|to)\s+)(\d{3})\b(?!\s*(?:°|º|˚|degrees?|deg|g\b|grams?|ml|mm|cm|calories|kcal|watts?|w\b|%|x\b|×))/gi;
const INCH_RX = /(?<![\w½¼¾/.])((?:\d+\s*[½¼¾]|\d+(?:\s+\d\/\d)?|\d\/\d|[½¼¾])(?:\s*[x×]\s*(?:\d+\s*[½¼¾]|\d+(?:\s+\d\/\d)?|\d\/\d|[½¼¾]))*)\s*(?:-\s*|\s)?(?:inch(?:es)?\b|in\.(?=\s)|["”″])/gi;
const CM_RX = /\b(\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?)*)\s*(?:-\s*|\s)?cm\b/gi;

// A step split into plain text and converted pieces: [{ text }, { text: '180°C', was: '350°F' }].
// Metric shows oven temperatures in °C and pan sizes in cm; US shows °F and inches. As written leaves them.
export function convertStep(step, mode) {
  const text = String(step || '');
  if (mode !== 'metric' && mode !== 'us') return [{ text }];
  const hits = [];
  TEMP_RX.lastIndex = 0;
  let m;
  while ((m = TEMP_RX.exec(text))) {
    const v = +m[1];
    const unit = m[2] ? m[2][0].toUpperCase() : v >= 250 ? 'F' : 'C';
    if (v < 100 || v > 600) continue;
    if (mode === 'metric' && unit === 'F') hits.push({ start: m.index, end: m.index + m[0].length, text: `${Math.round(fToC(v) / 10) * 10}°C`, was: m[0].trim() });
    if (mode === 'us' && unit === 'C') hits.push({ start: m.index, end: m.index + m[0].length, text: `${Math.round(cToF(v) / 25) * 25}°F`, was: m[0].trim() });
  }
  // "Bake at 350 for 30 min": an oven temperature with no degree sign.
  BARE_RX.lastIndex = 0;
  while ((m = BARE_RX.exec(text))) {
    const v = +m[2], start = m.index + m[1].length;
    if (v < 200 || v > 550 || hits.some(h => h.start <= start && start < h.end)) continue;
    const unit = v >= 250 ? 'F' : 'C';
    if (mode === 'metric' && unit === 'F') hits.push({ start, end: start + m[2].length, text: `${Math.round(fToC(v) / 10) * 10}°C`, was: `${v}°F` });
    if (mode === 'us' && unit === 'C') hits.push({ start, end: start + m[2].length, text: `${Math.round(cToF(v) / 25) * 25}°F`, was: `${v}°C` });
  }
  if (mode === 'metric') {
    INCH_RX.lastIndex = 0;
    while ((m = INCH_RX.exec(text))) {
      const dims = m[1].split(/\s*[x×]\s*/).map(x => inchValue(x));
      if (dims.some(d => !(d > 0) || d > 40)) continue;
      const cm = dims.map(d => { const c = d * 2.54; return c < 3 ? String(+c.toFixed(1)) : String(Math.round(c)); });
      hits.push({ start: m.index, end: m.index + m[0].length, text: cm.join(' × ') + ' cm', was: m[0].trim() });
    }
  } else {
    CM_RX.lastIndex = 0;
    while ((m = CM_RX.exec(text))) {
      const dims = m[1].split(/\s*[x×]\s*/).map(x => +x.replace(',', '.'));
      if (dims.some(d => !(d > 0) || d > 100)) continue;
      const inch = dims.map(d => { const i = d / 2.54; return i < 3 ? fracInch(i) : String(Math.round(i)); });
      const hyphen = /-\s*cm/i.test(m[0]);
      hits.push({ start: m.index, end: m.index + m[0].length, text: inch.join(' × ') + (hyphen ? '-inch' : ' inch'), was: m[0].trim() });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const out = [];
  let at = 0;
  for (const h of hits) {
    if (h.start < at) continue;
    if (h.start > at) out.push({ text: text.slice(at, h.start) });
    out.push({ text: h.text, was: h.was });
    at = h.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

function inchValue(s) {
  s = normalize(s);
  const m = /^(\d+)?\s*(?:(\d)\/(\d))?$/.exec(s.trim());
  if (!m) return NaN;
  return (m[1] ? +m[1] : 0) + (m[2] ? m[2] / m[3] : 0);
}
function fracInch(i) {
  const q = Math.max(0.25, Math.round(i * 4) / 4), whole = Math.floor(q), r = q - whole;
  return (whole || '') + ({ 0.25: '¼', 0.5: '½', 0.75: '¾' }[r] || '') || '0';
}

// Amounts written inside a step ("add 1 cup of the sugar") don't scale with the ingredient list.
export const stepHasAmounts = step => /\b\d+(?:\s+\d\/\d|\/\d)?\s*(?:cups?|c\.|tbsps?|tablespoons?|tsps?|teaspoons?|oz|ounces?|lbs?|pounds?|g|grams?|ml)\b/i.test(normalize(step));

// ---------- which ingredients each step uses ----------
const DROP = new Set(('large small medium extra fresh freshly chopped minced diced sliced grated shredded softened melted cold warm hot room temperature ripe packed firmly lightly sifted unsalted salted ' +
  'granulated all purpose all-purpose finely coarsely roughly thinly ground boneless skinless dried canned frozen extra-virgin virgin light dark whole beaten divided plus more for of the a an and or ' +
  'good quality homemade store-bought optional peeled cored seeded pitted crushed cubed halved quartered toasted cooked uncooked raw prepared about heaping scant level rounded pure plain').split(' '));
const WORD = /[a-z][a-z'-]*/g;

function words(s) {
  return (String(s || '').toLowerCase().replace(/[’]/g, "'").match(WORD) || []).map(w => singular(w.replace(/'s$|'$/, '')));
}

// For each ingredient line, the phrases a step might call it by, longest first: "light brown sugar" → [light brown sugar, brown sugar, sugar].
// "Salt and pepper" is called "salt" in one step and "pepper" in another, so each part gets its own phrases too.
function phrasesFor(item) {
  const main = item.replace(/\([^)]*\)/g, ' ').split(/\bor\b/)[0];
  const core = words(main).filter(w => !DROP.has(w));
  if (!core.length) return [];
  const out = [];
  for (let i = 0; i < core.length; i++) out.push(core.slice(i));
  const parts = main.split(/\s+(?:and|&)\s+/);
  if (parts.length > 1) for (const part of parts) {
    const c = words(part).filter(w => !DROP.has(w));
    for (let i = 0; i < c.length; i++) out.push(c.slice(i));
  }
  if (core.includes('egg')) out.push(['egg']);
  if (core.includes('yolk')) out.push(['yolk']);
  if (core.includes('white') && core.includes('egg')) out.push(['white']);
  return out.sort((a, b) => b.length - a.length).filter((p, i, a) => a.findIndex(q => q.join(' ') === p.join(' ')) === i);
}
const GLUE = new Set(['and', 'or', 'the', 'a', 'an', '&']);
// "until no flour shows" and "the flour mixture" mention an ingredient without using it here.
const mentionOnly = (sw, at, len) => sw[at - 1] === 'no' || /^(mixture|mix|batter|dough)$/.test(sw[at + len] || '');

function findPhrase(stepWords, phrase) {
  for (let i = 0; i + phrase.length <= stepWords.length; i++) {
    let ok = true;
    for (let j = 0; j < phrase.length; j++) if (stepWords[i + j] !== phrase[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

// steps: [string]; lines: the ingredient lines. Returns, for each step, the indexes of the lines it uses.
// A step that names a section ("For the glaze, whisk the sugar…") takes that section's sugar, not the cake's.
export function stepIngredients(lines, steps) {
  const items = [], sectionsSeen = [];
  let section = 0;
  (lines || []).forEach((text, i) => {
    const p = parseLine(text);
    if (!p) return;
    if (p.h) {
      section++;
      const key = words(p.h).filter(w => !DROP.has(w) && !['make', 'to', 'for'].includes(w));
      sectionsSeen[section] = key.length ? key[key.length - 1] : '';
      return;
    }
    const phrases = phrasesFor((p.pre ? p.pre.replace(/\s+of$/i, '') + ' ' : '') + (p.item || text));
    if (phrases.length) items.push({ i, section, phrases, full: phrases[0].length });
  });
  return (steps || []).map(step => {
    const sw = words(step).filter(w => !GLUE.has(w));
    const named = new Set(sectionsSeen.map((k, s) => (k && sw.includes(k) ? s : -1)).filter(s => s > 0));
    const hits = [];
    for (const it of items) {
      for (const ph of it.phrases) {
        const at = findPhrase(sw, ph);
        if (at >= 0 && !mentionOnly(sw, at, ph.length)) { hits.push({ ...it, at, len: ph.length, head: ph[ph.length - 1], whole: ph.length === it.full }); break; }
      }
    }
    // A longer name wins over a shorter one at the same spot ("brown sugar" over the white sugar's "sugar"),
    // and an ingredient called just that ("sugar") wins over one that only ends in it ("powdered sugar").
    const kept = hits.filter(h => !hits.some(o => o !== h && (o.len > h.len && h.at >= o.at && h.at + h.len <= o.at + o.len || o.at === h.at && o.len === h.len && o.whole && !h.whole && o.section === h.section)));
    // The same word in two sections: take the section the step names, or else the first one.
    const byHead = {};
    for (const h of kept) (byHead[h.head + '|' + h.len] ||= []).push(h);
    const out = [];
    for (const group of Object.values(byHead)) {
      const secs = new Set(group.map(h => h.section));
      let pick = group;
      if (secs.size > 1) {
        const inNamed = group.filter(h => named.has(h.section));
        pick = inNamed.length ? inNamed : group.filter(h => h.section === Math.min(...secs));
      }
      for (const h of pick) out.push(h.i);
    }
    return [...new Set(out)].sort((a, b) => a - b);
  });
}

// ---------- a whole recipe pasted as text ----------
const MARK_ING = /^(?:ingredients?|you(?:'|’)?ll need|you will need|what you(?:'|’)?ll need|what you need)\s*:?$/i;
const MARK_STEPS = /^(?:directions?|instructions?|method|steps?|preparation|how to make(?: it)?|to make|procedure)\s*:?$/i;
const MARK_NOTES = /^(?:notes?|tips?|cook(?:'|’)?s notes?|variations?)\s*:?$/i;
const FAMILY = /^((?:great[- ])?(?:grandma|grandpa|grandmother|grandfather|nana|nanna|nan|nonna|nonno|oma|opa|abuela|abuelo|bubbe|bubby|granny|gran|mamaw|papaw|meemaw|mammy|mom|mother|dad|father|mum|mama|papa|aunt|auntie|aunty|uncle|cousin|tia|tía|tio|tío|tante|zia)(?:\s+[A-Z][\w.'-]*){0,2})['’]s\s+(.+)$/i;

export function looksLikeIngredient(line) {
  const s = line.trim();
  if (!s) return false;
  if (/^[-•*·▪◦]\s+/.test(s)) return !/[.!?]$/.test(s) || s.split(/\s+/).length <= 8;
  const p = parseLine(s);
  if (p && p.q != null) return !/[.!?]$/.test(s) || s.split(/\s+/).length <= 7;
  if (/\bto taste\b|\bfor (serving|garnish|frying|the pan|greasing|dusting)\b|\bas needed\b/i.test(s)) return s.split(/\s+/).length <= 8;
  return false;
}
const looksLikeStep = s => /^(?:step\s*)?\d+\s*[.):-]\s+\S/i.test(s) || (s.split(/\s+/).length >= 6 && /[.!?)]$/.test(s)) || s.split(/\s+/).length >= 14;
const stripStepNumber = s => s.replace(/^(?:step\s*)?\d+\s*[.):-]\s*/i, '').trim();

function metaLine(s, out) {
  let hit = false;
  for (const part of s.split(/\s*[|•·;]\s*/)) {
    let m;
    if ((m = /^(?:serves|servings?|serving size|feeds|for)\s*:?\s*(\d+(?:\s*(?:-|–|to|or)\s*\d+)?)(?:\s+(?:people|persons?|servings?))?\.?$/i.exec(part))) { out.serves = m[1].replace(/\s*(?:-|–|to|or)\s*/, '–'); hit = true; }
    else if ((m = /^(?:makes|yield|yields|makes about)\s*:?\s*(.+?)\.?$/i.exec(part))) { out.makes = m[1].replace(/^about\s+/i, 'about '); hit = true; }
    else if ((m = /^prep(?:aration)?(?:\s+time)?\s*:?\s*(.+?)\.?$/i.exec(part))) { out.prep = shortTime(m[1]); hit = true; }
    else if ((m = /^(?:cook(?:ing)?|bake|baking|roast(?:ing)?)(?:\s+time)?\s*:\s*(.+?)\.?$/i.exec(part)) || (m = /^(?:cook(?:ing)?|bake|baking)\s+time\s+(.+?)\.?$/i.exec(part))) { out.cook = shortTime(m[1]); hit = true; }
    else if ((m = /^total(?:\s+time)?\s*:?\s*(.+?)\.?$/i.exec(part))) { out.total = shortTime(m[1]); hit = true; }
    else if ((m = /^(?:from the kitchen of|recipe from|from|by|source)\s*:?\s+(.+?)\.?$/i.exec(part)) && part.length < 70) { out.from = m[1]; hit = true; }
  }
  return hit;
}
export function shortTime(s) {
  return String(s).trim().replace(/\bhours?\b|\bhrs?\b\.?/gi, 'hr').replace(/\bminutes?\b|\bmins?\b\.?/gi, 'min').replace(/\s+/g, ' ').slice(0, 40);
}

// Pasted text → { title, from, serves, makes, prep, cook, ingredients: [], steps: [], notes }.
// It looks for headings like "Ingredients" and "Directions"; without them, a run of lines that start with an
// amount is the ingredient list, and the sentences after it are the steps.
export function splitRecipe(text) {
  const out = { title: '', from: '', serves: '', makes: '', prep: '', cook: '', total: '', ingredients: [], steps: [], notes: '' };
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/\s+/g, ' ').trim());
  let mode = 'head', numbered = false, blank = false;
  const notes = [], intro = [];
  for (const line of lines) {
    if (!line) { blank = true; continue; }
    const wasBlank = blank;
    blank = false;
    if (MARK_ING.test(line)) { mode = 'ing'; continue; }
    if (MARK_STEPS.test(line)) { mode = 'steps'; continue; }
    if (MARK_NOTES.test(line)) { mode = 'notes'; continue; }
    if (mode !== 'steps' && mode !== 'notes' && metaLine(line, out)) continue;
    if (mode === 'head') {
      if (looksLikeIngredient(line) || (out.title && headingOf(line) && !looksLikeStep(line))) mode = 'ing';
      else if (!out.title && line.length <= 90 && !looksLikeStep(line)) { out.title = line.replace(/^#+\s*/, '').replace(/\*\*/g, ''); continue; }
      else if (looksLikeStep(line) && out.title && intro.length === 0 && /^(?:step\s*)?\d+\s*[.):-]/i.test(line)) mode = 'steps';
      else { intro.push(line); continue; }
    }
    if (mode === 'ing') {
      const h = headingOf(line);
      if (looksLikeIngredient(line) || (h && !looksLikeStep(line))) { out.ingredients.push(line.replace(/^[-•*·▪◦]\s+/, '')); continue; }
      if (looksLikeStep(line) || /^[A-Z][a-z]+ (the|in|a|all|together|until|to|over)\b/.test(line)) mode = 'steps';
      else { out.ingredients.push(line); continue; }
    }
    if (mode === 'steps') {
      const isNum = /^(?:step\s*)?\d+\s*[.):-]\s*\S/i.test(line);
      if (isNum) numbered = true;
      const body = stripStepNumber(line);
      const last = out.steps.length - 1;
      const joins = last >= 0 && !isNum && (numbered ? !wasBlank || !/[.!?)]$/.test(out.steps[last]) : !/[.!?:)]$/.test(out.steps[last]) && /^[a-z(]/.test(body));
      if (joins) out.steps[last] += ' ' + body;
      else out.steps.push(body);
      continue;
    }
    if (mode === 'notes') notes.push(line);
  }
  if (!out.title && intro.length) out.title = intro.shift();
  const fam = FAMILY.exec(out.title);
  if (fam && !out.from) { out.from = fam[1]; out.title = fam[2]; }
  out.notes = [...intro, ...notes].join('\n');
  return out;
}
