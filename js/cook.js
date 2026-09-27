// Cook mode: one step at a time in large type, the ingredients that step uses right under it, timers from the
// times in the step, and the screen kept on (Screen Wake Lock) so a floury hand doesn't have to wake the phone.
import { prefs } from './store.js';
import { app, $, esc, ui, on, go, toast, icon } from './ui.js';
import { stepIngredients, findTimes, formatDuration } from './text.js';
import { ingredientsHTML, stepHTML, factorWords } from './view.js';
import { timers } from './timers.js';
import { scaleOf, unitsFor, tickedOf } from './recipe-page.js';

let lock = null, wanted = false, wakeNote = '';

async function wake() {
  wanted = !!prefs.get('wake');
  if (!wanted) { wakeNote = ''; return showNote(); }
  if (!('wakeLock' in navigator)) { wakeNote = 'This browser can’t keep the screen on. If it dims, turn up the auto-lock time in the phone’s settings.'; return showNote(); }
  try {
    if (!lock) {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; if (wanted && document.visibilityState === 'visible') showNote(); });
    }
    wakeNote = 'The screen stays on while you cook.';
  } catch {
    wakeNote = 'The screen couldn’t be kept on just now. If it dims, turn up the auto-lock time in the phone’s settings.';
  }
  showNote();
}
function showNote() { const el = $('wakeNote'); if (el) el.textContent = wakeNote; }

// Screens that are switched off or put away drop the lock; take it again on the way back.
document.addEventListener('visibilitychange', () => { if (wanted && document.visibilityState === 'visible' && !lock) wake(); });

export function leaveCook() {
  wanted = false;
  if (lock) { lock.release().catch(() => {}); lock = null; }
  document.body.classList.remove('cooking', 'cook-big');
}

export function cookPage(r) {
  const f = scaleOf(r.id), mode = unitsFor();
  const steps = r.steps || [], total = steps.length;
  const uses = stepIngredients(r.ingredients, steps);
  let i = Math.min(ui.step[r.id] ?? 0, total + 1);
  document.title = `Cooking: ${r.title} · From Scratch`;
  document.body.classList.add('cooking');
  document.body.classList.toggle('cook-big', !!prefs.get('big'));
  const scaled = Math.abs(f - 1) > 1e-9;

  const draw = () => {
    ui.step[r.id] = i;
    let body;
    if (i === 0) {
      body = `<p class="cook-kicker">Before you start</p>
        <h1 class="cook-step">Get everything out.</h1>
        <p class="fine">Tap each one as it goes on the counter.</p>
        <div class="ruled">${ingredientsHTML(r, { factor: f, mode, ticked: tickedOf(r.id) }).html}</div>`;
    } else if (i <= total) {
      const only = uses[i - 1];
      const times = findTimes(steps[i - 1]);
      body = `<p class="cook-kicker">Step ${i} of ${total}</p>
        <p class="cook-step">${stepHTML(steps[i - 1], { mode, index: i - 1, recipe: r.id })}</p>
        ${times.length ? `<p class="fine">Tap ${times.length === 1 ? 'the time' : 'a time'} to start a timer. It keeps running when you change steps.</p>` : ''}
        ${only.length ? `<div class="uses"><h2>For this step</h2>${ingredientsHTML(r, { factor: f, mode, only, tick: false }).html}</div>` : ''}`;
    } else {
      body = `<p class="cook-kicker">Done</p>
        <h1 class="cook-step">That was the last step.</h1>
        ${r.notes ? `<div class="note-card hand">${esc(r.notes).replace(/\n/g, '<br>')}</div>` : ''}
        <div class="row"><a class="btn" href="#/r/${esc(r.id)}">Back to the recipe</a><button type="button" class="btn quiet" data-act="restart">Start again</button></div>`;
    }
    const pct = total ? Math.round((i / (total + 1)) * 100) : 100;
    app.innerHTML = `
      <div class="cook">
        <header class="cook-top">
          <a class="cook-x" href="#/r/${esc(r.id)}" aria-label="Leave cook mode">${icon.x}</a>
          <div class="cook-where"><b>${esc(r.title)}</b>${scaled ? `<span>${esc(factorWords(f))}</span>` : ''}</div>
          <button type="button" class="cook-aa" data-act="big" aria-pressed="${!!prefs.get('big')}" aria-label="Larger text">Aa</button>
        </header>
        <div class="cook-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total + 1}" aria-valuenow="${i}"><i style="width:${pct}%"></i></div>
        <section class="cook-body" id="cookBody" aria-live="polite">${body}</section>
        <p class="wake-note" id="wakeNote">${esc(wakeNote)}</p>
        <nav class="cook-nav">
          <button type="button" class="btn big" data-go="-1"${i === 0 ? ' disabled' : ''}>${icon.back}<span>Back</span></button>
          <button type="button" class="btn primary big" data-go="1"${i > total ? ' disabled' : ''}><span>${i === 0 ? 'First step' : i === total ? 'Finish' : 'Next step'}</span>${icon.next}</button>
        </nav>
      </div>`;
  };
  const move = d => {
    const n = Math.max(0, Math.min(total + 1, i + d));
    if (n === i) return;
    i = n;
    draw();
    window.scrollTo(0, 0);
  };

  let startX = null, startY = null;
  on({
    click(e) {
      const g = e.target.closest('[data-go]');
      if (g) { move(+g.dataset.go); return; }
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
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'big') { prefs.set('big', !prefs.get('big')); document.body.classList.toggle('cook-big', !!prefs.get('big')); draw(); }
      if (act === 'restart') { i = 0; draw(); }
    },
    keydown(e) {
      if (e.target.closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); move(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
      if (e.key === 'Escape') go('/r/' + r.id);
    },
    // A sideways swipe moves between steps.
    pointerdown(e) { if (e.pointerType !== 'mouse') { startX = e.clientX; startY = e.clientY; } },
    pointerup(e) {
      if (startX == null) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      startX = null;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5 && !e.target.closest('.tm, .tick, button')) move(dx < 0 ? 1 : -1);
    },
    pointercancel() { startX = null; },
  });
  document.onkeydown = e => { if (document.body.classList.contains('cooking') && e.target === document.body) { if (e.key === 'ArrowRight') move(1); if (e.key === 'ArrowLeft') move(-1); } };
  draw();
  wake();
}
