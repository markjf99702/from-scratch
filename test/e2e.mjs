// Uses From Scratch in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
// One person fills a recipe box, scales and converts recipes, cooks with timers, types and pastes recipes, opens a
// link from Claude, sends a recipe to family, prints, removes and backs up. Then Google Drive saving between devices,
// against a stand-in for Google. It ends with the checks every junkdrawer.works project wants.
import { createRequire } from 'node:module';
import { execSync, execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { fakeGoogle } from './fake-google.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.FS_OUT || join(tmpdir(), 'from-scratch-e2e');
await mkdir(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
// down: the server refuses every connection, as with no signal. (setOffline doesn't stop a service worker's own
// fetches, so it can't show whether the offline copy works.)
let down = false;
const server = createServer(async (req, res) => {
  if (down) { req.socket.destroy(); return; }
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const origin = base.slice(0, -1);

const browser = await pw.chromium.launch();
const problems = [];

// Stand-ins for things a headless browser can't do: keep the screen on, buzz, and open a print window.
const STUBS = () => {
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: {
      request: async () => {
        window.__wake = (window.__wake || 0) + 1;
        const listeners = [];
        return { released: false, addEventListener: (e, f) => listeners.push(f), release: async () => { window.__released = (window.__released || 0) + 1; listeners.forEach(f => f()); } };
      },
    },
  });
  navigator.vibrate = () => { window.__buzz = (window.__buzz || 0) + 1; return true; };
  window.print = () => { window.__printed = (window.__printed || 0) + 1; };
};

async function device({ watch = true, sw = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true, serviceWorkers: sw ? 'allow' : 'block' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await ctx.addInitScript(STUBS);
  const page = await ctx.newPage();
  if (watch) {
    page.on('pageerror', e => problems.push(e.message));
    page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
    page.on('requestfailed', r => problems.push('failed: ' + r.url()));
    page.on('request', r => { if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) problems.push('left the site: ' + r.url()); });
  }
  return { ctx, page };
}

const fits = async (page, where) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${where} scrolls sideways on a phone`);
const text = page => page.locator('main').innerText();
// Nothing sits on top of it: the middle of the element is the element itself.
const uncovered = (page, sel) => page.locator(sel).evaluate(el => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!hit && el.contains(hit); });
const overlaps = (page, a, b) => page.evaluate(([a, b]) => { const r = document.querySelector(a).getBoundingClientRect(), s = document.querySelector(b).getBoundingClientRect(); return r.left < s.right && s.left < r.right && r.top < s.bottom && s.top < r.bottom; }, [a, b]);
// Amounts that wrap anywhere but at "+": each word's line, grouped between the "+"s, should be one line per group.
const badBreaks = page => page.evaluate(() => [...document.querySelectorAll('.ing .amt')].flatMap(el => {
  const words = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) for (const m of n.data.matchAll(/\S+/g)) {
    const r = document.createRange();
    r.setStart(n, m.index);
    r.setEnd(n, m.index + m[0].length);
    words.push([m[0], Math.round(r.getBoundingClientRect().top)]);
  }
  const groups = [[]];
  for (const w of words) if (w[0] === '+') groups.push([]); else groups.at(-1).push(w);
  return groups.some(g => g.some(w => Math.abs(w[1] - g[0][1]) > 2)) ? [el.textContent.replace(/\s+/g, ' ')] : [];
}));
const startTimer = page => page.evaluate(() => window.fromScratch.timers.start({ secs: 600, label: 'Rise', title: 'Rolls', recipe: 'x', step: 9 }));
const stopTimers = page => page.evaluate(() => window.fromScratch.timers.all().forEach(t => window.fromScratch.timers.cancel(t.id)));
const ingredient = (page, i) => page.locator(`.ing[data-i="${i}"]`).innerText().then(t => t.replace(/\s+/g, ' ').trim());

// ---------- Mark's recipe box ----------
const mark = await device();
let page = mark.page;
await page.clock.install();
await page.goto(base);
await page.evaluate(() => document.fonts.ready);
assert.match(await text(page), /Your recipe box is empty/);
await fits(page, 'the empty box');

await page.click('text=Add the sample recipes');
await page.locator('.card').first().waitFor();
assert.equal(await page.locator('.card').count(), 5, 'five sample recipes');
await page.locator('.card[data-id="sample-rosa-coffee-cake"] .clip:not([hidden])').waitFor({ timeout: 5000 });
await fits(page, 'the box');

// The line back to junkdrawer.works is at the foot of every screen.
for (const hash of ['#/', '#/r/sample-walt-chili', '#/add', '#/new', '#/paste', '#/settings', '#/r/not-here']) {
  await page.goto(base + hash);
  assert.equal(await page.locator('main footer.foot').count(), 1, `the footer on ${hash}`);
}
await page.goto(base + '#/');

// Search and tags.
const searchBox = await page.$('#q');
await page.click('#q');
await page.keyboard.type('walt', { delay: 60 });
await page.waitForFunction(() => document.querySelectorAll('.card').length === 1, null, { polling: 100 });
assert.match(await page.locator('.card').innerText(), /Uncle Walt’s/);
assert.ok(await searchBox.evaluate(el => el.isConnected && document.activeElement === el), 'the search field stays put while typing');
await page.fill('#q', 'buttermilk');
await page.locator('.card:has-text("Pancakes")').waitFor();
assert.equal(await page.locator('.card').count(), 1, 'search reads the ingredients');
await page.fill('#q', '');
await page.waitForFunction(() => document.querySelectorAll('.card').length === 5, null, { polling: 100 });
await page.click('.tab[data-tag="Baking"]');
assert.equal(await page.locator('.card').count(), 3);
await page.click('.tab[data-tag=""]');
await page.selectOption('#sort', 'whose');
assert.ok((await page.locator('.group').allInnerTexts()).includes('Grandma Rosa’s'));
await page.selectOption('#sort', 'az');

// A recipe, as written.
await page.click('.card[data-id="sample-rosa-coffee-cake"]');
await page.locator('.rtitle').waitFor();
assert.equal(await page.locator('.rtitle').innerText(), 'Cinnamon Crumb Coffee Cake');
assert.match(await page.locator('.kitchen').innerText(), /From the kitchen of\s+Grandma Rosa/i);
assert.equal(await ingredient(page, 0), '1 1⁄2 cups all-purpose flour'.replace('1 1', '1 1'), 'as written');
await page.locator('#photoSec:not([hidden]) img').waitFor();
assert.ok(await page.locator('#photoSec img').evaluate(img => img.complete && img.naturalWidth > 500), 'the photo of the card shows');
await page.click('[data-act="photo"]');
assert.equal(await page.getByRole('dialog', { name: 'The original card' }).count(), 1, 'the big photo’s sheet has a name too');
await page.keyboard.press('Escape');
await fits(page, 'a recipe');
assert.equal(await page.locator('.steps-sec .sec-h').evaluate(h => getComputedStyle(h).marginTop), '20px', 'Steps has room above it, under Cook from this');

// Tick one off.
await page.click('.ing[data-i="1"] .tick');
assert.equal(await page.locator('.ing[data-i="1"].got').count(), 1);

// Scale by two.
await page.click('[data-act="scale"]');
assert.equal(await page.getByRole('dialog', { name: 'Scale this recipe' }).count(), 1, 'the sheet is named by its heading');
await page.click('.chip[data-f="2"]');
await page.locator('.scaled').waitFor();
assert.match(await page.locator('.scaled').innerText(), /Doubled · Serves 18/);
assert.equal(await ingredient(page, 0), '3 cups all-purpose flour');
assert.equal(await ingredient(page, 12), '6 tbsp cold butter');
assert.equal(await ingredient(page, 4), '⅔ cup butter or oleo, melted'.replace('⅔', '2⁄3'));
assert.equal(await page.locator('.ing[data-i="1"].got').count(), 1, 'ticks survive scaling');

// Grams, with the USDA note, and the oven in °C.
await page.click('[data-units="metric"]');
assert.equal(await ingredient(page, 0), '375 g ≈ all-purpose flour');
assert.equal(await ingredient(page, 1), '300 g ≈ sugar');
assert.equal(await ingredient(page, 2), '1 tbsp + 1 tsp baking powder', 'teaspoons stay spoons');
assert.equal(await ingredient(page, 6), '350 ml ≈ milk');
assert.match(await text(page), /USDA FoodData Central/);
assert.match(await page.locator('.steps').innerText(), /180°C/);
assert.match(await page.locator('.steps').innerText(), /20 cm square pan/);
await fits(page, 'a recipe in grams');
await page.click('[data-act="unscale"]');
await page.click('[data-units="as"]');
assert.equal(await ingredient(page, 0), '1 1⁄2 cups all-purpose flour');

// Oma Liesel's grams, in cups.
await page.goto(base + '#/r/sample-liesel-apple-cake');
await page.click('[data-units="us"]');
assert.equal(await ingredient(page, 0), '1⁄2 cup + 1 tbsp ≈ butter, soft');
assert.deepEqual(await badBreaks(page), [], 'a number keeps its unit and its ≈ on its line');
assert.equal(await ingredient(page, 4), '1 2⁄3 cups ≈ flour');
assert.equal(await ingredient(page, 1), '3⁄4 cup ≈ sugar');
assert.match(await page.locator('.steps').innerText(), /350°F/);
assert.match(await page.locator('.steps').innerText(), /10 inch springform/);
await page.click('[data-units="as"]');

// An amount that won't work says so and keeps the sheet open: 0, below zero, words, or serving nobody.
await page.goto(base + '#/r/sample-walt-chili');
for (const [field, value] of [['#fIn', '0'], ['#fIn', '-2'], ['#fIn', 'abc'], ['#fIn', '1/0'], ['#yIn', '0']]) {
  await page.click('[data-act="scale"]');
  await page.evaluate(() => { document.getElementById('toast').hidden = true; });
  await page.fill(field, value);
  await page.click('[data-a="apply"]');
  assert.equal(await page.locator('#toast').isVisible(), true, `${field} ${value} says so`);
  assert.match(await page.locator('#toast').innerText(), /That amount won’t work/);
  assert.ok(await uncovered(page, '#toast'), `the message about ${value} shows over the sheet, not behind it`);
  assert.equal(await page.evaluate(() => document.getElementById('sheet').open), true, `the sheet stays open for ${value}`);
  await page.keyboard.press('Escape');
}
assert.equal(await page.locator('.scaled').count(), 0, 'nothing was scaled');
// The toast comes back out of the sheet when it has closed (its close event comes a moment after Escape).
await page.waitForFunction(() => !document.getElementById('toast').closest('dialog'), null, { timeout: 5000, polling: 100 });
// Picking an ingredient under "I have", with no amount there, leaves a scale typed above as it is.
await page.click('[data-act="scale"]');
await page.fill('#fIn', '1.5');
await page.selectOption('#hSel', { index: 1 });
await page.click('[data-a="apply"]');
await page.locator('.scaled').waitFor();
assert.match(await page.locator('.scaled').innerText(), /One and a half times/);
await page.click('[data-act="unscale"]');

// By servings: Uncle Walt's chili for 12 instead of 6.
await page.goto(base + '#/r/sample-walt-chili');
await page.click('[data-act="scale"]');
await page.fill('#yIn', '12');
await page.click('[data-a="apply"]');
await page.locator('.scaled').waitFor();
assert.match(await page.locator('.scaled').innerText(), /Doubled · Serves 12–16/);
assert.equal(await ingredient(page, 1), '4 lb ground beef');
assert.equal(await ingredient(page, 8), '2 cans crushed tomatoes (28 oz each)');

// By what you have: only 3 eggs for Mom's pancakes, which want 2.
await page.goto(base + '#/r/sample-mom-pancakes');
await page.click('[data-act="scale"]');
await page.selectOption('#hSel', { label: 'eggs' });
await page.fill('#hIn', '3');
assert.match(await page.locator('#hNote').innerText(), /The card uses 2 eggs\. That’s ×1½ the recipe\./);
await page.click('[data-a="apply"]');
await page.locator('.scaled').waitFor();
assert.equal(await ingredient(page, 0), '3 cups all-purpose flour');
assert.equal(await ingredient(page, 7), '4 1⁄2 tbsp butter, melted, plus more for the griddle');
assert.match(await text(page), /Amounts written inside the steps are the card’s/);

// A timer from a step, ringing when it's done.
await page.goto(base + '#/r/sample-rosa-coffee-cake');
await page.click('.steps .tm:has-text("35–40 minutes")');
await page.locator('.timer').waitFor();
assert.match(await page.locator('.timer').innerText(), /Bake/);
await page.clock.fastForward('35:01');
await page.locator('.timer.done').waitFor({ timeout: 5000 });
assert.match(await page.locator('.timer.done').innerText(), /Bake: time’s up/);
assert.match(await page.locator('.timer.done').innerText(), /The recipe says 35–40 min/);
assert.ok(await page.evaluate(() => window.fromScratch.timers.rings > 0), 'it beeps');
assert.ok(await page.evaluate(() => window.__buzz > 0), 'it buzzes');
assert.match(await page.title(), /^Time’s up: Bake/, 'the tab says so');
// Stopping it on another screen puts back that screen's title, not the recipe's.
await page.goto(base + '#/');
await page.clock.fastForward(2300);
assert.match(await page.title(), /^Time’s up: Bake/);
await page.click('.timer.done [data-t="cancel"]');
await page.clock.fastForward(300);
assert.equal(await page.locator('#timers').isHidden(), true);
assert.equal(await page.title(), 'From Scratch');
await page.goto(base + '#/r/sample-rosa-coffee-cake');

// Cook mode: one step at a time, the screen kept on, and a timer that keeps going between steps.
await page.click('.cook-btn');
await page.locator('.cook').waitFor();
assert.equal(await page.evaluate(() => window.__wake), 1, 'asks to keep the screen on');
assert.match(await page.locator('#wakeNote').innerText(), /screen stays on/);
assert.equal(await page.locator('.lid').isVisible(), false);
assert.equal(await page.locator('footer.foot').count(), 0, 'no footer in cook mode');
assert.match(await page.locator('.cook-step').innerText(), /Get everything out/);
await page.click('[data-go="1"]');
assert.match(await page.locator('.cook-kicker').innerText(), /Step 1 of 6/i);
await page.keyboard.press('ArrowRight');
assert.match(await page.locator('.cook-kicker').innerText(), /Step 2 of 6/i);
const uses = await page.locator('.uses').innerText();
assert.match(uses, /all-purpose flour/);
assert.match(uses, /baking powder/);
assert.doesNotMatch(uses, /brown sugar/, 'the topping’s sugar isn’t in step 2');
await fits(page, 'cook mode');
for (let i = 0; i < 3; i++) await page.click('[data-go="1"]');
assert.match(await page.locator('.cook-kicker').innerText(), /Step 5 of 6/i);
await page.click('.cook-step .tm');
assert.match(await page.locator('#toast').innerText(), /Timer started/);
for (const b of ['.cook-x', '.cook-aa']) assert.equal(await overlaps(page, '#toast', b), false, `the toast is clear of ${b}`);
await page.click('[data-go="1"]');
assert.match(await page.locator('.cook-kicker').innerText(), /Step 6 of 6/i);
assert.equal(await page.locator('.timer').count(), 1, 'the timer keeps going on the next step');
await page.click('.cook-step .tm');
assert.equal(await page.locator('.timer').count(), 2, 'two timers at once');
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
assert.ok(await uncovered(page, '#wakeNote'), 'the timers don’t hide the note about the screen');
await page.click('.cook-x');
await page.locator('.rtitle').waitFor();
assert.equal(await page.evaluate(() => window.__released), 1, 'lets the screen sleep again');
assert.equal(await page.locator('.timer').count(), 2, 'timers keep going after cook mode');
await page.click('.steps .tm:has-text("15 minutes")');
assert.match(await page.locator('#toast').innerText(), /Timer started/);
assert.equal(await overlaps(page, '#toast', '.lid-btn.add'), false, 'the toast is clear of + Add');
await page.click('.timer [data-t="pause"]');
assert.equal(await page.locator('.timer.paused').count(), 1);
while (await page.locator('.timer').count()) await page.locator('.timer [data-t="cancel"]').first().click();

// Keys in cook mode: Space presses the focused button, as everywhere else, and Escape leaves with nothing focused.
await page.click('.cook-btn');
await page.locator('.cook').waitFor();
assert.match(await page.locator('.cook-kicker').innerText(), /Step 6 of 6/i);
await page.focus('[data-go="-1"]');
await page.keyboard.press(' ');
assert.match(await page.locator('.cook-kicker').innerText(), /Step 5 of 6/i, 'Space on Back goes back');
await page.focus('.cook-aa');
await page.keyboard.press(' ');
assert.equal(await page.getAttribute('.cook-aa', 'aria-pressed'), 'true', 'Space on Aa makes the text larger');
assert.match(await page.locator('.cook-kicker').innerText(), /Step 5 of 6/i, 'and stays on the step');
await page.click('.cook-aa');
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('Escape');
await page.locator('.rtitle').waitFor();

// ---------- typing one in ----------
await page.goto(base + '#/new');
await page.fill('input[name="title"]', 'Peanut Butter Fudge');
await page.fill('input[name="from"]', 'Great-Aunt Dot');
await page.fill('input[name="makes"]', '36 squares');
await page.fill('textarea[name="ingredients"]', '2 c. sugar\n2/3 c. milk\n1 cup peanut butter\n1 tsp vanilla\nFor the top:\nPinch of salt');
await page.locator('#parse .p-sect').waitFor();
assert.match(await page.locator('#parse').innerText(), /2 cups\s+sugar/);
await page.fill('textarea[name="steps"]', 'Boil the sugar and milk 3 minutes, stirring.\nTake off the heat and beat in the peanut butter and vanilla.\nPour into a buttered 8-inch pan and cool 1 hour.');
assert.match(await page.locator('#timesNote').innerText(), /3 minutes, 1 hour/);
await page.fill('textarea[name="notes"]', 'Dot made this every Christmas Eve.');
await page.click('[data-idea="Holidays"]');
await page.setInputFiles('#photoIn', join(root, 'samples/rosa-card.jpg'));
await page.locator('.edit-photo img').waitFor();
await fits(page, 'the form');
await startTimer(page);
assert.ok(await uncovered(page, 'button[type="submit"]'), 'a running timer doesn’t cover Save recipe');
await stopTimers(page);
await page.click('button[type="submit"]');
await page.locator('.rtitle:has-text("Peanut Butter Fudge")').waitFor();
assert.match(await page.locator('.kitchen').innerText(), /Great-Aunt Dot/);
assert.match(await text(page), /Makes 36 squares/);
assert.match(await text(page), /For the top/i);
await page.locator('#photoSec:not([hidden]) img').waitFor();
const fudge = await page.evaluate(() => location.hash.split('/')[2]);

// A draft survives leaving the page.
await page.goto(base + '#/new');
await page.fill('input[name="title"]', 'Half-typed');
await page.goto(base + '#/');
await page.goto(base + '#/new');
assert.equal(await page.inputValue('input[name="title"]'), 'Half-typed');
await page.click('[data-act="discard"]');
assert.equal(await page.inputValue('input[name="title"]'), '');

// ---------- pasting one ----------
await page.goto(base + '#/paste');
await page.fill('#pasteText', `Aunt June's Molasses Crinkles
2 c. flour
2 t. soda
3/4 c. shortening
1 c. brown sugar
1 egg
1/4 c. molasses
Cream shortening and sugar. Add egg and molasses and beat well.
Sift dry ingredients together and add. Chill dough 1 hour.
Roll in balls, dip in sugar. Bake at 375 for 10-12 min.`);
await page.click('[data-act="split"]');
await page.locator('#editForm').waitFor();
assert.equal(await page.inputValue('input[name="title"]'), 'Molasses Crinkles');
assert.equal(await page.inputValue('input[name="from"]'), 'Aunt June');
assert.equal((await page.inputValue('textarea[name="ingredients"]')).split('\n').length, 6);
assert.equal((await page.inputValue('textarea[name="steps"]')).split('\n').length, 3);
await page.click('button[type="submit"]');
await page.locator('.rtitle:has-text("Molasses Crinkles")').waitFor();
assert.equal(await page.locator('.steps .tm').count(), 2, 'the chill and the bake are timers');

// A pasted "Total time" goes in its own field, not in Cook time, and the form can change it (on another phone, so
// this box keeps its count).
const oats = await device({ sw: false });
await oats.page.goto(base + '#/paste');
await oats.page.fill('#pasteText', `Overnight Oats
Prep Time: 5 minutes
Total Time: 8 hours 5 minutes
Servings: 2

Ingredients
1 cup rolled oats
1 cup milk
1/2 cup yogurt

Instructions
1. Stir everything together in a jar.
2. Refrigerate overnight, at least 8 hours.`);
await oats.page.click('[data-act="split"]');
await oats.page.locator('#editForm').waitFor();
const times = p => Promise.all(['prep', 'cook', 'total'].map(k => p.inputValue(`input[name="${k}"]`)));
assert.deepEqual(await times(oats.page), ['5 min', '', '8 hr 5 min'], 'Total time has a field of its own');
await fits(oats.page, 'the form with three times');
await oats.page.click('button[type="submit"]');
await oats.page.locator('.rtitle:has-text("Overnight Oats")').waitFor();
assert.equal(await oats.page.locator('.rhead .meta').innerText(), 'Serves 2 · Prep 5 min · Total 8 hr 5 min');
await oats.page.click('a.act[href$="/edit"]');
await oats.page.locator('#editForm').waitFor();
assert.deepEqual(await times(oats.page), ['5 min', '', '8 hr 5 min'], 'the form shows the total it saved');
await oats.page.fill('input[name="total"]', '8 hr 10 min');
await oats.page.click('button[type="submit"]');
await oats.page.locator('.rtitle:has-text("Overnight Oats")').waitFor();
assert.equal(await oats.page.locator('.rhead .meta').innerText(), 'Serves 2 · Prep 5 min · Total 8 hr 10 min');
await oats.ctx.close();

// ---------- a link from Claude ----------
const python = spawnSync('python3', ['--version']).status === 0;
let claudeLink;
if (python) {
  const out = execFileSync('python3', [join(root, 'skill/from-scratch-cards/scripts/make_card_link.py'), join(root, 'skill/from-scratch-cards/references/example-batch.json'), '--out', OUT, '--base', base], { encoding: 'utf8' });
  claudeLink = /Link: (\S+)/.exec(out)[1];
} else {
  const { pack } = await import('../js/share.js');
  claudeLink = base + '#/add/' + await pack(JSON.parse(await readFile(join(root, 'skill/from-scratch-cards/references/example-batch.json'), 'utf8')));
}
await page.goto(claudeLink);
await page.locator('.review').first().waitFor();
assert.match(await page.locator('.page-title').innerText(), /2 recipes for your box/);
assert.match(await text(page), /1 recipe to check against the card/);
assert.match(await page.locator('.review').nth(1).innerText(), /Check against the card: The oven temperature is smudged/);
await fits(page, 'recipes from Claude');
assert.equal(await page.locator('main footer.foot').count(), 1, 'the footer under recipes from Claude');
await startTimer(page);
assert.ok(await uncovered(page, '[data-act="add"]'), 'a running timer doesn’t cover the Add button');
await stopTimers(page);
await page.click('[data-act="add"]');
await page.locator('.card').first().waitFor();
assert.equal(await page.locator('.card').count(), 9);
assert.equal(await page.locator('.card .flag').count(), 1, 'the one to check is flagged in the box');
await page.click('.card:has-text("Refrigerator Rolls")');
await page.locator('.recipe .check').waitFor();
assert.match(await page.locator('.recipe .check').innerText(), /Check this against the card: The oven temperature is smudged/, 'the note reads on from the flag');
await page.click('[data-act="checked"]');
assert.equal(await page.locator('.recipe .check').count(), 0);
assert.match(await page.locator('.steps').innerText(), /about 1 hr/);
await page.goto(claudeLink);
await page.locator('.review').first().waitFor();
assert.equal(await page.locator('text=Already in your box').count(), 2, 'opening the same link again adds nothing');
assert.equal(await page.locator('[data-act="add"]').isDisabled(), true);

// Pasting what Claude gave, or opening the file, goes to the same place, even with words and a full stop around the link.
await page.goto(base + '#/add');
await page.fill('#incomingText', `Here are Nana’s cards: ${claudeLink}.`);
await page.click('[data-act="open"]');
await page.locator('.review').first().waitFor();

// ---------- sending a recipe to family ----------
await page.goto(base + '#/r/sample-rosa-coffee-cake');
await page.click('[data-act="share"]');
const link = await page.inputValue('#shareLink');
assert.ok(link.startsWith(base + '#/add/z'), 'the link points back to this page');
await page.click('#shareCopy');
assert.equal(await page.evaluate(() => navigator.clipboard.readText()), link, 'Copy link copies it');
await page.click('[data-a="text"]');
assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^Cinnamon Crumb Coffee Cake \(Grandma Rosa’s\)[\s\S]*- 1½ cups all-purpose flour/);
await page.keyboard.press('Escape');
await page.goto(link);
await page.locator('.review').waitFor();
assert.equal(await page.locator('text=Already in your box').count(), 1, 'your own link finds your copy');

const sis = await device();
await sis.page.goto(link);
await sis.page.locator('.review').waitFor();
assert.match(await sis.page.locator('.page-title').innerText(), /A recipe for your box/);
await sis.page.click('[data-act="add"]');
await sis.page.locator('.rtitle:has-text("Cinnamon Crumb Coffee Cake")').waitFor();
assert.match(await sis.page.locator('.kitchen').innerText(), /Grandma Rosa/);
assert.equal(await sis.page.evaluate(() => window.fromScratch.box.all().length), 1);
await sis.ctx.close();

// ---------- printing ----------
async function printAs(paper, name) {
  const printed = await page.evaluate(() => window.__printed || 0);
  await page.click('[data-act="print"]');
  await page.check(`input[name="paper"][value="${paper}"]`);
  await page.click('[data-a="print"]');
  await page.waitForFunction(n => window.__printed === n, printed + 1, { polling: 100 });
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ path: join(OUT, name), preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: null });
  const raw = pdf.toString('latin1');
  const box = /\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/.exec(raw);
  return { w: Math.round(+box[1]), h: Math.round(+box[2]), pages: (raw.match(/\/Type\s*\/Page[^s]/g) || []).length };
}
await page.goto(base + '#/r/sample-june-lemon-cookies');
const card = await printAs('card', 'june-card.pdf');
assert.deepEqual([card.w, card.h], [432, 288], 'a 6 × 4 inch index card');
assert.ok(card.pages >= 1 && card.pages <= 2, 'one or two cards');
const letter = await printAs('letter', 'june-letter.pdf');
assert.deepEqual([letter.w, letter.h], [612, 792], 'letter paper');
assert.equal(letter.pages, 1);
assert.match(await page.locator('#printRoot').innerText(), /From the kitchen of\s+Aunt June/i);
// A recipe too long for one card carries on to a second, which starts with its name.
await page.goto(base + '#/r/sample-rosa-coffee-cake');
const rosa = await printAs('card', 'rosa-card.pdf');
assert.equal(rosa.pages, 2, 'two cards, and no page left over');
assert.equal(await page.locator('#printRoot .pcard').count(), 2);
assert.equal(await page.locator('#printRoot .pcard + .pcard .p-cont').innerText(), 'Cinnamon Crumb Coffee Cake (continued)');
assert.equal(await page.locator('#printRoot .pcard + .pcard .p-steps').getAttribute('start'), '6', 'the steps go on from 6');

// ---------- removing, with undo ----------
await page.goto(base + `#/r/${fudge}`);
await page.click('[data-act="remove"]');
await page.click('[data-a="yes"]');
await page.locator('.card').first().waitFor();
assert.equal(await page.locator('.card:has-text("Peanut Butter Fudge")').count(), 0);
await page.click('.toast button');
await page.locator('.rtitle:has-text("Peanut Butter Fudge")').waitFor();
await page.locator('#photoSec:not([hidden]) img').waitFor({ timeout: 5000 });

// Another tab on this device sees changes straight away.
const tab2 = await mark.ctx.newPage();
await tab2.goto(base + '#/');
await tab2.locator('.card').first().waitFor();
await page.goto(base + '#/');
await tab2.evaluate(id => { const b = window.fromScratch.box; b.put({ ...b.get(id), title: 'Grandma Rosa’s Coffee Cake' }); }, 'sample-rosa-coffee-cake');
await page.locator('.card:has-text("Grandma Rosa’s Coffee Cake")').waitFor({ timeout: 5000 });
await tab2.close();

// ---------- backups ----------
await page.goto(base + '#/settings');
const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="backup"]')]);
const backupPath = join(OUT, 'backup.json');
await download.saveAs(backupPath);
const saved = JSON.parse(await readFile(backupPath, 'utf8'));
assert.equal(Object.values(saved.box.recipes).filter(r => !r.del).length, 9);
assert.ok(saved.photos['sample-rosa-coffee-cake'].startsWith('data:image/jpeg;base64,'), 'photos go in the backup');
await page.click('[data-act="erase"]');
await page.click('[data-a="yes"]');
await page.locator('text=Your recipe box is empty').waitFor();
// A backup also carries markers for removed recipes, which aren't counted as recipes, and here a photo that isn't
// readable, which is skipped.
const marked = join(OUT, 'backup-with-removals.json');
await writeFile(marked, JSON.stringify({
  ...saved,
  box: { recipes: { ...saved.box.recipes, 'r-gone1': { id: 'r-gone1', t: 5, del: 1 }, 'r-gone2': { id: 'r-gone2', t: 5, del: 1 }, 'r-gone3': { id: 'r-gone3', t: 5, del: 1 } } },
  photos: { 'r-smudged': 'data:image/jpeg;base64,@@@notbase64@@@', ...saved.photos },
}));
await page.goto(base + '#/settings');
await page.setInputFiles('#restoreIn', marked);
await page.locator('.card').first().waitFor();
assert.equal(await page.locator('.card').count(), 9, 'the backup brings everything back');
assert.equal(await page.locator('#toast').innerText(), 'Loaded the backup: 9 recipes new or updated, 2 photos');
await page.locator('.card[data-id="sample-rosa-coffee-cake"] .clip:not([hidden])').waitFor({ timeout: 5000 });

// Survives a reload, and works offline once it has been opened.
await page.reload();
await page.locator('.card').first().waitFor();
assert.equal(await page.locator('.card').count(), 9);
await fits(page, 'the full box');
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000, polling: 100 });
down = true;
await page.reload();
await page.locator('.card').first().waitFor();
assert.equal(await page.locator('.card').count(), 9, 'loads offline');
await page.goto(base + '#/r/sample-walt-chili');
assert.match(await page.locator('.rtitle').innerText(), /Chili/);
down = false;
await mark.ctx.close();

