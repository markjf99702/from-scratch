// Links that carry recipes: one sent to family, or a batch Claude typed up from photos of cards.
// Everything travels in the part of the link after #, which browsers never send to a server.
//
//   #/add/z<data>   the recipes as JSON, compressed with raw DEFLATE, then base64url without padding
//   #/add/j<data>   the same JSON, base64url, not compressed (for tools without DEFLATE)
//
// The JSON is { "fromScratch": 1, "recipes": [ … ] }, with each recipe as described in
// skill/from-scratch-cards/references/format.md.
import { cleanRecipe, cleanBox } from './recipe.js';

export const SITE = 'https://junkdrawer.works/from-scratch/';

// Where links should point: this page on the real site or a local copy, the real site otherwise
// (for example the single-file copy, which lives somewhere a link can't reach).
export function base(loc = globalThis.location) {
  if (!loc || !/^https?:$/.test(loc.protocol)) return SITE;
  if (globalThis.document?.documentElement && 'single' in document.documentElement.dataset) return SITE;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(loc.hostname);
  if (local || loc.hostname === 'junkdrawer.works') return loc.origin + loc.pathname;
  return SITE;
}

const b64url = bytes => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = s => {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  const bin = atob(b), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
async function through(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

export async function pack(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'function') {
    try { return 'z' + b64url(await through(bytes, new CompressionStream('deflate-raw'))); } catch { /* fall through */ }
  }
  return 'j' + b64url(bytes);
}

export async function unpack(data) {
  const kind = data[0], bytes = unb64url(data.slice(1));
  if (kind === 'j') return JSON.parse(new TextDecoder().decode(bytes));
  if (kind !== 'z') throw new Error('not a From Scratch link');
  if (typeof DecompressionStream !== 'function') throw new Error('This browser is too old to open recipe links. Ask for the file instead.');
  return JSON.parse(new TextDecoder().decode(await through(bytes, new DecompressionStream('deflate-raw'))));
}

// What a link carries: only the recipe, never its change time or anything about this device.
export function forLink(r) {
  const { t, sample, check, ...rest } = r;
  return rest;
}

export async function recipeLink(recipes) {
  return `${base()}#/add/${await pack({ fromScratch: 1, recipes: recipes.map(forLink) })}`;
}

export const LINK_RX = /#\/add\/([zj][A-Za-z0-9_-]+)\s*$/;

// Text from a link, a file or the paste box → { kind: 'batch', name, recipes } or { kind: 'backup', box, photos }.
export async function readIncoming(text) {
  const t = String(text || '').trim();
  const m = LINK_RX.exec(t);
  const obj = m && t[0] !== '{' ? await unpack(m[1]) : JSON.parse(t);
  if (obj && obj.fromScratch && obj.box) return { kind: 'backup', box: cleanBox(obj.box), photos: obj.photos && typeof obj.photos === 'object' ? obj.photos : {} };
  const list = Array.isArray(obj) ? obj : Array.isArray(obj?.recipes) ? obj.recipes : obj?.title ? [obj] : null;
  if (!list) throw new Error('empty');
  // "unsure" (from Claude) becomes the recipe's "check" note, shown until someone says it's right.
  const recipes = list.slice(0, 200).map(x => cleanRecipe({ ...x, t: 0, check: x?.unsure || x?.check || '' })).filter(r => r && !r.del);
  if (!recipes.length) throw new Error('empty');
  return { kind: 'batch', name: String(obj?.name || '').slice(0, 120), recipes };
}
