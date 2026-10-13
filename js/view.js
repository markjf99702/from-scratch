// Drawing a recipe's ingredients and steps, scaled and in the chosen units. Used by the recipe page,
// cook mode, the review of incoming recipes, and printing.
import { sections, present, lineText, kitchen, modBefore } from './ingredients.js';
import { yieldText } from './recipe.js';
import { findTimes, convertStep, formatDuration } from './text.js';
import { esc, amountHTML } from './ui.js';

export const UNIT_MODES = [['as', 'As written'], ['us', 'Cups'], ['metric', 'Grams']];

export function factorLabel(f) {
  if (Math.abs(f - 1) < 1e-9) return '×1';
  const k = kitchen(f, [2, 3, 4]);
  const back = [2, 3, 4].some(d => Math.abs(f * d - Math.round(f * d)) < 1e-6);
  return '×' + (back ? k : String(+f.toFixed(2)));
}
export function factorWords(f) {
  const words = { 0.5: 'Halved', 2: 'Doubled', 3: 'Tripled', 4: 'Quadrupled', 1.5: 'One and a half times' };
  return words[+f.toFixed(4)] || `Scaled ${factorLabel(f)}`;
}

// One ingredient as HTML: the amount in its own column, then the item and any note.
// "Juice of 1 lemon" keeps its words in order: "Juice of 1" in the amount column, "lemon" after it.
export function ingredientHTML(v) {
  const before = modBefore(v.mod) ? v.mod + ' ' : '', within = v.mod && !before ? ' ' + v.mod : '';
  const conv = v.conv ? ` <span class="conv" title="${esc(v.conv.source || 'Converted')}">≈</span>` : '';
  let amount = '';
  if (v.qty) {
    amount = (v.pre ? `<span class="pre">${esc(v.pre)}</span> ` : '') + esc(before) + amountHTML(v.qty) + esc(within) +
      (v.unit ? ' ' + esc(v.unit) : '') + (v.more ? ' + ' + amountHTML(v.more) : '') + conv;
  }
  const lead = !v.qty && v.pre ? esc(v.pre) + ' ' : '';
  const alt = v.alt && !v.altEnd ? `<span class="alt">(${amountHTML(v.alt)})</span> ` : '';
  const altEnd = v.alt && v.altEnd ? ` <span class="alt">(${amountHTML(v.alt)})</span>` : '';
  const note = [v.note, v.hint].filter(Boolean).map(esc).join('; ');
  const size = v.size ? ` <span class="size">(${amountHTML(sizeWords(v))})</span>` : '';
  return `<span class="amt">${amount}</span><span class="what">${lead}${alt}${v.of ? '<span class="of">of </span>' : ''}${esc(v.item)}${altEnd}${size}${note ? `<span class="note">, ${note}</span>` : ''}</span>`;
}

// "Serves 9 · Prep 20 min · Cook 40 min", each part kept on one line.
export function metaHTML(r, factor = 1) {
  const parts = [yieldText(r, factor), r.prep && `Prep ${r.prep}`, r.cook && `Cook ${r.cook}`, r.total && `Total ${r.total}`].filter(Boolean);
  return parts.map(p => `<span class="item">${esc(p)}</span>`).join(' · ');
}

export const sizeWords = v => (/s$/.test(v.unit) ? `${v.size} each` : v.size);

// The whole list, in sections. Returns { html, sources } where sources are the density notes used.
export function ingredientsHTML(r, { factor = 1, mode = 'as', ticked = new Set(), only = null, tick = true } = {}) {
  const used = new Map();
  let html = '';
  for (const sec of sections(r.ingredients)) {
    const rows = sec.lines.filter(l => !only || only.includes(l.i));
    if (!rows.length) continue;
    if (sec.h) html += `<h3 class="sect">${esc(sec.h)}</h3>`;
    html += '<ul class="ings">' + rows.map(({ i, p }) => {
      const v = present(p, { factor, mode });
      if (v.conv?.density) used.set(v.conv.density.name, v.conv.density);
      const on = ticked.has(i);
      const body = ingredientHTML(v);
      return tick
        ? `<li class="ing${on ? ' got' : ''}" data-i="${i}"><button type="button" class="tick" aria-pressed="${on}" aria-label="${esc(lineText(v))}">${body}</button></li>`
        : `<li class="ing" data-i="${i}">${body}</li>`;
    }).join('') + '</ul>';
  }
  return { html, sources: [...used.values()] };
}

export function sourcesNote(sources, mode) {
  if (!sources.length) return mode === 'metric' ? '<p class="fine">Teaspoons and tablespoons stay as spoons (5 ml and 15 ml). Amounts marked ≈ are converted.</p>' : mode === 'us' ? '<p class="fine">Amounts marked ≈ are converted.</p>' : '';
  const list = sources.map(d => `${esc(d.name)} ${d.g} g`).join(', ');
  const verb = mode === 'metric' ? 'Weights marked ≈ come from' : 'Cups marked ≈ come from';
  return `<p class="fine">${verb} USDA FoodData Central cup weights: ${list} per cup, spooned and levelled. A cup of flour scooped from the bag weighs more.${mode === 'metric' ? ' Teaspoons stay as spoons.' : ''}</p>`;
}

// A step as HTML: converted temperatures and pan sizes, and each time as a button that starts a timer.
export function stepHTML(step, { mode = 'as', index = 0, recipe = '' } = {}) {
  let html = '';
  for (const part of convertStep(step, mode)) {
    if (part.was) { html += `<span class="conv-t" title="${esc(part.was)} on the card">${esc(part.text)}</span>`; continue; }
    const times = findTimes(part.text);
    let at = 0;
    for (const t of times) {
      html += esc(part.text.slice(at, t.start));
      const label = t.label || `Step ${index + 1}`;
      const tail = /^[.,;:!?)]*/.exec(part.text.slice(t.end))[0];
      html += `<span class="nw"><button type="button" class="tm" data-secs="${t.secs}" data-secs2="${t.secs2 || ''}" data-label="${esc(label)}" data-recipe="${esc(recipe)}" data-step="${index}" aria-label="Start a ${esc(formatDuration(t.secs))} timer: ${esc(label)}">${esc(t.text)}</button>${esc(tail)}</span>`;
      at = t.end + tail.length;
    }
    html += esc(part.text.slice(at));
  }
  return html;
}

// Plain text of a whole recipe, for copying and for the printed card.
export function presentLines(r, factor, mode) {
  return sections(r.ingredients).flatMap(sec => [
    ...(sec.h ? [{ h: sec.h }] : []),
    ...sec.lines.map(({ p }) => present(p, { factor, mode })),
  ]);
}
