// The page: which screen goes with which address, the recipe box, adding recipes, links and settings.
import { box, prefs, KEY, PREFS } from './store.js';
import { photos, blobToDataURL, dataURLToBlob } from './photos.js';
import { allTags, hasTag, matches, possessive, fold, today, canon } from './recipe.js';
import { readIncoming, LINK_RX, forLink } from './share.js';
import { SAMPLES, SAMPLE_PHOTOS } from './samples.js';
import { app, $, esc, ui, on, go, toast, sheet, closeSheet, sheetOpen, icon, plural, canDownload, download } from './ui.js';
import { recipePage, rerenderRecipe } from './recipe-page.js';
import { cookPage, leaveCook } from './cook.js';
import { editPage, pastePage, editing } from './edit.js';
import { initTimers, timers } from './timers.js';
import { initSync, chip, card, syncState, stop as stopSync } from './sync.js';
import { ingredientsHTML, metaHTML, UNIT_MODES } from './view.js';

let route = '';

function router() {
  const path = location.hash.replace(/^#\/?/, '');
  const [head, a, b] = path.split('/');
  if (route.split('/')[2] === 'cook' && !(head === 'r' && b === 'cook')) leaveCook();
  if (path !== route) window.scrollTo(0, 0);
  route = path;
  document.body.dataset.screen = head || 'box';
  if (sheetOpen()) closeSheet();
  if (head === 'r' && a) {
    const r = box.get(a);
    if (!r) return message('That recipe isn’t here', box.has(a) ? 'It was removed from the box.' : 'It may have been removed, or it was added on another device that hasn’t synced.');
    if (b === 'cook') return cookPage(r);
    if (b === 'edit') return editPage(r);
    return recipePage(r);
  }
  if (head === 'new') return editPage(null);
  if (head === 'paste') return pastePage();
  if (head === 'add' && a) return incoming(path.slice(4));
  if (head === 'add') return addPage();
  if (head === 'settings') return settingsPage();
  home();
}

export function message(title, text) {
  document.title = 'From Scratch';
  app.innerHTML = `<div class="page narrow"><div class="paper empty-msg"><h1>${esc(title)}</h1><p>${esc(text)}</p><a class="btn" href="#/">Back to the recipe box</a></div></div>`;
  on({});
}

// ---------- the recipe box ----------
function home() {
  document.title = 'From Scratch';
  const all = box.all();
  const tags = allTags(all);
  if (ui.tag && !tags.some(t => fold(t.tag) === fold(ui.tag))) ui.tag = '';
  const hasSamples = all.some(r => r.sample);

  if (!all.length) {
    app.innerHTML = `
      <div class="page">
        <section class="empty">
          <div class="empty-tin" aria-hidden="true"><span></span><span></span><span></span></div>
          <h1>Your recipe box is empty.</h1>
          <p>Keep the recipes that live on stained index cards and in people’s heads. Photograph a card and Claude types it up, or type it in yourself. Then scale it, switch between cups and grams, and cook from it with the screen kept on.</p>
          <div class="ways">${waysHTML()}</div>
          <div class="try"><p>Or look around first with five sample recipes from a made-up family.</p><button type="button" class="btn" data-act="samples">Add the sample recipes</button></div>
        </section>
        ${footer()}
      </div>`;
    on({ click: homeClick });
    return;
  }

  app.innerHTML = `
    <div class="page">
      <div class="finder">
        <label class="search">${icon.search}<span class="sr">Search</span><input type="search" id="q" value="${esc(ui.q)}" placeholder="Recipe, person or ingredient" autocomplete="off" enterkeyhint="search"></label>
        ${tags.length ? `<nav class="dividers" aria-label="Tags"><button type="button" class="tab" data-tag="" aria-pressed="${!ui.tag}">All <span>${all.length}</span></button>${tags.map(t => `<button type="button" class="tab" data-tag="${esc(t.tag)}" aria-pressed="${fold(ui.tag) === fold(t.tag)}">${esc(t.tag)} <span>${t.n}</span></button>`).join('')}</nav>` : ''}
        <div class="sortline"><span id="count"></span>
          <label class="sort">Sort <select id="sort"><option value="az"${ui.sort === 'az' ? ' selected' : ''}>A to Z</option><option value="whose"${ui.sort === 'whose' ? ' selected' : ''}>By whose</option><option value="new"${ui.sort === 'new' ? ' selected' : ''}>Newest</option></select></label></div>
      </div>
      <div id="homeList"></div>
      ${hasSamples ? '<p class="samples-note"><button type="button" class="linkish" data-act="unsample">Take out the sample recipes</button></p>' : ''}
      ${footer()}
    </div>`;
  drawList();
  on({
    click: homeClick,
    // Typing in the search redraws only the cards, so the field (and a phone's keyboard) stays put.
    input(e) {
      if (e.target.id !== 'q') return;
      ui.q = e.target.value;
      clearTimeout(home.t);
      home.t = setTimeout(drawList, 120);
    },
    change(e) { if (e.target.id === 'sort') { ui.sort = e.target.value; home(); } },
  });
}

function drawList() {
  const host = $('homeList');
  if (!host) return;
  const all = box.all();
  const shown = all.filter(r => (!ui.tag || hasTag(r, ui.tag)) && matches(r, ui.q));
  const sorted = ui.sort === 'new' ? [...shown].sort((x, y) => (y.added || '').localeCompare(x.added || '') || y.t - x.t)
    : ui.sort === 'whose' ? [...shown].sort((x, y) => fold(x.from || '~').localeCompare(fold(y.from || '~')) || fold(x.title).localeCompare(fold(y.title))) : shown;
  let list = '';
  if (ui.sort === 'whose') {
    let last = null;
    for (const r of sorted) {
      const who = r.from || '';
      if (who !== last) { if (last !== null) list += '</ul>'; list += `<h2 class="group">${who ? esc(possessive(who)) : 'Nobody’s in particular'}</h2><ul class="cards">`; last = who; }
      list += cardHTML(r);
    }
    list += '</ul>';
  } else list = `<ul class="cards">${sorted.map(cardHTML).join('')}</ul>`;
  host.innerHTML = shown.length ? list : `<div class="paper none"><p>Nothing in the box matches${ui.q ? ` “${esc(ui.q)}”` : ''}${ui.tag ? ` under ${esc(ui.tag)}` : ''}.</p><button type="button" class="btn" data-act="clear">Show everything</button></div>`;
  $('count').textContent = countText(shown.length, all.length);
  markPhotos();
}

const countText = (n, total) => (n === total ? plural(total, 'recipe') : `${n} of ${plural(total, 'recipe')}`);

function cardHTML(r) {
  const meta = metaHTML(r);
  return `<li><a class="card" href="#/r/${esc(r.id)}" data-id="${esc(r.id)}">
    <span class="card-head">${r.from ? `<span class="whose">${esc(possessive(r.from))}</span>` : ''}<span class="title">${esc(r.title)}</span></span>
    <span class="card-lines">${meta ? `<span class="meta">${meta}</span>` : ''}
    <span class="foot-row">${(r.tags || []).slice(0, 3).map(t => `<span class="tag">${esc(t)}</span>`).join('')}${r.sample ? '<span class="stamp">Sample</span>' : ''}${r.check ? `<span class="flag">${icon.flag}Check</span>` : ''}<span class="clip" hidden title="Has a photo of the card">${icon.clip}</span></span></span>
  </a></li>`;
}

async function markPhotos() {
  const ids = new Set(await photos.keys());
  document.querySelectorAll('.card[data-id]').forEach(a => { if (ids.has(a.dataset.id)) a.querySelector('.clip').hidden = false; });
}

async function homeClick(e) {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.tag !== undefined) { ui.tag = t.dataset.tag; home(); return; }
  if (t.dataset.act === 'clear') { ui.q = ''; ui.tag = ''; home(); }
  if (t.dataset.act === 'samples') { await addSamples(); home(); toast('Added five sample recipes'); }
  if (t.dataset.act === 'unsample') removeSamples();
}

