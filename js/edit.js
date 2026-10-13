// Typing a recipe in (or fixing one), and pasting a whole recipe to be sorted into ingredients and steps.
// What's typed is kept as a draft on this device until it's saved, so a phone call doesn't lose it.
import { box } from './store.js';
import { photos, shrink } from './photos.js';
import { allTags, today } from './recipe.js';
import { parseLine, present, amountWords } from './ingredients.js';
import { splitRecipe, findTimes } from './text.js';
import { linkData } from './share.js';
import { app, $, esc, on, go, toast, icon, amountHTML, footer } from './ui.js';

const DRAFT = 'fromscratch.draft';
const FIELDS = ['title', 'from', 'serves', 'makes', 'prep', 'cook', 'ingredients', 'steps', 'notes', 'tags', 'source', 'check'];
const IDEAS = ['Breakfast', 'Bread', 'Baking', 'Cookies', 'Cake', 'Pie', 'Dessert', 'Dinner', 'Soup', 'Sides', 'Salad', 'Holidays', 'Canning'];

let dirty = false, pendingPhoto = null, dropPhoto = false, previewUrl = null;
export const editing = () => dirty && !!$('editForm');

const readDraft = key => { try { const d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); return d && d.key === key ? d : null; } catch { return null; } };
const writeDraft = (key, data) => { try { localStorage.setItem(DRAFT, JSON.stringify({ key, data, at: Date.now() })); } catch { /* only for this visit */ } };
const clearDraft = () => { try { localStorage.removeItem(DRAFT); } catch { /* none */ } };

function toForm(r) {
  return {
    title: r.title || '', from: r.from || '', serves: r.serves || '', makes: r.makes || '', prep: r.prep || '', cook: r.cook || '',
    ingredients: (r.ingredients || []).join('\n'), steps: (r.steps || []).join('\n'), notes: r.notes || '',
    tags: (r.tags || []).join(', '), source: r.source || '', check: r.check || '',
  };
}