// ---------- a full browser ----------
// Every tool at junkdrawer.works/REPO/ shares localStorage. When it's full, a recipe that couldn't be saved isn't
// reported as added, and the form keeps what was typed.
const crowded = await device({ sw: false });
await crowded.page.goto(base + '#/new');
await crowded.page.evaluate(() => {
  let n = 0;
  for (let size = 1 << 20; size >= 1; size >>= 1) {
    const v = 'x'.repeat(size);
    try { for (;;) localStorage.setItem('other-tool.' + n++, v); } catch { /* next size down */ }
  }
});
await crowded.page.fill('input[name="title"]', 'Aunt Ruth’s Rhubarb Crisp');
await crowded.page.fill('textarea[name="ingredients"]', '4 cups rhubarb');
await crowded.page.click('button[type="submit"]');
assert.match(await crowded.page.locator('#toast').innerText(), /storage is full, so the recipe wasn’t saved/);
assert.equal(await crowded.page.inputValue('input[name="title"]'), 'Aunt Ruth’s Rhubarb Crisp', 'the form keeps it');
await crowded.page.reload();
await crowded.page.goto(base + '#/');
await crowded.page.locator('text=Your recipe box is empty').waitFor();
await crowded.ctx.close();

// ---------- long words ----------
// A German cake and a web address in the notes break onto the next line instead of pushing the page sideways.
const wide = await device({ sw: false });
await wide.page.goto(base);
await wide.page.evaluate(url => window.fromScratch.box.put({ id: 'r-torte', title: 'Schwarzwälderkirschtorte', from: 'Oma Liesel', ingredients: ['200 g Mehl'], steps: [`Backen 40 Minuten, siehe ${url}`], notes: `Aus ${url}`, source: url }),
  'https://www.chefkoch.de/rezepte/1234567890123456/Schwarzwaelder-Kirschtorte-nach-Omas-Art.html');
