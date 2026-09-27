// Printing a recipe: on a 4 × 6 inch index card like the ones in the tin, or on letter or A4 paper.
// The page's own print styles (css/app.css, @media print) hide everything but #printRoot.
import { $, esc } from './ui.js';
import { yieldText, timeLine } from './recipe.js';
import { convertStep } from './text.js';
import { presentLines, ingredientHTML, factorWords } from './view.js';

const PAGES = {
  card: '@page { size: 6in 4in; margin: .2in .25in .16in; }',
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
  await document.fonts?.ready;
}

export async function printRecipe(r, opts) {
  await preparePrint(r, opts);
  window.print();
}
