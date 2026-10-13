// Kitchen timers. Start one by tapping a time in a step ("bake 25–30 minutes"); it keeps running while you
// move between steps, leave cook mode, or reload the page, and rings with a beep and a buzz when it's done.
// Timers are kept in localStorage on this device only.
import { $, esc, icon } from './ui.js';
import { clock, formatDuration, formatRange } from './text.js';
import { prefs } from './store.js';

const KEY = 'fromscratch.timers';
const RING_FOR = 2 * 60 * 1000; // keep ringing for up to two minutes

function load() {
  try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a.filter(t => t && t.id && t.secs > 0) : []; } catch { return []; }
}
let list = load();
let audio = null, ringT = null, tickT = null, baseTitle = '';
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* only for this visit */ } };
const left = t => (t.paused ? t.left : (t.end - Date.now()) / 1000);

export const timers = {
  rings: 0, // how many times the alarm has sounded, for the tests
  all: () => list.slice(),
  start({ secs, secs2 = null, label = 'Timer', recipe = '', title = '', step = 0 }) {
    wakeAudio();
    const same = list.find(t => t.recipe === recipe && t.step === step && t.secs === secs && !t.done);
    if (same) { flash(same.id); return same; }
    const t = { id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), label, recipe, title, step, secs, secs2, end: Date.now() + secs * 1000, done: false, paused: false, left: 0, rang: 0 };
    list.push(t);
    save();
    render();
    return t;
  },
  pause(id) { const t = find(id); if (!t || t.done || t.paused) return; t.left = left(t); t.paused = true; save(); render(); },
  resume(id) { const t = find(id); if (!t || !t.paused) return; wakeAudio(); t.end = Date.now() + t.left * 1000; t.paused = false; save(); render(); },
  more(id, secs) { const t = find(id); if (!t) return; wakeAudio(); t.end = Math.max(Date.now(), t.done ? Date.now() : t.end) + secs * 1000; t.done = false; t.rang = 0; t.paused = false; save(); render(); },
  cancel(id) { list = list.filter(t => t.id !== id); save(); render(); },
  reload() { list = load(); render(); },
};
const find = id => list.find(t => t.id === id);

// Browsers only let a page make sound after a tap, so the audio is woken up when a timer starts.
function wakeAudio() {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { audio = null; }
}

// Three short beeps, like a kitchen timer.
function beep() {
  timers.rings++;
  if (!audio || !prefs.get('sound')) return;
  try {
    const t0 = audio.currentTime + 0.02;
    for (let k = 0; k < 3; k++) {
      const o = audio.createOscillator(), g = audio.createGain(), at = t0 + k * 0.26;
      o.type = 'triangle';
      o.frequency.value = 1320;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.4, at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      o.connect(g).connect(audio.destination);
      o.start(at);
      o.stop(at + 0.2);
    }
  } catch { /* no sound here */ }
}

function ring() {
  const now = Date.now();
  const loud = list.filter(t => t.done && now - t.doneAt < RING_FOR);
  if (!loud.length) { stopRinging(); return; }
  beep();
  try { navigator.vibrate?.([300, 120, 300, 120, 300]); } catch { /* no buzz here */ }
  if (!baseTitle) baseTitle = document.title;
  document.title = `Time’s up: ${loud[0].label}`;
}
function stopRinging() {
  clearInterval(ringT);
  ringT = null;
  if (baseTitle) { document.title = baseTitle; baseTitle = ''; }
}

function tick() {
  const now = Date.now();
  let changed = false;
  for (const t of list) {
    if (!t.done && !t.paused && now >= t.end) { t.done = true; t.doneAt = t.end; changed = true; }
  }
  if (changed) {
    save();
    render();
  }
  if (list.some(t => t.done && now - t.doneAt < RING_FOR)) {
    if (!ringT) { ring(); ringT = setInterval(ring, 2200); }
  } else if (ringT) stopRinging();
  // Update the clocks in place, so buttons don't jump under a finger.
  for (const el of document.querySelectorAll('[data-left]')) {
    const t = find(el.dataset.left);
    if (t && !t.done) el.textContent = clock(left(t));
  }
  if (!list.length) { clearInterval(tickT); tickT = null; }
}

function flash(id) {
  const el = document.querySelector(`.timer[data-id="${id}"]`);
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

// The timer bar's height (each running timer adds a row), so the bars that stick to the bottom of the page and
// cook mode's note can sit clear of it.
function measure() {
  const host = $('timers');
  if (host) document.body.style.setProperty('--timers-h', `${host.hidden ? 0 : host.offsetHeight}px`);
}

export function render() {
  const host = $('timers');
  if (!host) return;
  host.hidden = !list.length;
  document.body.classList.toggle('has-timers', list.length > 0);
  host.innerHTML = list.map(t => {
    const range = t.secs2 ? `The recipe says ${formatRange(t.secs, t.secs2)}.` : '';
    const where = t.title ? `<a class="t-where" href="#/r/${esc(t.recipe)}/cook">${esc(t.title)}</a>` : '';
    if (t.done) {
      return `<div class="timer done" data-id="${t.id}" role="alert">
        <div class="t-main"><b class="t-label">${esc(t.label)}: time’s up</b>${where}${range ? `<span class="t-note">${esc(range)}</span>` : ''}</div>
        <div class="t-btns"><button type="button" class="t-btn" data-t="more" data-id="${t.id}" data-secs="${t.secs2 ? t.secs2 - t.secs : 60}">+${formatDuration(t.secs2 ? t.secs2 - t.secs : 60)}</button><button type="button" class="t-btn stop" data-t="cancel" data-id="${t.id}">Stop</button></div>
      </div>`;
    }
    return `<div class="timer${t.paused ? ' paused' : ''}" data-id="${t.id}">
      <div class="t-main"><b class="t-label">${esc(t.label)}</b>${where}</div>
      <span class="t-left" data-left="${t.id}" aria-label="Time left">${clock(left(t))}</span>
      <div class="t-btns"><button type="button" class="t-btn icon" data-t="${t.paused ? 'resume' : 'pause'}" data-id="${t.id}" aria-label="${t.paused ? 'Resume' : 'Pause'} ${esc(t.label)}">${t.paused ? icon.play : icon.pause}</button><button type="button" class="t-btn icon" data-t="cancel" data-id="${t.id}" aria-label="Cancel ${esc(t.label)}">${icon.x}</button></div>
    </div>`;
  }).join('');
  measure();
  if (list.length && !tickT) tickT = setInterval(tick, 250);
}

export function initTimers() {
  const host = $('timers');
  if (typeof ResizeObserver === 'function') new ResizeObserver(measure).observe(host);
  host.addEventListener('click', e => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    const id = b.dataset.id;
    if (b.dataset.t === 'pause') timers.pause(id);
    else if (b.dataset.t === 'resume') timers.resume(id);
    else if (b.dataset.t === 'cancel') timers.cancel(id);
    else if (b.dataset.t === 'more') timers.more(id, +b.dataset.secs || 60);
  });
  // A timer that finished while the page was closed shows as done, quietly.
  const now = Date.now();
  for (const t of list) if (!t.done && !t.paused && now >= t.end) { t.done = true; t.doneAt = t.end; }
  save();
  render();
  tick();
  window.addEventListener('storage', e => { if (e.key === KEY) timers.reload(); });
}
