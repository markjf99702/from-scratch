// One recipe: scaled and in the chosen units, with ingredients to tick off, timers in the steps, the photo of
// the original card, and sending, printing, editing and removing it.
import { box, prefs } from './store.js';
import { photos } from './photos.js';
import { possessive, yieldOf, yieldText, timeLine } from './recipe.js';
import { sections, readNumber, normalize, kitchen, lineText, present } from './ingredients.js';
import { UNITS } from './units.js';
import { stepHasAmounts, findTimes, formatDuration } from './text.js';
import { recipeLink } from './share.js';
import { app, $, esc, ui, on, go, toast, sheet, icon, copy } from './ui.js';
import { ingredientsHTML, sourcesNote, stepHTML, factorLabel, factorWords, UNIT_MODES, presentLines, metaHTML } from './view.js';
import { timers } from './timers.js';
import { printRecipe } from './print.js';

export const unitsFor = () => ui.units || prefs.get('units') || 'as';
export const scaleOf = id => ui.scale[id] || 1;
export const tickedOf = id => (ui.ticked[id] ||= new Set());

let current = null, photoUrl = null;

export function recipePage(r) {
  current = r.id;
  draw(r);
}

// The same recipe changed underneath (a sync, another tab): draw it again where the reader was.
export function rerenderRecipe(r) {
  if (!r) { go('/', true); return; }
  if (current !== r.id) return;
  const y = window.scrollY;
  draw(r);
  window.scrollTo(0, y);
}

const num = x => (Math.abs(x - Math.round(x)) < 0.01 ? String(Math.round(x)) : kitchen(x, [2, 3, 4]));
const fmtDay = d => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

