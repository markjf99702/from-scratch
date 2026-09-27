// Renders the README screenshots (docs/*.png) and the link preview (og.png):  node tools/screenshots.mjs
// Uses the five sample recipes. Needs Playwright, and upng-js from `npm install`.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const UPNG = require('upng-js');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const browser = await pw.chromium.launch();
await mkdir(join(root, 'docs'), { recursive: true });

// A 256-colour palette keeps the PNGs small.
async function save(shot, path, colours = 256) {
  const img = UPNG.decode(shot);
  await writeFile(join(root, path), Buffer.from(UPNG.encode(UPNG.toRGBA8(img), img.width, img.height, colours)));
}

async function open(viewport, deviceScaleFactor) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: 'light' });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => ({ addEventListener() {}, release: async () => {} }) } });
  });
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date('2026-09-27T17:30:00') });
  await page.goto(base);
  await page.evaluate(() => window.fromScratch.addSamples());
  await page.evaluate(() => document.fonts.ready);
  return page;
}
const settle = page => page.waitForTimeout(250);

// Phone screenshots for the README.
{
  const page = await open({ width: 390, height: 844 }, 2);
  await page.goto(base + '#/');
  await page.locator('.card[data-id="sample-rosa-coffee-cake"] .clip:not([hidden])').waitFor();
  await settle(page);
  await save(await page.screenshot(), 'docs/phone-box.png');

  // Aunt June's cookies, doubled and in grams.
  await page.goto(base + '#/r/sample-june-lemon-cookies');
  await page.click('[data-act="scale"]');
  await page.click('.chip[data-f="2"]');
  await page.click('[data-units="metric"]');
  await page.evaluate(() => window.scrollTo(0, document.querySelector('.rhead').getBoundingClientRect().top + scrollY - 12));
  await settle(page);
  await save(await page.screenshot(), 'docs/phone-recipe.png');

  // Cook mode on Uncle Walt's chili, simmering with a timer running.
  await page.click('[data-act="unscale"]');
  await page.click('[data-units="as"]');
  await page.goto(base + '#/r/sample-walt-chili/cook');
  for (let i = 0; i < 3; i++) await page.click('[data-go="1"]');
  await page.click('.cook-step .tm');
  await page.clock.runFor('12:18');
  await page.evaluate(() => document.getElementById('toast').hidden = true);
  await settle(page);
  await save(await page.screenshot(), 'docs/phone-cook.png');
  await page.evaluate(() => window.fromScratch.timers.all().forEach(t => window.fromScratch.timers.cancel(t.id)));

  // Recipes from Claude, ready to check against the cards.
  const { pack } = await import('../js/share.js');
  const batch = JSON.parse(await readFile(join(root, 'skill/from-scratch-cards/references/example-batch.json'), 'utf8'));
  await page.goto(base + '#/add/' + await pack({ fromScratch: 1, name: "Nana Bea's card", recipes: batch.recipes.slice(1) }));
  await page.locator('.review').waitFor();
  await settle(page);
  await save(await page.screenshot(), 'docs/phone-claude.png');
  await page.context().close();
}

// Link preview, 1200 x 630: the name and one line on the left; on the right, the photo of a handwritten card
// and the same recipe typed up in From Scratch.
{
  const page = await open({ width: 1200, height: 630 }, 1);
  await page.goto(base + '#/r/sample-rosa-coffee-cake');
  await page.locator('.recipe .ruled').waitFor();
  await page.evaluate(async () => {
    const lines = [...document.querySelectorAll('.recipe .ing')].slice(0, 7).map(li => li.outerHTML).join('');
    const kitchen = document.querySelector('.recipe .kitchen').outerHTML;
    document.body.innerHTML = `<div class="og">
      <div class="og-text">
        <div class="og-mark"><span class="holder"><span class="label">From Scratch</span></span></div>
        <h1>The family recipe box.</h1>
        <p>Photograph a stained index card and Claude types it up. Then scale it, switch to grams, and cook from it with the screen kept on.</p>
      </div>
      <div class="og-art">
        <div class="og-shot"><img class="og-photo" src="samples/rosa-card.jpg" alt=""></div>
        <div class="og-card paper recipe">
          ${kitchen}
          <h2 class="rtitle">Cinnamon Crumb Coffee Cake</h2>
          <div class="ruled"><ul class="ings">${lines}</ul></div>
        </div>
      </div>
    </div>`;
    const style = document.createElement('style');
    style.textContent = `
      body { width: 1200px; height: 630px; overflow: hidden; margin: 0;
        background: radial-gradient(ellipse at 80% 40%, #f6efe0, var(--bg) 60%); }
      .og { position: relative; height: 630px; }
      .og::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 16px;
        background: linear-gradient(to bottom, var(--tin-hi), var(--tin) 60%, var(--tin-lo)); box-shadow: 0 3px 0 var(--brass); }
      .og-text { position: absolute; left: 64px; top: 86px; width: 470px; }
      .og-mark .label { font-size: 44px; padding: 8px 24px 6px; }
      .og-mark .holder { padding: 6px; border-radius: 9px; }
      .og-text h1 { font: 650 50px/1.08 var(--display); letter-spacing: -.015em; margin: 34px 0 18px; color: var(--ink); }
      .og-text p { font: 500 25px/1.42 var(--body); color: var(--ink-2); margin: 0; }
      .og-art { position: absolute; left: 560px; top: 0; width: 640px; height: 630px; }
      .og-shot { position: absolute; left: -40px; top: 38px; width: 640px; transform: rotate(-3deg); filter: drop-shadow(0 18px 18px rgba(60, 35, 10, .35)); }
      /* just the card from the photo, cut along its corners */
      .og-photo { display: block; width: 100%; clip-path: polygon(10.2% 19%, 85.5% 13.5%, 90% 84.2%, 11.3% 90.4%); }
      .og-card { position: absolute; left: 190px; top: 268px; width: 420px; padding: 16px 22px 8px; transform: rotate(2.5deg);
        box-shadow: 0 30px 50px -20px rgba(60, 35, 10, .65), 0 2px 6px rgba(60, 35, 10, .2); }
      .og-card .kitchen { font-size: 11px; } .og-card .kitchen .hand { font-size: 24px; }
      .og-card .rtitle { font-size: 25px; margin: 2px 0 8px; padding-bottom: 8px; border-bottom: 2px solid var(--red); white-space: nowrap; }
      .og-card .ing > .tick { font-size: 15.5px; grid-template-columns: 5.6rem 1fr; padding-left: 0; }
      .og-card .ing > .tick::before { display: none; }
      .og-card { --lh: 1.6rem; }`;
    document.head.append(style);
    await document.fonts.ready;
    await new Promise(r => { const img = document.querySelector('.og-photo'); if (img.complete) r(); else img.onload = r; });
  });
  await settle(page);
  await save(await page.screenshot(), 'og.png');
  await page.context().close();
}

await browser.close();
server.close();
console.log('screenshots written');
