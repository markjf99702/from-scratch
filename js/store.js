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
let full = false; // the last change couldn't be saved: this browser's storage is full
const listeners = new Set();

function write() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; }
}
const emit = why => listeners.forEach(fn => { try { fn(why); } catch (e) { console.error(e); } });

// Takes the new box only if it can be saved. Otherwise the box stays as it was, so the page never shows
// something that's gone after a reload, and listeners hear 'full' (unless quiet).
function commit(next, quiet = false) {
  const prev = state;
  state = next;
  if (write()) return true;
  state = prev;
  full = true;
  if (!quiet) emit('full');
  return false;
}

function putOne(r, why) {
  const prev = state.recipes[r.id];
  const clean = cleanRecipe({ ...r, t: Math.max(Date.now(), (prev?.t || 0) + 1) });
  if (!clean || !commit({ recipes: { ...state.recipes, [clean.id]: clean } })) return null;
  seq++;
  emit(why);
  return clean;
}

export const box = {
  get state() { return state; },
  get seq() { return seq; },
  // True when the last change couldn't be saved because this browser's storage is full.
  get full() { return full; },
  all: () => live(state).sort(byTitle),
  get: id => (state.recipes[id] && !state.recipes[id].del ? state.recipes[id] : null),
  has: id => !!state.recipes[id],
  // Saves a recipe, stamping it with a change time later than any it had. Null if it couldn't be saved.
  put(r, why = 'local') {
    full = false;
    return putOne(r, why);
  },
  // Takes a recipe out, leaving a removal marker. Returns the recipe as it was, or nothing if it couldn't.
  remove(id) {
    full = false;
    const prev = state.recipes[id];
    if (!prev || prev.del) return;
    if (!commit({ recipes: { ...state.recipes, [id]: { id, t: Math.max(Date.now(), prev.t + 1), del: 1 } } })) return;
    seq++;
    emit('local');
    return prev;
  },
  // Adds recipes from a link or file. A recipe already here (same id) is left alone unless replace is set.
  add(recipes, { replace = false } = {}) {
    full = false;
    const added = [];
    for (const r of recipes) {
      if (box.get(r.id) && !replace) continue;
      added.push(putOne(r, 'quiet'));
    }
    if (added.some(Boolean)) emit('local');
    return added.filter(Boolean);
  },
  // Merges another box in (a backup, or the Drive copy). Returns the number of recipes that changed here,
  // or null if they couldn't be saved.
  merge(other, why = 'merge') {
    full = false;
    const merged = mergeBoxes(state, other);
    const changed = Object.keys(merged.recipes).filter(id => canon(merged.recipes[id]) !== canon(state.recipes[id])).length;
    if (changed) {
      if (!commit(merged)) return null;
      seq++;
      emit(why);
    }
    return changed;
  },
  // Replaces the box with one that already includes everything here (after a sync). False if it couldn't be
  // saved; the sync says so itself.
  replace(next, why = 'sync') {
    full = false;
    if (canon(next) === canon(state)) return true;
    if (!commit(next, true)) return false;
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