function draw(r) {
  document.title = `${r.title} · From Scratch`;
  const f = scaleOf(r.id), mode = unitsFor(), ticked = tickedOf(r.id);
  const { html: ings, sources } = ingredientsHTML(r, { factor: f, mode, ticked });
  const y = yieldText(r, f);
  const meta = metaHTML(r, f);
  const scaled = Math.abs(f - 1) > 1e-9;
  const steps = r.steps || [];
  const hasTimes = steps.some(s => findTimes(s).length);
  app.innerHTML = `
    <div class="page recipe-page">
      <nav class="crumbs"><a href="#/">${icon.back}Recipe box</a></nav>
      <article class="paper recipe" id="recipe">
        ${r.check ? `<div class="check">${icon.flag}<div><b>Check this against the card.</b> ${esc(r.check)}</div><button type="button" class="btn small" data-act="checked">It’s right</button></div>` : ''}
        <header class="rhead">
          ${r.from ? `<p class="kitchen">From the kitchen of <span class="hand">${esc(r.from)}</span></p>` : ''}
          <h1 class="rtitle">${esc(r.title)}</h1>
          ${meta ? `<p class="meta">${meta}</p>` : ''}
        </header>
        <div class="controls">
          <button type="button" class="scale-btn" data-act="scale" aria-label="Scale the recipe (now ${factorLabel(f)})">${icon.scale}<span>Scale</span><b>${esc(factorLabel(f))}</b></button>
          <div class="seg units" role="group" aria-label="Amounts">${UNIT_MODES.map(([k, l]) => `<button type="button" data-units="${k}" aria-pressed="${mode === k}">${l}</button>`).join('')}</div>
        </div>
        ${scaled ? `<p class="scaled"><b>${esc(factorWords(f))}</b>${y ? ` · ${esc(y)}` : ''}. <button type="button" class="linkish" data-act="unscale">Back to the card’s amounts</button></p>` : ''}
        <section class="ing-sec">
          <h2 class="sec-h">Ingredients</h2>
          <div class="ruled">${ings || '<p class="fine">No ingredients yet.</p>'}</div>
          <p class="fine">${ticked.size ? 'Crossed off as you got them out. <button type="button" class="linkish" data-act="untick">Clear</button>' : 'Tap an ingredient to cross it off as you get it out.'}</p>
          ${mode !== 'as' ? sourcesNote(sources, mode) : ''}
        </section>
        ${steps.length ? `<a class="btn primary big cook-btn" href="#/r/${esc(r.id)}/cook">${icon.pot}<span>Cook from this</span></a>` : ''}
        <section class="steps-sec">
          <h2 class="sec-h">Steps</h2>
          ${steps.length ? `<ol class="steps">${steps.map((s, i) => `<li>${stepHTML(s, { mode, index: i, recipe: r.id })}</li>`).join('')}</ol>` : '<p class="fine">No steps yet.</p>'}
          ${hasTimes ? '<p class="fine">Tap a time to start a timer.</p>' : ''}
          ${scaled && steps.some(stepHasAmounts) ? '<p class="fine">Amounts written inside the steps are the card’s, not scaled.</p>' : ''}
        </section>
        ${r.notes ? `<section class="notes-sec"><h2 class="sec-h">Notes</h2><div class="note-card hand">${esc(r.notes).replace(/\n/g, '<br>')}</div></section>` : ''}
        <section class="photo-sec" id="photoSec" hidden></section>
        <footer class="rfoot">
          ${r.tags?.length ? `<p class="tags">${r.tags.map(t => `<button type="button" class="tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</p>` : ''}
          ${r.source || r.added ? `<p class="source">${[r.source && esc(r.source), r.added && `Added ${esc(fmtDay(r.added))}`].filter(Boolean).join(' · ')}</p>` : ''}
        </footer>
      </article>
      <div class="actions">
        <button type="button" class="act" data-act="share">${icon.share}<span>Send</span></button>
        <button type="button" class="act" data-act="print">${icon.print}<span>Print</span></button>
        <a class="act" href="#/r/${esc(r.id)}/edit">${icon.edit}<span>Edit</span></a>
        <button type="button" class="act" data-act="remove">${icon.trash}<span>Remove</span></button>
      </div>
    </div>`;
  showPhoto(r);
  on({ click: e => click(e, r) });
}

async function showPhoto(r) {
  const b = await photos.get(r.id);
  const sec = $('photoSec');
  if (!sec || current !== r.id) return;
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = b ? URL.createObjectURL(b) : null;
  sec.hidden = !b;
  if (b) sec.innerHTML = `<h2 class="sec-h">The original card</h2><button type="button" class="photo" data-act="photo" aria-label="Show the photo of the card larger"><img src="${photoUrl}" alt="Photo of the original card for ${esc(r.title)}"></button>`;
}

function click(e, r) {
  const tm = e.target.closest('.tm');
  if (tm) {
    timers.start({ secs: +tm.dataset.secs, secs2: +tm.dataset.secs2 || null, label: tm.dataset.label, recipe: r.id, title: r.title, step: +tm.dataset.step });
    toast(`Timer started: ${tm.dataset.label}, ${formatDuration(+tm.dataset.secs)}`);
    return;
  }
  const tick = e.target.closest('.tick');
  if (tick) {
    const li = tick.closest('.ing'), n = +li.dataset.i, set = tickedOf(r.id);
    if (set.has(n)) set.delete(n); else set.add(n);
    li.classList.toggle('got', set.has(n));
    tick.setAttribute('aria-pressed', set.has(n));
    return;
  }
  const b = e.target.closest('[data-units], [data-act], [data-tag]');
  if (!b) return;
  if (b.dataset.units) { ui.units = b.dataset.units; rerenderRecipe(r); return; }
  if (b.dataset.tag) { ui.tag = b.dataset.tag; ui.q = ''; go('/'); return; }
  const act = b.dataset.act;
  if (act === 'scale') scaleSheet(r);
  if (act === 'unscale') { delete ui.scale[r.id]; rerenderRecipe(r); }
  if (act === 'untick') { tickedOf(r.id).clear(); rerenderRecipe(r); }
  if (act === 'checked') { box.put({ ...r, check: '' }); rerenderRecipe(box.get(r.id)); toast('Marked as checked'); }
  if (act === 'share') shareSheet(r);
  if (act === 'print') printSheet(r);
  if (act === 'remove') removeSheet(r);
  if (act === 'photo' && photoUrl) sheet(`<figure class="big-photo"><img src="${photoUrl}" alt="Photo of the original card for ${esc(r.title)}"></figure><div class="row"><button type="button" class="btn" data-a="close">Close</button></div>`, (body, close) => body.addEventListener('click', ev => { if (ev.target.closest('[data-a="close"]')) close(); }));
}

// ---------- scaling ----------
const readAmount = v => { const n = readNumber(normalize(String(v || '').trim())); return n && !n.article && n.v > 0 ? n.v : null; };

function haveLabel(p) {
  const U = UNITS[p.u];
  const unit = U ? U.many : '';
  return [unit, p.item].filter(Boolean).join(' ') || p.item;
}

function scaleSheet(r) {
  const f = scaleOf(r.id), y = yieldOf(r);
  const counted = sections(r.ingredients).flatMap(s => s.lines).filter(l => l.p.q != null && l.p.item);
  const presets = [0.5, 1, 1.5, 2, 3];
  const custom = presets.some(x => Math.abs(x - f) < 1e-9) ? '' : String(+f.toFixed(3));
  sheet(`
    <h2>Scale this recipe</h2>
    <p class="fine">Every amount changes to match, in the easiest measure: 16 tablespoons become a cup, 3 teaspoons a tablespoon. Times and pan sizes stay as they are.</p>
    <h3>By how much</h3>
    <div class="chips">${presets.map(x => `<button type="button" class="chip" data-f="${x}" aria-pressed="${Math.abs(f - x) < 1e-9}">${esc(factorLabel(x))}</button>`).join('')}
      <label class="chip custom">×<input id="fIn" inputmode="decimal" value="${esc(custom)}" placeholder="1¼" aria-label="Scale by your own amount" autocomplete="off"></label></div>
    ${y ? `<h3>By ${y.kind === 'serves' ? 'how many it serves' : 'how many it makes'}</h3>
      <div class="inline">${y.kind === 'serves' ? 'Serves' : 'Makes'} <input id="yIn" inputmode="decimal" value="${esc(num(y.n * f))}" aria-label="${y.kind === 'serves' ? 'Servings' : 'How many'}" autocomplete="off"> ${y.kind === 'makes' ? esc(y.rest) : ''} <span class="fine">(the card says ${esc(num(y.n))}${y.n2 ? '–' + esc(num(y.n2)) : ''})</span></div>` : ''}
    ${counted.length ? `<h3>By what you have</h3>
      <div class="inline have">I have <input id="hIn" inputmode="decimal" placeholder="3" aria-label="How much you have" autocomplete="off"> <select id="hSel" aria-label="Of which ingredient">${counted.map(l => `<option value="${l.i}">${esc(haveLabel(l.p))}</option>`).join('')}</select></div>
      <p class="fine" id="hNote"></p>` : ''}
    <div class="row"><button type="button" class="btn primary" data-a="apply">Scale it</button><button type="button" class="btn quiet" data-a="reset">The card’s amounts</button></div>`, (body, close) => {
    const set = x => {
      if (!(x > 0) || x > 100) { toast('That amount won’t work. Try a number like 1½ or 2.'); return; }
      if (Math.abs(x - 1) < 1e-9) delete ui.scale[r.id]; else ui.scale[r.id] = x;
      close();
      rerenderRecipe(r);
    };
    const haveNote = () => {
      const hn = $('hNote'), sel = $('hSel');
      if (!hn || !sel) return;
      const line = counted.find(l => l.i === +sel.value);
      const v = present(line.p, { factor: 1, mode: 'as' });
      const have = readAmount($('hIn').value);
      hn.textContent = `The card uses ${lineText(v)}.` + (have ? ` That’s ${factorLabel(have / line.p.q)} the recipe.` : '');
    };
    haveNote();
    let used = null;
    body.addEventListener('input', e => { used = e.target.id; if (e.target.id === 'hIn') haveNote(); });
    body.addEventListener('change', e => { if (e.target.id === 'hSel') { used = 'hIn'; haveNote(); } });
    const apply = () => {
      if (used === 'hIn' || (!used && $('hIn')?.value)) {
        const have = readAmount($('hIn').value), line = counted.find(l => l.i === +$('hSel').value);
        if (have && line) return set(have / line.p.q);
      }
      if (used === 'yIn') { const v = readAmount($('yIn').value); if (v) return set(v / y.n); }
      if (used === 'fIn' || $('fIn').value) { const v = readAmount($('fIn').value); if (v) return set(v); }
      close();
    };
    body.addEventListener('click', e => {
      const chip = e.target.closest('[data-f]');
      if (chip) return set(+chip.dataset.f);
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'apply') apply();
      if (a === 'reset') set(1);
    });
    body.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); apply(); } });
  });
}

// ---------- sending ----------
export function recipeText(r, f = 1, mode = 'as') {
  const lines = presentLines(r, f, mode).map(v => (v.h ? `\n${v.h}` : `- ${lineText(v)}`));
  return [
    r.title + (r.from ? ` (${possessive(r.from)})` : ''),
    [yieldText(r, f), timeLine(r)].filter(Boolean).join(' · '),
    '', 'Ingredients', ...lines, '', 'Steps', ...(r.steps || []).map((s, i) => `${i + 1}. ${s}`),
    ...(r.notes ? ['', 'Notes', r.notes] : []),
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function shareSheet(r) {
  const link = await recipeLink([r]);
  const native = typeof navigator.share === 'function';
  sheet(`
    <h2>Send “${esc(r.title)}”</h2>
    <p>Whoever opens this link sees the recipe and can save a copy to their own From Scratch box${r.from ? `, with ${esc(possessive(r.from))} name on it` : ''}. The photo of the card stays on this device. The recipe travels inside the link itself, so nothing is uploaded anywhere.</p>
    <input class="linkbox" id="shareLink" readonly value="${esc(link)}" aria-label="Link to the recipe">
    <div class="row">${native ? '<button type="button" class="btn primary" data-a="native">Share…</button>' : ''}<button type="button" class="btn${native ? '' : ' primary'}" data-a="copy" id="shareCopy">Copy link</button><button type="button" class="btn quiet" data-a="text">Copy as text</button></div>`, (body, close) => {
    body.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'copy') copy(link, $('shareLink'));
      if (a === 'text') {
        try { await navigator.clipboard.writeText(recipeText(r)); toast('Recipe copied as text'); } catch { toast('This browser didn’t allow copying. Use the link instead.'); }
      }
      if (a === 'native') {
        try { await navigator.share({ title: r.title, text: `${r.title}${r.from ? `, ${possessive(r.from)} recipe` : ''}`, url: link }); close(); } catch { /* cancelled */ }
      }
    });
  });
}

// ---------- printing ----------
async function printSheet(r) {
  const has = !!(await photos.get(r.id));
  const f = scaleOf(r.id);
  sheet(`
    <h2>Print “${esc(r.title)}”</h2>
    <div class="choice">
      <label><input type="radio" name="paper" value="card" checked><span><b>Index card</b> 4 × 6 inches, like the one in the tin. A long recipe carries on to a second card.</span></label>
      <label><input type="radio" name="paper" value="letter"><span><b>Letter paper</b> 8½ × 11 inches</span></label>
      <label><input type="radio" name="paper" value="a4"><span><b>A4 paper</b></span></label>
    </div>
    <label class="check-row"><input type="checkbox" id="pLines" checked> Draw ruled lines on an index card (untick for cards that already have them)</label>
    ${has ? '<label class="check-row"><input type="checkbox" id="pPhoto"> Put the photo of the card at the bottom (on paper, not on an index card)</label>' : ''}
    <p class="fine">It prints the amounts as they’re shown now${Math.abs(f - 1) > 1e-9 ? ` (${esc(factorWords(f).toLowerCase())})` : ''}. For index cards, set the printer to 4 × 6 paper.</p>
    <div class="row"><button type="button" class="btn primary" data-a="print">Print</button></div>`, (body, close) => {
    body.addEventListener('click', async e => {
      if (!e.target.closest('[data-a="print"]')) return;
      const paper = body.querySelector('input[name="paper"]:checked').value;
      const withPhoto = paper !== 'card' && $('pPhoto')?.checked;
      const lines = $('pLines').checked;
      close();
      await printRecipe(r, { paper, factor: f, mode: unitsFor(), photo: withPhoto ? await photos.get(r.id) : null, lines });
    });
  });
}

// ---------- removing ----------
function removeSheet(r) {
  sheet(`<h2>Take “${esc(r.title)}” out of the box?</h2>
    <p>It’s removed from this device and, if you save to Google Drive, from your other devices too. You can undo it for a few seconds.</p>
    <div class="row"><button type="button" class="btn danger" data-a="yes">Remove it</button><button type="button" class="btn quiet" data-a="no">Keep it</button></div>`, (body, close) => {
    body.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      close();
      if (a !== 'yes') return;
      const photo = await photos.get(r.id);
      box.remove(r.id);
      await photos.remove(r.id);
      go('/', true);
      toast(`Removed “${r.title}”`, { label: 'Undo', run: async () => { box.put(r); if (photo) await photos.set(r.id, photo); go('/r/' + r.id); } });
    });
  });
}