await wide.page.goto(base + '#/r/r-torte');
await wide.page.locator('.rtitle').waitFor();
await fits(wide.page, 'a recipe with long words');
await wide.page.goto(base + '#/r/r-torte/cook');
await wide.page.click('[data-go="1"]');
await wide.page.click('[data-go="1"]');
await wide.page.locator('text=That was the last step').waitFor();
await fits(wide.page, 'cook mode’s last screen, with a web address in the notes');
await wide.ctx.close();

// ---------- Google Drive ----------
// Two devices share one fake Drive. The page only offers Drive at junkdrawer.works, so it's told this address is fine too.
const g = fakeGoogle();
const driveProblems = [];
async function driveDevice(pre) {
  const d = await device({ watch: false, sw: false });
  d.page.on('pageerror', e => driveProblems.push(e.message));
  d.page.on('console', m => { if (m.type() === 'error' && !/401/.test(m.text())) driveProblems.push(m.text()); });
  await g.install(d.ctx, { rewrite: { '**/js/sync.js': s => s.replace("['https://junkdrawer.works']", `['https://junkdrawer.works', '${origin}']`) } });
  if (pre) await d.ctx.addInitScript(pre);
  await d.page.goto(base);
  return d;
}
const synced = page => page.evaluate(() => window.fromScratch.sync().last);
async function syncNow(page) {
  const before = await synced(page);
  await page.click('#cloud');
  await page.waitForFunction(b => { const s = window.fromScratch.sync(); return s.last > b && s.status === 'ok'; }, before, { timeout: 10000 })
    .catch(async e => { throw new Error(`sync didn't finish: ${JSON.stringify(await page.evaluate(() => window.fromScratch.sync()))}`); });
}
const put = (page, r) => page.evaluate(r => window.fromScratch.box.put(r), r);
const titles = page => page.evaluate(() => window.fromScratch.box.all().map(r => r.title).sort());
const driveBox = () => {
  const f = g.files().find(x => x.appProperties?.fromscratch === 'recipes' && !x.trashed);
  return f ? JSON.parse(f.body).box.recipes : null;
};
const liveInDrive = () => Object.values(driveBox() || {}).filter(r => !r.del).map(r => r.title).sort();