export async function addSamples() {
  const added = box.add(SAMPLES.map(s => ({ ...s })));
  for (const [id, path] of Object.entries(SAMPLE_PHOTOS)) {
    try {
      if (await photos.get(id)) continue;
      const res = await fetch(path);
      if (res.ok) await photos.set(id, await res.blob());
    } catch { /* the sample works without its photo */ }
  }
  return added.length;
}

function removeSamples() {
  const gone = box.all().filter(r => r.sample);
  gone.forEach(r => { box.remove(r.id); photos.remove(r.id); });
  if (route === '' || route === '/') home(); else router();
  toast(`Took out ${plural(gone.length, 'sample recipe')}`, { label: 'Undo', run: () => { box.add(gone, { replace: true }); addSamples().then(() => router()); } });
}

function waysHTML() {
  return `
    <a class="way" href="#/add"><span class="way-icon">${icon.camera}</span><b>Photograph a card</b><span>Claude reads the handwriting and gives you a link that adds the recipe here.</span></a>
    <a class="way" href="#/new"><span class="way-icon">${icon.edit}</span><b>Type it in</b><span>Copy it from the card yourself, and keep a photo of the card with it.</span></a>
    <a class="way" href="#/paste"><span class="way-icon">${icon.plus}</span><b>Paste it</b><span>From an email, a website or your notes. The ingredients and steps are sorted out for you.</span></a>`;
}

