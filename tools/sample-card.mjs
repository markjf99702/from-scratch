// Draws the made-up "photo" of Grandma Rosa's recipe card for the samples:  node tools/sample-card.mjs
// It's a 4 x 6 card written in the Caveat font on a kitchen counter, with a butter stain, the way a phone photo
// of an old card looks. Writes samples/rosa-card.jpg.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const font = async f => `data:font/woff2;base64,${(await readFile(join(root, 'fonts', f))).toString('base64')}`;

// Each line of her writing: [text, left offset, tilt in degrees]
const LINES = [
  ['1½ c. flour', 0, -0.6], ['¾ c. sugar', 330, -0.4],
  ['2 t. B.P.', 0, 0.3], ['½ t. salt', 330, -0.8],
  ['⅓ c. oleo — melted', 0, -0.3], ['1 egg', 330, 0.5],
  ['¾ c. milk', 0, -0.9], ['1 t. van.', 330, -0.2],
  ['Topping — ½ c. br. sugar, ⅓ c. flour, 2 t. cinn.', 0, -0.5],
  ['3 T. cold butter, cut in till crumbly. ½ c. nuts', 0, 0.2],
  ['Mix dry. Add oleo, egg, milk & van. Spread in', 0, -0.4],
  ['greased 8" sq. pan. Sprinkle topping over.', 0, -0.7],
  ['Bake mod. oven (350°) 35-40 min.', 0, -0.2],
];

const html = `<!doctype html><html><head><style>
@font-face { font-family: Caveat; src: url(${await font('caveat.woff2')}); font-weight: 400 700; }
@font-face { font-family: Figtree; src: url(${await font('figtree.woff2')}); font-weight: 300 900; }
html, body { margin: 0; width: 1400px; height: 1000px; overflow: hidden; }
body {
  background:
    radial-gradient(ellipse at 30% 20%, rgba(255,255,255,.25), transparent 60%),
    repeating-linear-gradient(95deg, rgba(90,55,25,.05) 0 3px, transparent 3px 11px),
    repeating-linear-gradient(88deg, rgba(60,35,15,.06) 0 1px, transparent 1px 7px),
    linear-gradient(160deg, #b98b5e, #a0714a 60%, #8c6240);
}
.card {
  position: absolute; left: 150px; top: 150px; width: 1080px; height: 720px;
  transform: perspective(2400px) rotateX(9deg) rotateZ(-3.2deg);
  background:
    radial-gradient(ellipse 190px 130px at 88% 16%, rgba(214,170,80,.35), rgba(214,170,80,.18) 55%, transparent 72%),
    radial-gradient(ellipse 60px 40px at 84% 12%, rgba(190,140,50,.25), transparent 70%),
    radial-gradient(ellipse at 50% 50%, #fbf6e6 55%, #efe3c4 100%);
  box-shadow: 0 30px 60px -20px rgba(40,20,5,.7), 0 8px 18px rgba(40,20,5,.35);
  border-radius: 6px;
  overflow: hidden;
}
.rules { position: absolute; inset: 0; background: repeating-linear-gradient(to bottom, transparent 0 47px, rgba(110,150,200,.55) 47px 49px) 0 118px / 100% 100% no-repeat; }
.red { position: absolute; left: 0; right: 0; top: 118px; height: 3px; background: rgba(215,90,80,.8); }
.print { position: absolute; font: 700 18px Figtree, sans-serif; letter-spacing: .12em; color: rgba(150,70,60,.85); }
.w { position: absolute; font: 600 46px/1 Caveat, cursive; color: #2b3563; white-space: nowrap; }
.title { font-size: 60px; font-weight: 700; }
</style></head><body><div class="card">
  <div class="rules"></div><div class="red"></div>
  <div class="print" style="left:34px; top:42px">RECIPE FOR</div>
  <div class="print" style="left:720px; top:42px">FROM THE KITCHEN OF</div>
  <div class="w title" style="left:180px; top:22px; transform: rotate(-1.2deg)">Cinn. Crumb Coffee Cake</div>
  <div class="w title" style="left:945px; top:58px; font-size:54px; transform: rotate(-2deg)">Rosa</div>
  ${LINES.map(([t, x, r], i) => {
    const row = i < 8 ? Math.floor(i / 2) : i - 4;
    return `<div class="w" style="left:${40 + x}px; top:${126 + row * 48}px; transform: rotate(${r}deg)">${t}</div>`;
  }).join('')}
</div></body></html>`;

const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await mkdir(join(root, 'samples'), { recursive: true });
await page.screenshot({ path: join(root, 'samples/rosa-card.jpg'), type: 'jpeg', quality: 78 });
await browser.close();
console.log('samples/rosa-card.jpg written');