// Turning it on.
const A = await driveDevice();
await put(A.page, { id: 'r-pie', title: 'Apple Pie', from: 'Nana', ingredients: ['6 apples'], steps: ['Bake 50 minutes.'] });
await put(A.page, { id: 'r-soup', title: 'Bean Soup', from: 'Pop', ingredients: ['1 lb beans'], steps: ['Simmer 2 hours.'] });
await A.page.goto(base + '#/settings');
await A.page.waitForFunction(() => window.google?.accounts);
await A.page.locator('#driveCard:not([hidden]) [data-a="on"]').click();
await A.page.waitForFunction(() => window.fromScratch.sync().status === 'ok' && window.fromScratch.sync().last > 0, null, { timeout: 10000 });
assert.equal((await A.page.evaluate(() => window.__prompts))[0].prompt, 'select_account', 'the first sign-in lets them choose an account');
const folder = g.files().find(f => f.appProperties?.fromscratch === 'folder');
assert.equal(folder.name, 'From Scratch');
assert.equal(folder.mimeType, 'application/vnd.google-apps.folder');
const file = g.files().find(f => f.appProperties?.fromscratch === 'recipes');
assert.equal(file.name, 'From Scratch recipes.json');
assert.deepEqual(file.parents, [folder.id]);
assert.deepEqual(liveInDrive(), ['Apple Pie', 'Bean Soup']);
const shared = await A.page.evaluate(() => JSON.parse(localStorage.getItem('junkdrawer.google')));
assert.equal(shared.token, 'tok-mark');
assert.ok(shared.scope.includes('https://www.googleapis.com/auth/drive.file'));
assert.equal(shared.email, 'mark@gmail.com', 'the account is remembered for next time');
assert.ok(shared.exp > Date.now());
await A.page.goto(base + '#/');
assert.equal(await A.page.getAttribute('#cloud', 'data-s'), 'ok');
assert.equal(await A.page.locator('#cloud').isVisible(), true);

