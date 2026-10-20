// Printing a recipe: on a 4 × 6 inch index card like the ones in the tin, or on letter or A4 paper.
// The page's own print styles (css/app.css, @media print) hide everything but #printRoot.
import { $, esc } from './ui.js';
import { yieldText, timeLine } from './recipe.js';
import { convertStep } from './text.js';
import { presentLines, ingredientHTML, factorWords } from './view.js';

// An index card lies on its side: 6 inches wide, 4 high, and its margins, in inches.
const CARD = { w: 6, h: 4, top: 0.2, side: 0.25, bottom: 0.16 };
const PAGES = {
  card: `@page { size: ${CARD.w}in ${CARD.h}in; margin: ${CARD.top}in ${CARD.side}in ${CARD.bottom}in; }`,
  letter: '@page { size: letter; margin: 0.6in 0.7in; }',
  a4: '@page { size: A4; margin: 16mm 18mm; }',
};

// Builds the printable copy; print() then opens the browser's print window.
export async function preparePrint(r, { paper = 'card', factor = 1, mode = 'as', photo = null, lines = true } = {}) {
  const root = $('printRoot');
  const scaled = Math.abs(factor - 1) > 1e-9;
  const meta = [yieldText(r, factor), timeLine(r), scaled ? factorWords(factor) : ''].filter(Boolean).join(' · ');
  const rows = presentLines(r, factor, mode);
  const steps = (r.steps || []).map(s => convertStep(s, mode).map(p => esc(p.text)).join(''));
  const url = photo ? URL.createObjectURL(photo) : '';
  root.innerHTML = `
    <article class="pcard ${paper === 'card' ? 'is-card' : 'is-page'}">
      <header class="p-head">
        <h1 class="p-title">${esc(r.title)}</h1>
        ${r.from ? `<p class="p-from"><span>From the kitchen of</span> <b>${esc(r.from)}</b></p>` : ''}
      </header>
      ${meta ? `<p class="p-meta">${esc(meta)}</p>` : ''}
      <div class="p-body">
        <ul class="p-ings">${rows.map(v => (v.h ? `<li class="p-sect">${esc(v.h)}</li>` : `<li>${ingredientHTML(v)}</li>`)).join('')}</ul>
        <ol class="p-steps">${steps.map(s => `<li>${s}</li>`).join('')}</ol>
        ${r.notes ? `<p class="p-notes">${esc(r.notes).replace(/\n/g, '<br>')}</p>` : ''}
      </div>
      ${url ? `<figure class="p-photo"><img src="${url}" alt=""></figure>` : ''}
      <p class="p-foot">From Scratch · junkdrawer.works/from-scratch</p>
    </article>`;
  let style = $('pageSize');
  if (!style) { style = document.createElement('style'); style.id = 'pageSize'; document.head.append(style); }
  style.textContent = PAGES[paper] || PAGES.card;
  document.documentElement.dataset.print = paper === 'card' ? 'card' : 'page';
  document.documentElement.dataset.lines = lines ? '1' : '0';
  await Promise.all([...root.querySelectorAll('img')].map(img => (img.complete ? null : new Promise(res => { img.onload = img.onerror = res; }))));
  if (paper === 'card') await splitCards(root, r.title);
  await document.fonts?.ready;
}

// A recipe too long for one index card carries on to another, and each card after the first starts with
// "<name> (continued)". To find where, the card is laid out off screen at its printed size, with its two columns
// cut to the card's height: the first ingredient, step or note that doesn't fit starts the next card. A step isn't
// split between cards, and a section heading goes with the lines under it.
async function splitCards(root, title) {
  const page = (CARD.h - CARD.top - CARD.bottom) * 96; // the card's height inside its margins, in px
  root.style.cssText = `display: block; position: absolute; top: 0; left: -10000px; width: ${CARD.w - 2 * CARD.side}in; visibility: hidden;`;
  try {
    void root.offsetHeight; // laid out, so its fonts are on their way
    await document.fonts?.ready;
    let card = root.querySelector('.pcard');
    for (let n = 1; n < 10; n++) {
      const body = card.querySelector('.p-body');
      const blocks = [...body.querySelectorAll(':scope > ul > li, :scope > ol > li, :scope > p')];
      const left = page - (body.getBoundingClientRect().top - card.getBoundingClientRect().top);
      // A few px short, so a card never spills onto a page of its own.
      body.style.height = `${left - 4}px`;
      body.style.columnFill = 'auto';
      const edge = body.getBoundingClientRect();
      let at = blocks.findIndex(b => [...b.getClientRects()].some(rc => rc.right > edge.right + 1 || rc.bottom > edge.bottom + 1));
      body.style.height = body.style.columnFill = '';
      while (at > 0 && blocks[at - 1].classList.contains('p-sect')) at--;
      if (at <= 0) break; // it all fits, or not even the first line does
      body.style.minHeight = `${left - 1}px`; // its lines go on to the foot of the card, as on one that's full
      card = carryOn(card, blocks.slice(at), title);
    }
  } finally {
    root.style.cssText = '';
  }
}

// Moves these lines, steps and notes from the card to a new card after it, in lists like the ones they came from.
function carryOn(card, rest, title) {
  const next = document.createElement('article');
  next.className = 'pcard is-card p-more';
  next.innerHTML = `<p class="p-cont">${esc(title)} <span>(continued)</span></p><div class="p-body"></div>`;
  const body = next.querySelector('.p-body');
  for (const el of rest) {
    const from = el.parentElement;
    if (from.classList.contains('p-body')) { body.append(el); continue; }
    let into = body.lastElementChild;
    if (!into || into.className !== from.className) {
      into = body.appendChild(from.cloneNode(false));
      if (from.tagName === 'OL') into.start = from.start + [...from.children].indexOf(el); // steps keep their numbers
    }
    into.append(el);
  }
  for (const list of card.querySelectorAll('.p-body > ul, .p-body > ol')) if (!list.children.length) list.remove();
  card.after(next);
  return next;
}

export async function printRecipe(r, opts) {
  await preparePrint(r, opts);
  window.print();
}