function footer() {
  return `<footer class="foot"><a href="https://junkdrawer.works/">Part of junkdrawer.works</a><span aria-hidden="true">·</span><a href="https://junkdrawer.works/privacy.html">Privacy</a><span aria-hidden="true">·</span><a href="https://github.com/markjf99702/from-scratch">Source</a></footer>`;
}

// ---------- adding ----------
const SKILL_URL = 'https://github.com/markjf99702/from-scratch/tree/main/skill/from-scratch-cards';

function addPage() {
  document.title = 'Add a recipe · From Scratch';
  app.innerHTML = `
    <div class="page narrow">
      <nav class="crumbs"><a href="#/">${icon.back}Recipe box</a></nav>
      <h1 class="page-title">Add a recipe</h1>
      <section class="paper claude">
        <h2>${icon.camera} Photograph a card, and Claude types it up</h2>
        <ol class="howto">
          <li>Give Claude the From Scratch skill, once: <a href="${SKILL_URL}">skill/from-scratch-cards</a>. It tells Claude how to read old cards: “c.” and “T.”, oleo, a scant cup, a moderate oven.</li>
          <li>Send Claude photos of the cards, front and back, and say whose they are.</li>
          <li>Open the link Claude sends back. The recipes show up here to check against the card before they go in your box.</li>
        </ol>
        <label class="field">Or paste the link or file text Claude gave you
          <textarea id="incomingText" rows="3" placeholder="https://junkdrawer.works/from-scratch/#/add/z…" spellcheck="false"></textarea></label>
        <div class="row"><button type="button" class="btn primary" data-act="open">Open it</button><label class="btn quiet file">Open a file<input type="file" id="fileIn" accept=".json,application/json"></label></div>
      </section>
      <div class="ways pair">
        <a class="way" href="#/new"><span class="way-icon">${icon.edit}</span><b>Type it in</b><span>Copy it from the card yourself, and keep a photo of the card with it.</span></a>
        <a class="way" href="#/paste"><span class="way-icon">${icon.plus}</span><b>Paste it</b><span>From an email, a website or your notes. The ingredients and steps are sorted out for you.</span></a>
      </div>
    </div>`;
  on({
    async click(e) {
      if (e.target.closest('[data-act="open"]')) openText($('incomingText').value);
    },
    async change(e) {
      if (e.target.id === 'fileIn' && e.target.files[0]) openText(await e.target.files[0].text());
    },
  });
}