// A second device joining: nothing on either side is lost, and the same recipe typed on both becomes one.
const B = await driveDevice();
await put(B.page, { id: 'r-bread', title: 'Soda Bread', from: 'Nana', ingredients: ['4 cups flour'], steps: ['Bake 40 minutes.'] });
await put(B.page, { id: 'r-pie-again', title: 'Apple Pie', from: 'Nana', ingredients: ['6 apples'], steps: ['Bake 50 minutes.'] });
await B.page.goto(base + '#/settings');
await B.page.waitForFunction(() => window.google?.accounts);
await B.page.locator('#driveCard [data-a="on"]').click();
await B.page.waitForFunction(() => window.fromScratch.sync().status === 'ok' && window.fromScratch.sync().last > 0, null, { timeout: 10000 });
assert.deepEqual(await titles(B.page), ['Apple Pie', 'Bean Soup', 'Soda Bread']);
assert.deepEqual(liveInDrive(), ['Apple Pie', 'Bean Soup', 'Soda Bread']);
assert.equal(driveBox()['r-pie-again'].to, 'r-pie', 'the copy points at the one kept');
await A.page.goto(base + '#/');
await syncNow(A.page);
assert.deepEqual(await titles(A.page), ['Apple Pie', 'Bean Soup', 'Soda Bread']);
assert.equal(await A.page.locator('.card').count(), 3, 'the page shows what the sync brought');

