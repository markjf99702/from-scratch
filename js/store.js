// The recipe box in this browser's localStorage: the working copy on this device.
// Google Drive, backups and links all merge into it through mergeBoxes, recipe by recipe.
import { cleanBox, cleanRecipe, mergeBoxes, live, byTitle, canon } from './recipe.js';

export const KEY = 'fromscratch.box';
export const PREFS = 'fromscratch.prefs';

function read() {
  try { return cleanBox(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return { recipes: {} }; }
}

let state = read();
let seq = 0; // counts saves made on this page, so a sync can tell if something changed while it ran
const listeners = new Set();

function write() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; }
}
const emit = why => listeners.forEach(fn => { try { fn(why); } catch (e) { console.error(e); } });

export const box = {
  get state() { return state; },
  get seq() { return seq; },
  all: () => live(state).sort(byTitle),
  get: id => (state.recipes[id] && !state.recipes[id].del ? state.recipes[id] : null),
  has: id => !!state.recipes[id],
  // Saves a recipe, stamping it with a change time later than any it had.
  put(r, why = 'local') {
    const prev = state.recipes[r.id];
    const clean = cleanRecipe({ ...r, t: Math.max(Date.now(), (prev?.t || 0) + 1) });
    if (!clean) return null;
    state = { recipes: { ...state.recipes, [clean.id]: clean } };
    if (!write()) emit('full');
    seq++;
    emit(why);
    return clean;
  },
  remove(id) {
    const prev = state.recipes[id];
    if (!prev || prev.del) return;
    state = { recipes: { ...state.recipes, [id]: { id, t: Math.max(Date.now(), prev.t + 1), del: 1 } } };
    write();
    seq++;
    emit('local');
    return prev;
  },
  // Adds recipes from a link or file. A recipe already here (same id) is left alone unless replace is set.
  add(recipes, { replace = false } = {}) {
    const added = [];
    for (const r of recipes) {
      if (box.get(r.id) && !replace) continue;
      added.push(box.put(r, 'quiet'));
    }
    if (added.length) emit('local');
    return added.filter(Boolean);
  },
  // Merges another box in (a backup, or the Drive copy). Returns the number of recipes that changed here.
  merge(other, why = 'merge') {
    const merged = mergeBoxes(state, other);
    const changed = Object.keys(merged.recipes).filter(id => canon(merged.recipes[id]) !== canon(state.recipes[id])).length;
    if (changed) { state = merged; write(); seq++; emit(why); }
    return changed;
  },
  // Replaces the box with one that already includes everything here (after a sync).
  replace(next, why = 'sync') {
    if (canon(next) === canon(state)) return false;
    state = next;
    write();
    emit(why);
    return true;
  },
  // Another tab changed localStorage: read it again.
  reload(why = 'storage') {
    const fresh = read();
    if (canon(fresh) === canon(state)) return false;
    state = fresh;
    emit(why);
    return true;
  },
  erase() {
    state = { recipes: {} };
    try { localStorage.removeItem(KEY); } catch { /* nothing to remove */ }
    seq++;
    emit('local');
  },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

// Settings for this device only; they don't sync.
const DEFAULT_PREFS = { units: 'as', wake: true, big: false, sound: true };
let prefState = (() => { try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS) || '{}') }; } catch { return { ...DEFAULT_PREFS }; } })();
export const prefs = {
  get: k => prefState[k],
  set(k, v) { prefState = { ...prefState, [k]: v }; try { localStorage.setItem(PREFS, JSON.stringify(prefState)); } catch { /* only for this visit */ } },
  reload() { try { prefState = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS) || '{}') }; } catch { /* keep */ } },
};