export function editPage(r) {
  const key = r ? r.id : 'new';
  const draft = readDraft(key);
  const useDraft = draft && (!r || draft.at > r.t);
  const v = useDraft ? { ...toForm(r || {}), ...draft.data } : toForm(r || {});
  dirty = !!useDraft;
  pendingPhoto = null;
  dropPhoto = false;
  const back = r ? `#/r/${esc(r.id)}` : '#/add';
  document.title = (r ? `Edit ${r.title}` : 'New recipe') + ' · From Scratch';
  const tags = allTags(box.all()).map(t => t.tag);
  const ideas = [...tags, ...IDEAS.filter(t => !tags.some(x => x.toLowerCase() === t.toLowerCase()))].slice(0, 16);
  const field = (name, label, attrs = '', hint = '') => `<label class="field"><span class="lbl">${label}</span><input name="${name}" value="${esc(v[name])}" autocomplete="off" ${attrs}>${hint ? `<small>${hint}</small>` : ''}</label>`;
  app.innerHTML = `
    <div class="page narrow">
      <nav class="crumbs"><a href="${back}">${icon.back}${r ? 'Back to the recipe' : 'Add a recipe'}</a></nav>
      <h1 class="page-title">${r ? 'Edit the recipe' : 'New recipe'}</h1>
      ${useDraft ? `<p class="fine draft-note">Picked up where you left off. <button type="button" class="linkish" data-act="discard">${r ? 'Undo my changes' : 'Start over'}</button></p>` : ''}
      <form class="paper edit" id="editForm" novalidate>
        <div class="photo-edit" id="photoEdit"></div>
        ${field('title', 'Name of the recipe', 'required placeholder="Cinnamon Crumb Coffee Cake"')}
        ${field('from', 'Whose recipe is it?', 'placeholder="Grandma Rosa"', 'Shown as “From the kitchen of …” on the card.')}
        <div class="two">${field('serves', 'Serves', 'inputmode="numeric" placeholder="8"')}${field('makes', 'Or makes', 'placeholder="2 dozen cookies"')}</div>
        <div class="two">${field('prep', 'Prep time', 'placeholder="20 min"')}${field('cook', 'Cook time', 'placeholder="45 min"')}</div>
        <label class="field"><span class="lbl">Ingredients</span><small>One per line, the way the card has it: “1 1/2 c. flour, sifted” is fine. A line ending in a colon, like “For the glaze:”, starts a section.</small><textarea name="ingredients" rows="10" placeholder="2 cups all-purpose flour&#10;1 cup (2 sticks) butter, softened&#10;3/4 cup sugar&#10;For the glaze:&#10;1 cup confectioners' sugar">${esc(v.ingredients)}</textarea></label>
        <div class="parse" id="parse" aria-live="polite"></div>
        <label class="field"><span class="lbl">Steps</span><small>One step per line. Times like “bake 25–30 minutes” become timers you can tap.</small><textarea name="steps" rows="8" placeholder="Heat the oven to 350°F.&#10;Cream the butter and sugar…">${esc(v.steps)}</textarea></label>
        <p class="fine" id="timesNote"></p>
        <label class="field"><span class="lbl">Notes and stories</span><small>What she always did, where the card came from, who asks for it.</small><textarea name="notes" rows="4" class="hand-input" placeholder="She always doubled the cinnamon.">${esc(v.notes)}</textarea></label>
        ${field('tags', 'Tags', 'placeholder="Baking, Holidays"', 'Separate them with commas.')}
        <div class="tag-ideas">${ideas.map(t => `<button type="button" class="chip" data-idea="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        ${field('source', 'Where it came from', 'placeholder="Index card in her handwriting"')}
        ${v.check ? `<label class="field"><span class="lbl">To check against the card</span><textarea name="check" rows="2">${esc(v.check)}</textarea><small>Empty this once it’s right.</small></label>` : ''}
        <div class="row form-actions"><button type="submit" class="btn primary big">Save recipe</button><a class="btn quiet" href="${back}" data-act="cancel">Cancel</a></div>
      </form>
      ${footer()}
    </div>`;
  drawPhoto(r);
  preview();
  const form = $('editForm');
  const collect = () => Object.fromEntries(FIELDS.filter(k => form.elements[k]).map(k => [k, form.elements[k].value]));
  on({
    input(e) {
      if (!e.target.closest('#editForm')) return;
      dirty = true;
      writeDraft(key, collect());
      if (e.target.name === 'ingredients' || e.target.name === 'steps') preview();
    },
    async change(e) {
      if (e.target.id !== 'photoIn' || !e.target.files[0]) return;
      try {
        pendingPhoto = await shrink(e.target.files[0]);
        dropPhoto = false;
        dirty = true;
        drawPhoto(r);
      } catch (err) { toast(err.message || 'That photo couldn’t be opened'); }
    },
    click(e) {
      const idea = e.target.closest('[data-idea]');
      if (idea) {
        const input = form.elements.tags;
        const list = input.value.split(',').map(s => s.trim()).filter(Boolean);
        if (!list.some(t => t.toLowerCase() === idea.dataset.idea.toLowerCase())) list.push(idea.dataset.idea);
        input.value = list.join(', ');
        dirty = true;
        writeDraft(key, collect());
        return;
      }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'discard') { clearDraft(); dirty = false; editPage(r); }
      if (act === 'cancel') { clearDraft(); dirty = false; }
      if (act === 'drop-photo') { pendingPhoto = null; dropPhoto = true; dirty = true; drawPhoto(r, true); }
    },
    async submit(e) {
      e.preventDefault();
      const data = collect();
      if (!data.title.trim()) { form.elements.title.focus(); toast('Give the recipe a name first'); return; }
      const saved = box.put({
        ...(r || {}),
        ...data,
        id: r ? r.id : undefined,
        tags: data.tags,
        added: r?.added || today(),
        sample: 0,
      });
      // Storage full: the form keeps what was typed, but the draft can't be kept either, so say so.
      if (!saved) { toast(box.full ? 'This browser’s storage is full, so the recipe wasn’t saved. Copy what you typed somewhere safe before you leave this page.' : 'That couldn’t be saved', null, 10000); return; }
      try {
        if (pendingPhoto) await photos.set(saved.id, pendingPhoto);
        else if (dropPhoto) await photos.remove(saved.id);
      } catch { toast('The recipe is saved, but this browser wouldn’t keep the photo'); }
      clearDraft();
      dirty = false;
      go('/r/' + saved.id, true);
      toast(r ? 'Saved' : `Added “${saved.title}” to the box`);
    },
  });
}

async function drawPhoto(r, dropped = false) {
  const host = $('photoEdit');
  if (!host) return;
  const blob = pendingPhoto || (!dropped && !dropPhoto && r ? await photos.get(r.id) : null);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = blob ? URL.createObjectURL(blob) : null;
  host.innerHTML = blob
    ? `<figure class="edit-photo"><img src="${previewUrl}" alt="The photo of the card"></figure>
       <div class="row"><label class="btn quiet file">${icon.camera}Replace the photo<input type="file" id="photoIn" accept="image/*"></label><button type="button" class="btn quiet" data-act="drop-photo">Remove it</button></div>
       <p class="fine">The photo stays on this device. It isn’t sent with the recipe or saved to Google Drive.</p>`
    : `<label class="btn quiet file add-photo">${icon.camera}Add a photo of the card<input type="file" id="photoIn" accept="image/*"></label>
       <p class="fine">Keep the original, stains and all. It stays on this device.</p>`;
}

// How each ingredient line is read, so a surprise shows up before saving.
function preview() {
  const form = $('editForm'), host = $('parse');
  if (!form || !host) return;
  const lines = form.elements.ingredients.value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!lines.length) { host.innerHTML = ''; } else {
    host.innerHTML = `<p class="parse-h">How these read</p><ul>${lines.slice(0, 80).map(l => {
      const p = parseLine(l);
      if (!p) return '';
      if (p.h) return `<li class="p-sect">${esc(p.h)}</li>`;
      const v = present(p, {});
      const amount = v.qty ? (v.pre ? esc(v.pre) + ' ' : '') + amountHTML(amountWords(v)) : '<i>no amount</i>';
      return `<li><span class="p-amt">${amount}</span><span class="p-item">${v.qty ? '' : esc(v.pre ? v.pre + ' ' : '')}${esc(v.item)}</span>${v.note ? `<span class="p-note">${esc(v.note)}</span>` : ''}</li>`;
    }).join('')}</ul>`;
  }
  const times = form.elements.steps.value.split('\n').flatMap(s => findTimes(s)).map(t => t.text);
  const tn = $('timesNote');
  if (tn) tn.textContent = times.length ? `Timers: ${times.join(', ')}.` : '';
}

// ---------- pasting a whole recipe ----------
export function pastePage() {
  document.title = 'Paste a recipe · From Scratch';
  dirty = false;
  app.innerHTML = `
    <div class="page narrow">
      <nav class="crumbs"><a href="#/add">${icon.back}Add a recipe</a></nav>
      <h1 class="page-title">Paste a recipe</h1>
      <div class="paper">
        <p>Paste the whole thing, from an email, a website or your notes. From Scratch sorts it into the name, ingredients and steps, and shows it to you to check before it’s saved.</p>
        <label class="field"><span class="lbl">The recipe</span><textarea id="pasteText" rows="14" placeholder="Aunt June’s Molasses Crinkles&#10;2 c. flour&#10;2 t. soda&#10;…&#10;Cream shortening and sugar. Add egg and molasses."></textarea></label>
        <div class="row"><button type="button" class="btn primary" data-act="split">Sort it out</button></div>
      </div>
      ${footer()}
    </div>`;
  on({
    click(e) {
      if (!e.target.closest('[data-act="split"]')) return;
      const text = $('pasteText').value;
      if (!text.trim()) { toast('Paste a recipe first'); return; }
      const link = linkData(text);
      if (link) { go('/add/' + link); return; }
      const got = splitRecipe(text);
      if (!got.ingredients.length && !got.steps.length) { toast('No ingredients or steps turned up in that. Try typing it in instead.'); return; }
      writeDraft('new', {
        title: got.title, from: got.from, serves: got.serves, makes: got.makes, prep: got.prep, cook: got.cook || got.total,
        ingredients: got.ingredients.join('\n'), steps: got.steps.join('\n'), notes: got.notes, tags: '', source: '', check: '',
      });
      go('/new');
    },
  });
}