// Both devices editing different recipes.
await put(A.page, { ...(await A.page.evaluate(() => window.fromScratch.box.get('r-pie'))), notes: 'Use Granny Smiths.' });
await put(B.page, { ...(await B.page.evaluate(() => window.fromScratch.box.get('r-bread'))), title: 'Irish Soda Bread' });
await syncNow(A.page);
await syncNow(B.page);
await syncNow(A.page);
for (const d of [A, B]) {
  assert.equal(await d.page.evaluate(() => window.fromScratch.box.get('r-pie').notes), 'Use Granny Smiths.');
  assert.equal(await d.page.evaluate(() => window.fromScratch.box.get('r-bread').title), 'Irish Soda Bread');
}

// Both editing the same recipe: the later change wins everywhere.
await put(A.page, { ...(await A.page.evaluate(() => window.fromScratch.box.get('r-soup'))), notes: 'From A' });
await A.page.waitForTimeout(20);
await put(B.page, { ...(await B.page.evaluate(() => window.fromScratch.box.get('r-soup'))), notes: 'From B, later' });
await syncNow(A.page);
await syncNow(B.page);
await syncNow(A.page);
for (const d of [A, B]) assert.equal(await d.page.evaluate(() => window.fromScratch.box.get('r-soup').notes), 'From B, later');
assert.equal(driveBox()['r-soup'].notes, 'From B, later');