async function openText(text) {
  const t = String(text || '').trim();
  if (!t) { toast('Paste the link or the text of the file first'); return; }
  const m = LINK_RX.exec(t);
  if (m && t[0] !== '{') { go('/add/' + m[1]); return; }
  try {
    const got = await readIncoming(t);
    if (got.kind === 'backup') return restoreBackup(got);
    showIncoming(got);
  } catch {
    toast('That doesn’t look like recipes from Claude or a From Scratch file');
  }
}

// A link from Claude or from family: #/add/z…
async function incoming(data) {
  app.innerHTML = '<div class="page narrow"><p class="loading">Opening the recipes…</p></div>';
  try {
    const got = await readIncoming('#/add/' + data);
    if (got.kind === 'backup') return restoreBackup(got);
    showIncoming(got);
  } catch (e) {
    message('That link didn’t come through whole', /browser/.test(e?.message || '') ? e.message : 'Ask for it again, or copy all of it into the address bar. Claude also gives you a file you can open from Add a recipe.');
  }
}

function showIncoming(got) {
  // The same words as the copy already here, ignoring what only this device knows (when it was added, a sample mark).
  const words = r => { const { added, ...rest } = forLink(r); return canon(rest); };
  const rows = got.recipes.map(r => {
    const mine = box.get(r.id);
    const same = !!mine && words(mine) === words(r);
    return { r, mine, same, on: !mine };
  });
  const one = rows.length === 1;
  const checks = rows.filter(x => x.r.check).length;
  document.title = (one ? rows[0].r.title : 'Recipes to add') + ' · From Scratch';
  const draw = () => {
    const fresh = rows.filter(x => x.on).length;
    app.innerHTML = `
      <div class="page narrow">
        <nav class="crumbs"><a href="#/">${icon.back}Recipe box</a></nav>
        <h1 class="page-title">${one ? 'A recipe for your box' : `${rows.length} recipes for your box`}</h1>
        <p class="lede">${got.name ? `<b>${esc(got.name)}</b> · ` : ''}${checks ? `${plural(checks, 'recipe')} to check against the card. ` : ''}Nothing is added until you say so.</p>
        ${rows.map((x, i) => `
          <article class="paper review${x.on ? ' on' : ''}">
            <label class="pick"><input type="checkbox" data-pick="${i}"${x.on ? ' checked' : ''}${x.same ? ' disabled' : ''}><span>${x.same ? 'Already in your box' : x.mine ? 'Replace the copy in your box' : 'Add this one'}</span></label>
            ${x.r.from ? `<p class="kitchen">From the kitchen of <span class="hand">${esc(x.r.from)}</span></p>` : ''}
            <h2 class="rtitle">${esc(x.r.title)}</h2>
            ${metaHTML(x.r) ? `<p class="meta">${metaHTML(x.r)}</p>` : ''}
            ${x.r.check ? `<p class="check">${icon.flag}<span><b>Check against the card:</b> ${esc(x.r.check)}</span></p>` : ''}
            <div class="ruled">${ingredientsHTML(x.r, { tick: false }).html}</div>
            ${x.r.steps?.length ? `<ol class="steps small">${x.r.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
            ${x.r.notes ? `<div class="note-card hand">${esc(x.r.notes).replace(/\n/g, '<br>')}</div>` : ''}
          </article>`).join('')}
        <div class="bar-bottom"><button type="button" class="btn primary big" data-act="add"${fresh ? '' : ' disabled'}>${fresh ? (fresh === 1 ? 'Add it to my recipe box' : `Add ${fresh} recipes to my box`) : 'Nothing new to add'}</button>${fresh ? '' : '<a class="btn quiet" href="#/">Go to the recipe box</a>'}</div>
      </div>`;
  };
  draw();
  on({
    change(e) {
      const i = e.target.dataset.pick;
      if (i === undefined) return;
      rows[+i].on = e.target.checked;
      draw();
    },
    click(e) {
      if (!e.target.closest('[data-act="add"]')) return;
      const picked = rows.filter(x => x.on).map(x => ({ ...x.r, added: today() }));
      const added = box.add(picked, { replace: true });
      toast(added.length === 1 ? `Added “${added[0].title}”` : `Added ${plural(added.length, 'recipe')}`);
      if (added.length === 1) go('/r/' + added[0].id, true); else go('/', true);
    },
  });
}

// ---------- settings ----------
function settingsPage() {
  document.title = 'Settings · From Scratch';
  const n = box.all().length, samples = box.all().some(r => r.sample);
  const unit = prefs.get('units');
  app.innerHTML = `
    <div class="page narrow">
      <nav class="crumbs"><a href="#/">${icon.back}Recipe box</a></nav>
      <h1 class="page-title">Settings</h1>
      <section class="paper set">
        <h2>Amounts</h2>
        <p>How recipes open; you can switch on any recipe too. <b>Cups</b> shows cups, spoons, ounces and pounds. <b>Grams</b> weighs flour, sugar, butter and other baking staples, turns other cups into millilitres, and leaves teaspoons as spoons.</p>
        <div class="seg" role="group" aria-label="Units">${UNIT_MODES.map(([k, l]) => `<button type="button" data-units="${k}" aria-pressed="${unit === k}">${l}</button>`).join('')}</div>
      </section>
      <section class="paper set">
        <h2>Cooking</h2>
        <label class="check-row"><input type="checkbox" id="pWake"${prefs.get('wake') ? ' checked' : ''}> Keep the screen on in cook mode</label>
        <label class="check-row"><input type="checkbox" id="pBig"${prefs.get('big') ? ' checked' : ''}> Extra-large text in cook mode</label>
        <label class="check-row"><input type="checkbox" id="pSound"${prefs.get('sound') ? ' checked' : ''}> Timers beep as well as buzz</label>
      </section>
      <section class="paper set" id="driveCard" hidden></section>
      <section class="paper set" id="backupCard">
        <h2>Backups</h2>
        <p>${plural(n, 'recipe')} in this browser. A backup file has all of them, and the photos of cards if you like. Loading one merges it with what’s here, keeping the newer copy of each recipe.</p>
        ${canDownload() ? '<label class="check-row"><input type="checkbox" id="withPhotos" checked> Include photos of the cards</label>' : ''}
        <div class="row">${canDownload() ? '<button type="button" class="btn" data-act="backup">Save a backup</button>' : ''}<label class="btn quiet file">Load a backup<input type="file" id="restoreIn" accept=".json,application/json"></label></div>
      </section>
      <section class="paper set">
        <h2>Sample recipes</h2>
        <p>Five recipes from a made-up family, to look around with.</p>
        <div class="row">${samples ? '<button type="button" class="btn quiet" data-act="unsample">Take the samples out</button>' : '<button type="button" class="btn quiet" data-act="samples">Add the sample recipes</button>'}</div>
      </section>
      <section class="paper set">
        <h2>This device</h2>
        <p>Recipes are kept in this browser. Nothing is sent anywhere unless you share a link or turn on Google Drive.</p>
        <div class="row"><button type="button" class="btn danger quiet" data-act="erase">Erase everything on this device</button></div>
      </section>
      ${footer()}
    </div>`;
  card($('driveCard'));
  on({
    async click(e) {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.units) { prefs.set('units', b.dataset.units); ui.units = null; settingsPage(); return; }
      if (b.dataset.act === 'backup') await saveBackup($('withPhotos')?.checked);
      if (b.dataset.act === 'samples') { await addSamples(); settingsPage(); toast('Added five sample recipes'); }
      if (b.dataset.act === 'unsample') { removeSamples(); settingsPage(); }
      if (b.dataset.act === 'erase') eraseAll();
    },
    async change(e) {
      if (e.target.id === 'pWake') prefs.set('wake', e.target.checked);
      if (e.target.id === 'pBig') prefs.set('big', e.target.checked);
      if (e.target.id === 'pSound') prefs.set('sound', e.target.checked);
      if (e.target.id === 'restoreIn' && e.target.files[0]) {
        try {
          const got = await readIncoming(await e.target.files[0].text());
          if (got.kind === 'backup') restoreBackup(got); else showIncoming(got);
        } catch { toast('That file isn’t a From Scratch backup'); }
      }
    },
  });
}

async function saveBackup(withPhotos) {
  const out = { fromScratch: 1, saved: new Date().toISOString(), box: box.state };
  if (withPhotos) {
    out.photos = {};
    for (const id of await photos.keys()) {
      if (!box.get(id)) continue;
      const b = await photos.get(id);
      if (b) out.photos[id] = await blobToDataURL(b);
    }
  }
  download(`from-scratch-${today()}.json`, JSON.stringify(out));
}

async function restoreBackup(got) {
  const changed = box.merge(got.box, 'local');
  let pics = 0;
  for (const [id, url] of Object.entries(got.photos || {})) {
    if (await photos.get(id)) continue;
    const blob = dataURLToBlob(url);
    if (blob) { await photos.set(id, blob); pics++; }
  }
  go('/', true);
  router();
  toast(changed || pics ? `Loaded the backup: ${plural(changed, 'recipe')} new or updated${pics ? `, ${plural(pics, 'photo')}` : ''}` : 'Nothing new in that backup');
}

function eraseAll() {
  const drive = syncState().on;
  sheet(`<h2>Erase everything on this device?</h2>
    <p>This removes every recipe and photo from this browser${drive ? ', and this device stops saving to Google Drive' : ''}. It doesn’t touch Google Drive or anyone you’ve sent recipes to. Save a backup first if you want to keep them.</p>
    <div class="row"><button type="button" class="btn danger" data-a="yes">Erase this device</button><button type="button" class="btn quiet" data-a="no">Keep everything</button></div>`, (body, close) => {
    body.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      close();
      if (a !== 'yes') return;
      // First, so the recipes in Drive don't sync straight back into the empty box.
      stopSync();
      box.erase();
      await photos.clear();
      try { localStorage.removeItem('fromscratch.drive'); localStorage.removeItem('fromscratch.timers'); localStorage.removeItem('fromscratch.draft'); } catch { /* already gone */ }
      go('/', true);
      router();
      toast('Erased this device');
    });
  });
}

// ---------- keeping the page in step with storage ----------
box.onChange(why => {
  if (why === 'quiet') return;
  // Recipes that were the same on two devices collapse into one: bring along this device's photo.
  for (const r of Object.values(box.state.recipes)) if (r.del && r.to && !moved.has(r.id)) { moved.add(r.id); photos.move(r.id, r.to); }
  if (why === 'sync' || why === 'storage') refresh();
});
const moved = new Set();

// Synced or changed in another tab: draw the screen again from the new data, unless something is being typed.
function refresh() {
  if (editing() || sheetOpen()) return;
  const [head, a, b] = route.split('/');
  if (head === 'r' && a && !b) return rerenderRecipe(box.get(a));
  if (head === 'r' && b === 'cook') return;
  if (!head && document.activeElement?.id === 'q') return drawList();
  if (!head || head === 'settings') router();
}

window.addEventListener('storage', e => {
  if (e.key === KEY) box.reload('storage');
  if (e.key === PREFS) prefs.reload();
});
window.addEventListener('hashchange', router);

const lid = $('cloud');
chip(lid);
initSync();
initTimers();
router();

if ('serviceWorker' in navigator && !('single' in document.documentElement.dataset) && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// For the screenshot tool and tests: the stores, so they can set things up without tapping through.
window.fromScratch = { box, prefs, photos, timers, addSamples, sync: syncState };