// A deletion reaches the other device, and the page showing that recipe goes back to the box.
await B.page.goto(base + '#/r/r-soup');
await A.page.evaluate(() => window.fromScratch.box.remove('r-soup'));
await syncNow(A.page);
assert.equal(driveBox()['r-soup'].del, 1, 'Drive keeps a removal marker');
await syncNow(B.page);
assert.equal(await B.page.evaluate(() => window.fromScratch.box.get('r-soup')), null);
await B.page.waitForFunction(() => location.hash === '#/' || location.hash === '');

// Synced changes reach the page on screen, without a reload.
await B.page.goto(base + '#/r/r-pie');
await put(A.page, { ...(await A.page.evaluate(() => window.fromScratch.box.get('r-pie'))), title: 'Dutch Apple Pie' });
await syncNow(A.page);
await syncNow(B.page);
await B.page.locator('.rtitle:has-text("Dutch Apple Pie")').waitFor({ timeout: 5000 });

// A sync that lands while a sheet is open shows once it closes, and "It's right" keeps what the other device saved.
await put(A.page, { ...(await A.page.evaluate(() => window.fromScratch.box.get('r-pie'))), check: 'the oven temperature is smudged' });
await syncNow(A.page);
await syncNow(B.page);
await A.page.goto(base + '#/r/r-pie');
await A.page.click('[data-act="share"]');
await A.page.locator('#sheet[open]').waitFor();
await put(B.page, { ...(await B.page.evaluate(() => window.fromScratch.box.get('r-pie'))), notes: 'Use Granny Smiths. B says cut them thick.' });
await syncNow(B.page);
const sheetSync = await synced(A.page);
await A.page.evaluate(() => document.getElementById('cloud').click()); // what the minute's sync does, under the sheet
await A.page.waitForFunction(b => window.fromScratch.sync().last > b && window.fromScratch.sync().status === 'ok', sheetSync, { timeout: 10000 });
await A.page.keyboard.press('Escape');
await A.page.locator('.note-card:has-text("B says cut them thick")').waitFor({ timeout: 5000 });
await A.page.click('[data-act="checked"]');
assert.equal(await A.page.evaluate(() => window.fromScratch.box.get('r-pie').notes), 'Use Granny Smiths. B says cut them thick.', 'It’s right didn’t write the old copy back');
assert.equal(await A.page.evaluate(() => window.fromScratch.box.get('r-pie').check), undefined);

// Another device saves between this device's read and its write: it reads again and merges, keeping both.
let raced = false;
await B.ctx.route(/googleapis\.com\/drive\/v3\/files\/[\w-]+\?alt=media/, async route => {
  if (!raced) {
    raced = true;
    await put(A.page, { ...(await A.page.evaluate(() => window.fromScratch.box.get('r-bread'))), notes: 'A saved in the middle' });
    await syncNow(A.page);
    await put(B.page, { id: 'r-scones', title: 'Scones', from: 'Nana', ingredients: ['2 cups flour'], steps: ['Bake 15 minutes.'] });
  }
  await route.fallback();
});
await put(B.page, { ...(await B.page.evaluate(() => window.fromScratch.box.get('r-pie'))), notes: 'B saved first' });
await syncNow(B.page);
assert.ok(raced, 'the race happened');
await B.page.waitForFunction(() => !window.fromScratch.sync().pending || window.fromScratch.sync().status === 'ok');
await syncNow(B.page);
const after = driveBox();
assert.equal(after['r-bread'].notes, 'A saved in the middle', 'A’s save survived');
assert.equal(after['r-pie'].notes, 'B saved first', 'B’s save survived');
assert.equal(after['r-scones']?.title, 'Scones', 'what B saved during the sync got there too');

// An expired sign-in: the dot turns red, and one tap signs back in (skipping Google's account chooser) and syncs.
await A.page.goto(base + '#/');
await A.page.evaluate(() => {
  const g = JSON.parse(localStorage.getItem('junkdrawer.google'));
  localStorage.setItem('junkdrawer.google', JSON.stringify({ ...g, token: 'tok-expired' }));
});
await A.page.click('#cloud');
await A.page.waitForFunction(() => document.getElementById('cloud').dataset.s === 'tap', null, { timeout: 10000 });
assert.equal(await A.page.evaluate(() => localStorage.getItem('junkdrawer.google')), null, 'a refused sign-in is forgotten');
const before = await synced(A.page);
await A.page.click('#cloud');
await A.page.waitForFunction(b => window.fromScratch.sync().last > b && window.fromScratch.sync().status === 'ok', before, { timeout: 10000 });
const prompts = await A.page.evaluate(() => window.__prompts);
assert.deepEqual(prompts.at(-1), { prompt: '', login_hint: 'mark@gmail.com' });
assert.deepEqual(await titles(A.page), ['Dutch Apple Pie', 'Irish Soda Bread', 'Scones']);

// A sign-in from another junkdrawer.works project on this device is used without asking again.
const C = await driveDevice(() => {
  if (!localStorage.getItem('junkdrawer.google')) localStorage.setItem('junkdrawer.google', JSON.stringify({ token: 'tok-mark', exp: Date.now() + 50 * 60000, scope: 'https://www.googleapis.com/auth/drive.file', email: 'mark@gmail.com' }));
});
await C.page.goto(base + '#/settings');
await C.page.locator('#driveCard [data-a="on"]').click();
await C.page.waitForFunction(() => window.fromScratch.sync().status === 'ok' && window.fromScratch.sync().last > 0, null, { timeout: 10000 });
assert.equal(await C.page.evaluate(() => window.__prompts), undefined, 'no Google window at all');
assert.deepEqual(await titles(C.page), ['Dutch Apple Pie', 'Irish Soda Bread', 'Scones']);
await C.ctx.close();

// Stopping: this device stops saving, the shared sign-in stays for the other projects, and nothing is revoked.
await A.page.goto(base + '#/settings');
await A.page.locator('#driveCard [data-a="off"]').click();
await A.page.locator('#driveCard [data-a="off"]:has-text("Tap again to stop")').click();
await A.page.locator('#driveCard [data-a="on"]').waitFor();
assert.notEqual(await A.page.evaluate(() => localStorage.getItem('junkdrawer.google')), null);
assert.equal(await A.page.evaluate(() => window.__revoked), undefined);
const calls = g.calls.length;
await put(A.page, { id: 'r-local', title: 'Only Here', ingredients: ['1 egg'], steps: ['Fry it.'] });
await A.page.waitForTimeout(2600);
assert.equal(g.calls.length, calls, 'nothing goes to Drive after stopping');
await A.page.goto(base + '#/');
assert.equal(await A.page.locator('#cloud').isVisible(), false);
await A.ctx.close();

// Erasing a device that saves to Drive stops it saving there, so the recipes in Drive don't come straight back,
// not even from a sync that was already waiting on Drive when Erase was tapped.
let heldOnce, letGo;
const held = new Promise(r => { heldOnce = r; }), goOn = new Promise(r => { letGo = r; });
await B.ctx.route(/googleapis\.com\/drive\/v3\/files\/[\w-]+\?alt=media/, async route => {
  if (heldOnce) { const h = heldOnce; heldOnce = null; h(); await goOn; }
  await route.fallback();
});
await B.page.goto(base + '#/settings');
await put(B.page, { id: 'r-late', title: 'Late Change', ingredients: ['1 cup flour'], steps: ['Bake 10 minutes.'] });
await held;
await B.page.click('[data-act="erase"]');
assert.match(await B.page.locator('#sheet').innerText(), /stops saving to Google Drive/);
await B.page.click('[data-a="yes"]');
await B.page.locator('text=Your recipe box is empty').waitFor();
letGo();
await B.page.waitForFunction(() => window.fromScratch.sync().status === 'off', null, { timeout: 10000 });
await B.page.waitForTimeout(3000);
assert.equal(await B.page.evaluate(() => window.fromScratch.box.all().length), 0, 'nothing comes back from Drive after erasing');
assert.equal(await B.page.evaluate(() => window.fromScratch.sync().on), false);
assert.equal(await B.page.evaluate(() => localStorage.getItem('fromscratch.drive')), null);
assert.equal(await B.page.locator('#cloud').isVisible(), false);
assert.deepEqual(liveInDrive(), ['Dutch Apple Pie', 'Irish Soda Bread', 'Scones'], 'Drive keeps its recipes');
await B.ctx.close();

// Away from junkdrawer.works (here, without the rewrite), there's no Drive at all and nothing loads from Google.
const plain = await device({ sw: false });
await plain.page.goto(base + '#/settings');
assert.equal(await plain.page.locator('#driveCard').isHidden(), true);
assert.equal(await plain.page.locator('#cloud').isHidden(), true);
await plain.ctx.close();

assert.deepEqual(driveProblems, [], 'problems while syncing');
assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
await browser.close();
server.close();
console.log(`all good (PDFs and the backup are in ${OUT})`);
