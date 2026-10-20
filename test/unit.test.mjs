// The logic, without a browser:  node --test test/unit.test.mjs
// Ingredient parsing, kitchen fractions, scaling, unit conversion, timers, steps, pasted recipes, merging and links.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { readFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLine, present, lineText, kitchen, bestUS, bestUSMass, headingOf, sections, plural, singular } from '../js/ingredients.js';
import { densityFor, DENSITIES } from '../js/density.js';
import { findTimes, convertStep, stepIngredients, splitRecipe, stepHasAmounts, clock, formatRange } from '../js/text.js';
import { cleanRecipe, cleanBox, mergeBoxes, canon, live, matches, possessive, yieldOf, yieldText, fingerprint } from '../js/recipe.js';
import { pack, unpack, readIncoming, forLink, LINK_RX } from '../js/share.js';
import { dataURLToBlob } from '../js/photos.js';
import { SAMPLES } from '../js/samples.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const show = (line, opts) => lineText(present(parseLine(line), opts));
const pick = p => Object.fromEntries(Object.entries(p).filter(([k, v]) => v !== null && v !== '' && k !== 'extra'));

// ---------- reading ingredient lines ----------
test('amounts: whole numbers, fractions, mixed numbers and decimals', () => {
  assert.deepEqual(pick(parseLine('2 cups flour')), { q: 2, u: 'cup', item: 'flour' });
  assert.equal(parseLine('1/2 tsp. salt').q, 0.5);
  assert.equal(parseLine('1 1/2 c. flour').q, 1.5);
  assert.equal(parseLine('1-1/2 cups milk').q, 1.5, '1-1/2 is one and a half, not a range');
  assert.equal(parseLine('1.5 cups water').q, 1.5);
  assert.equal(parseLine('1,5 dl cream').q, 1.5);
  assert.equal(parseLine('.5 cup oil').q, 0.5);
});

test('unicode fractions, with or without a space', () => {
  assert.equal(parseLine('½ cup sugar').q, 0.5);
  assert.equal(parseLine('1½ tsp baking powder').q, 1.5);
  assert.equal(parseLine('1 ½ tsp baking powder').q, 1.5);
  assert.equal(parseLine('⅓ c. oleo').q, 1 / 3);
  assert.equal(parseLine('2⅔ cups oats').q, 2 + 2 / 3);
  assert.equal(parseLine('1⁄4 cup honey').q, 0.25, 'fraction slash');
  assert.equal(parseLine('⅛ tsp nutmeg').q, 0.125);
});

test('ranges', () => {
  assert.deepEqual([parseLine('2–3 cloves garlic').q, parseLine('2–3 cloves garlic').q2], [2, 3]);
  assert.deepEqual([parseLine('2-3 tbsp lemon juice').q, parseLine('2-3 tbsp lemon juice').q2], [2, 3]);
  assert.deepEqual([parseLine('2 to 3 tbsp milk').q, parseLine('2 to 3 tbsp milk').q2], [2, 3]);
  assert.deepEqual([parseLine('3 or 4 apples').q, parseLine('3 or 4 apples').q2], [3, 4]);
  assert.deepEqual([parseLine('1/2–3/4 cup sugar').q, parseLine('1/2–3/4 cup sugar').q2], [0.5, 0.75]);
  assert.deepEqual([parseLine('3/4 to 1 cup milk').q, parseLine('3/4 to 1 cup milk').q2], [0.75, 1]);
  assert.equal(show('1/2-3/4 cup sugar'), '½–¾ cup sugar', 'a range up to one is singular');
  assert.equal(show('2–3 cloves garlic, minced'), '2–3 cloves garlic, minced');
});

test('cans and packages with their size', () => {
  const can = parseLine('1 (15 oz) can kidney beans, drained');
  assert.deepEqual(pick(can), { q: 1, u: 'can', size: { q: 15, u: 'oz' }, item: 'kidney beans', note: 'drained' });
  assert.deepEqual(parseLine('1 (15-ounce) can black beans').size, { q: 15, u: 'oz' });
  assert.deepEqual(pick(parseLine('2 8-ounce packages cream cheese, softened')), { q: 2, u: 'package', size: { q: 8, u: 'oz' }, item: 'cream cheese', note: 'softened' });
  assert.deepEqual(pick(parseLine('1 can (10 3/4 oz) cream of mushroom soup')), { q: 1, u: 'can', size: { q: 10.75, u: 'oz' }, item: 'cream of mushroom soup' });
  assert.deepEqual(pick(parseLine('12 oz. pkg. chocolate chips')), { q: 1, u: 'package', size: { q: 12, u: 'oz' }, item: 'chocolate chips' });
  assert.equal(show('1 (15 oz) can kidney beans'), '1 can kidney beans (15 oz)');
  assert.equal(show('2 (15 oz) cans kidney beans, drained'), '2 cans kidney beans (15 oz each), drained');
  assert.equal(show('1 (15 oz) can kidney beans', { factor: 2 }), '2 cans kidney beans (15 oz each)', 'the can size stays the same');
  assert.equal(show('1 (15 oz) can kidney beans', { mode: 'metric' }), '1 can kidney beans (425 g)');
});

test('no amount: to taste, as needed, and plain words', () => {
  assert.deepEqual(pick(parseLine('salt to taste')), { item: 'salt', note: 'to taste' });
  assert.deepEqual(pick(parseLine('Salt and pepper, to taste')), { item: 'Salt and pepper', note: 'to taste' });
  assert.equal(parseLine('A little milk').q, null, '"a little" is not an amount');
  assert.equal(parseLine('a few sprigs thyme').q, null);
  assert.equal(parseLine('Oil for frying').q, null);
  assert.equal(show('salt to taste', { factor: 3, mode: 'metric' }), 'salt, to taste');
});

test('old-card abbreviations and case', () => {
  assert.equal(parseLine('2 T. butter').u, 'tbsp', 'capital T is a tablespoon');
  assert.equal(parseLine('1 t. vanilla').u, 'tsp', 'small t is a teaspoon');
  assert.equal(parseLine('1 c. sugar').u, 'cup');
  assert.equal(parseLine('1/2 C flour').u, 'cup');
  assert.equal(parseLine('1 tbl shortening').u, 'tbsp');
  assert.equal(parseLine('1# hamburger').u, 'lb');
  assert.equal(parseLine('4 lbs. potatoes').u, 'lb');
  assert.equal(parseLine('500g flour').u, 'g');
  assert.equal(parseLine('2 sq. unsweetened chocolate').u, 'square');
  assert.equal(parseLine('3 tomatoes').u, '', 't must not eat the start of "tomatoes"');
  assert.equal(parseLine('2 tea bags').u, '');
  assert.equal(parseLine('2 large eggs').u, '');
});

test('words for amounts, modifiers and "juice of"', () => {
  assert.equal(parseLine('one and a half cups water').q, 1.5);
  assert.equal(parseLine('half a cup of milk').q, 0.5);
  assert.deepEqual(pick(parseLine('a scant cup of sugar')), { q: 1, u: 'cup', mod: 'scant', item: 'sugar' });
  assert.equal(show('a scant cup of sugar'), '1 scant cup sugar');
  assert.equal(show('about 2 cups flour'), 'about 2 cups flour');
  assert.equal(show('1 heaping tbsp cocoa'), '1 heaping tbsp cocoa');
  assert.equal(parseLine('an egg').q, 1);
  assert.deepEqual(pick(parseLine('Juice of 1 lemon')), { q: 1, pre: 'Juice of', item: 'lemon' });
  assert.equal(show('Zest of 1 orange', { factor: 2 }), 'Zest of 2 oranges');
  assert.deepEqual(pick(parseLine('Pinch of salt')), { q: 1, u: 'pinch', item: 'salt' });
});

test('compound amounts and alternatives in brackets', () => {
  const p = parseLine('1 cup plus 2 tablespoons flour');
  assert.ok(Math.abs(p.q - 1.125) < 1e-6);
  assert.equal(show('1 cup plus 2 tablespoons flour'), '1 cup + 2 tbsp flour');
  assert.equal(show('1 cup + 2 T. flour'), '1 cup + 2 tbsp flour');
  assert.ok(Math.abs(parseLine('1 lb 4 oz ground beef').q - 1.25) < 1e-9);
  assert.deepEqual(parseLine('1 cup (2 sticks) butter, softened').alt, { q: 2, q2: null, u: 'stick' });
  assert.equal(show('1 cup (2 sticks) butter, softened', { factor: 2 }), '2 cups (4 sticks) butter, softened');
  assert.equal(show('1 onion, chopped (about 1 cup)'), '1 onion, chopped (about 1 cup)');
  assert.equal(parseLine('2 cups chopped walnuts (optional)').note, 'optional');
});

test('a second amount after the item scales and converts with the line', () => {
  const x2 = { factor: 2 }, m = { mode: 'metric' };
  assert.equal(show('1/2 cup butter (1 stick), melted'), '½ cup butter (1 stick), melted', 'it stays where the card put it');
  assert.equal(show('1/2 cup butter (1 stick), melted', x2), '1 cup butter (2 sticks), melted');
  assert.equal(show('1/2 cup butter (1 stick), melted', { factor: 0.5 }), '¼ cup butter (½ stick), melted');
  // At the card's own amounts its other amount is the card's figure, not rounded to the nearest third or quarter.
  assert.equal(show('6 tbsp butter (3/8 cup)'), '6 tbsp butter (⅜ cup)');
  assert.equal(show('2 T. flour (1/8 cup)'), '2 tbsp flour (⅛ cup)');
  assert.equal(show('2 T. (1/8 cup) flour'), '2 tbsp (⅛ cup) flour');
  // Scaled, it goes when it would only repeat the first amount, or when its unit's fractions can't say it closely:
  // half of ⅛ cup is a tablespoon, not the ¼ cup that rounding gives.
  assert.equal(show('6 tbsp butter (3/8 cup)', x2), '¾ cup butter');
  assert.equal(show('2 T. flour (1/8 cup)', { factor: 0.5 }), '1 tbsp flour');
  assert.equal(show('2 T. (1/8 cup) flour', { factor: 0.5 }), '1 tbsp flour');
  assert.equal(show('6 tbsp butter (3/8 cup)', { factor: 0.5 }), '3 tbsp butter');
  assert.equal(show('1 tbsp sugar (1/16 cup)', x2), '2 tbsp sugar');
  assert.equal(show('1 qt milk (4 cups)', x2), '8 cups milk');
  assert.equal(show('1/2 cup butter (1 stick), melted', { factor: 0.25 }), '2 tbsp butter (¼ stick), melted');
  assert.equal(show('1 tsp salt (6 g)', { factor: 0.25 }), '¼ tsp salt (1.5 g)');
  assert.equal(show('1 cup milk (240 ml)', x2), '2 cups milk (480 ml)');
  assert.equal(show('1 cup milk (240 ml)', m), '235 ml milk', 'converted, so the card’s other amount drops out');
  assert.equal(show('2 1/4 cups all-purpose flour (280g)', x2), '4½ cups all-purpose flour (560 g)');
  assert.equal(show('2 1/4 cups all-purpose flour (280g)', m), '281 g all-purpose flour');
  assert.equal(show('2 cups flour (250g), sifted', x2), '4 cups flour (500 g), sifted');
  assert.equal(show('200g/7oz plain flour', x2), '400 g (14 oz) plain flour');
  assert.equal(show('200g/7oz plain flour', { mode: 'us' }), '1⅔ cups plain flour');
  assert.deepEqual(parseLine('200g/7oz plain flour').alt, { q: 7, q2: null, u: 'oz' });
  assert.deepEqual(pick(parseLine('1 can crushed tomatoes (28 oz)')), { q: 1, u: 'can', size: { q: 28, u: 'oz' }, item: 'crushed tomatoes' });
  assert.equal(show('1 can crushed tomatoes (28 oz)', m), '1 can crushed tomatoes (795 g)', 'the same as “1 can (28 oz) crushed tomatoes”');
  assert.equal(show('2 cans tomatoes (15 oz each)', x2), '4 cans tomatoes (15 oz each)');
  // Brackets that aren't only an amount stay notes.
  assert.equal(parseLine('2 eggs (50 g each)').note, '50 g each', 'each egg, so not scaled');
  assert.equal(parseLine('Butter (1 stick)').note, '1 stick', 'no amount on the line to go with');
  assert.equal(show('1 (15 oz) can tomatoes (undrained)'), '1 can tomatoes (15 oz), undrained');
});

test('section headings', () => {
  assert.equal(headingOf('For the glaze:'), 'For the glaze');
  assert.equal(headingOf('For the crumb topping'), 'For the crumb topping');
  assert.equal(headingOf('## Filling'), 'Filling');
  assert.equal(headingOf('**Crust**'), 'Crust');
  assert.equal(headingOf('Topping:'), 'Topping');
  assert.equal(headingOf('2 cups flour'), null);
  assert.equal(headingOf('Salt and pepper, to taste'), null);
  const s = sections(['1 cup flour', 'For the glaze:', '1 cup sugar', '2 tbsp milk']);
  assert.deepEqual(s.map(x => [x.h, x.lines.length]), [['', 1], ['For the glaze', 2]]);
});

// ---------- writing amounts ----------
test('kitchen fractions', () => {
  assert.equal(kitchen(0.5), '½');
  assert.equal(kitchen(1 / 3), '⅓');
  assert.equal(kitchen(1.5), '1½');
  assert.equal(kitchen(2 / 3), '⅔');
  assert.equal(kitchen(0.125), '⅛');
  assert.equal(kitchen(1.75), '1¾');
  assert.equal(kitchen(3), '3');
  assert.equal(kitchen(0.3, [2, 4]), '¼');
  assert.equal(show('1/3 c. oleo'), '⅓ cup oleo');
  assert.equal(show('3/8 cup water'), '⅜ cup water', 'as written keeps the card’s own fraction');
  assert.equal(show('0.6 cup milk'), '0.6 cup milk', 'and its decimal when it isn’t a kitchen fraction');
});

test('US volumes in the easiest measure', () => {
  const us = ml => bestUS(ml).map(p => `${p.q == null ? p.text : kitchen(p.q, [2, 3, 4, 8])} ${p.u}`).join(' + ');
  const cup = 236.588, tbsp = cup / 16, tsp = tbsp / 3;
  assert.equal(us(16 * tbsp), '1 cup');
  assert.equal(us(3 * tsp), '1 tbsp');
  assert.equal(us(4 * tbsp), '¼ cup');
  assert.equal(us(6 * tbsp), '6 tbsp');
  assert.equal(us(1.125 * cup), '1 cup + 2 tbsp');
  assert.equal(us(cup / 6), '2 tbsp + 2 tsp', 'half of ⅓ cup');
  assert.equal(us(10 * tbsp), '½ cup + 2 tbsp');
  assert.equal(us(1.5 * tsp), '1½ tsp');
  assert.equal(us(4.5 * tsp), '1½ tbsp');
  assert.equal(us(5 * tsp), '1 tbsp + 2 tsp');
  assert.equal(us(tsp / 16), 'a pinch pinch');
  assert.equal(bestUSMass(453.6)[0].u, 'lb');
  assert.deepEqual(bestUSMass(500).map(p => [p.q, p.u]), [[1, 'lb'], [2, 'oz']]);
  assert.deepEqual(bestUSMass(200).map(p => [p.q, p.u]), [[7, 'oz']]);
});

// ---------- scaling ----------
test('scaling re-expresses amounts sensibly', () => {
  assert.equal(show('16 tbsp butter', { factor: 1 }), '16 tbsp butter', 'unscaled, as written');
  assert.equal(show('8 tbsp butter', { factor: 2 }), '1 cup butter');
  assert.equal(show('1 tsp sugar', { factor: 3 }), '1 tbsp sugar');
  assert.equal(show('1/3 cup sugar', { factor: 0.5 }), '2 tbsp + 2 tsp sugar');
  assert.equal(show('3/4 cup milk', { factor: 0.5 }), '6 tbsp milk');
  assert.equal(show('2 cups flour', { factor: 1.5 }), '3 cups flour');
  assert.equal(show('1 1/2 cups flour', { factor: 2 / 3 }), '1 cup flour');
  assert.equal(show('1 stick butter', { factor: 1.5 }), '1½ sticks butter');
  assert.equal(show('1 stick butter', { factor: 1 / 3 }), '2 tbsp + 2 tsp butter', 'a third of a stick is measured in spoons');
  assert.equal(show('1/8 tsp nutmeg', { factor: 0.5 }), 'a pinch of nutmeg');
  assert.equal(show('8 oz cream cheese', { factor: 2 }), '1 lb cream cheese');
  assert.equal(show('1 lb ground beef', { factor: 0.5 }), '8 oz ground beef');
  assert.equal(show('250 g flour', { factor: 1.5 }), '375 g flour');
  assert.equal(show('600 g flour', { factor: 2 }), '1.2 kg flour');
  assert.equal(show('2–3 cloves garlic', { factor: 2 }), '4–6 cloves garlic');
});

test('a huge amount scales without a long wait', () => {
  const t0 = performance.now();
  assert.equal(show('20000 cups water', { factor: 1.5 }), '30000 cups water');
  assert.ok(performance.now() - t0 < 1000, `took ${Math.round(performance.now() - t0)} ms`);
});

test('things counted without a unit become plural or singular', () => {
  assert.equal(show('1 onion', { factor: 2 }), '2 onions');
  assert.equal(show('1 bay leaf', { factor: 2 }), '2 bay leaves');
  assert.equal(show('3 eggs', { factor: 1 / 3 }), '1 egg');
  assert.equal(show('4 medium potatoes', { factor: 0.25 }), '1 medium potato');
  assert.equal(show('2 cherries', { factor: 0.5 }), '1 cherry');
  assert.equal(show('3 eggs', { factor: 0.5 }), '1½ eggs, beat the last egg and use half of it');
  assert.equal(plural('peach'), 'peaches');
  assert.equal(singular('tomatoes'), 'tomato');
});

test('the card’s own word for a count stays unless scaling takes it across one', () => {
  for (const line of ['8 jumbo shrimp', '2 celery', '2 fish', '2 garlic', '4 sheep', '6 Eier', '4 Kartoffeln', '6 Äpfel', '3 uova'])
    assert.equal(show(line), line, `${line} as written`);
  assert.equal(show('8 jumbo shrimp', { factor: 2 }), '16 jumbo shrimp');
  assert.equal(show('6 Eier', { factor: 0.5 }), '3 Eier');
  assert.equal(show('1 egg', { factor: 2 }), '2 eggs');
  assert.equal(show('2 eggs', { factor: 0.5 }), '1 egg');
  assert.equal(show('2–3 apples', { factor: 0.5 }), '1–1½ apples', 'the top of a range decides');
});

test('a second count after "plus" scales with the line', () => {
  for (const line of ['2 large eggs plus 1 yolk', '3 eggs + 1 egg white', '2 eggs, plus 1 yolk', '2 eggs plus one yolk', '4 eggs plus 2 yolks, at room temperature'])
    assert.equal(show(line), line, `${line} as written`);
  assert.equal(show('2 large eggs plus 1 yolk', { factor: 2 }), '4 large eggs plus 2 yolks');
  assert.equal(show('2 large eggs plus 1 yolk', { factor: 0.5 }), '1 large egg plus ½ yolk');
  assert.equal(show('2 eggs plus 2 egg yolks', { factor: 0.5 }), '1 egg plus 1 egg yolk');
  assert.equal(show('3 eggs + 1 egg white', { factor: 2 }), '6 eggs + 2 egg whites');
  assert.equal(show('2 eggs, plus 1 yolk', { factor: 2 }), '4 eggs, plus 2 yolks');
  assert.equal(show('2 eggs plus an extra yolk', { factor: 2 }), '4 eggs plus 2 extra yolks');
  assert.equal(show('4 eggs plus 2 yolks, at room temperature', { factor: 0.5 }), '2 eggs plus 1 yolk, at room temperature');
  assert.equal(show('3 eggs plus 1 or 2 yolks', { factor: 2 }), '6 eggs plus 2–4 yolks');
  // Only the thing counted changes number, never the words about what it's for.
  assert.equal(show('1 egg plus 1 for brushing', { factor: 2 }), '2 eggs plus 2 for brushing');
  assert.equal(show('2 eggs, plus 1 more if needed', { factor: 2 }), '4 eggs, plus 2 more if needed');
  assert.equal(show('3 eggs, plus 1 for the egg wash', { factor: 2 }), '6 eggs, plus 2 for the egg wash');
  assert.equal(show('2 eggs plus 1 to brush the top', { factor: 2 }), '4 eggs plus 2 to brush the top');
  assert.equal(show('2 eggs, plus 1 beaten egg for glazing', { factor: 2 }), '4 eggs, plus 2 beaten eggs for glazing');
  assert.equal(show('4 eggs, plus 2 hard-boiled eggs to garnish', { factor: 0.5 }), '2 eggs, plus 1 hard-boiled egg to garnish');
  assert.equal(show('10 strawberries plus 6 more to decorate', { factor: 0.5 }), '5 strawberries plus 3 more to decorate');
  assert.equal(show('4 eggs plus 1 more', { factor: 2 }), '8 eggs plus 2 more');
  assert.equal(show('4 eggs plus 2 more yolks', { factor: 0.5 }), '2 eggs plus 1 more yolk');
  // "I have 3 large eggs" scales by the eggs.
  const p = parseLine('2 large eggs plus 1 yolk');
  assert.equal(p.item, 'large eggs');
  assert.equal(p.plus.q, 1);
  // What it can't read as a count stays as the card has it.
  assert.match(show('1 egg plus 1 tablespoon water', { factor: 2 }), / plus 1 tablespoon water$/);
  assert.match(show('2 eggs plus enough milk to make 1 cup', { factor: 2 }), / plus enough milk to make 1 cup$/);
  assert.match(show('2 eggs plus a little milk', { factor: 2 }), / plus a little milk$/);
  // A step about the yolk still uses that line.
  assert.deepEqual(stepIngredients(['2 large eggs plus 1 yolk', '1 cup sugar'], ['Beat the yolk into the sugar.']), [[0, 1]]);
});

// ---------- converting ----------
test('USDA cup weights for baking ingredients', () => {
  assert.equal(densityFor('all-purpose flour').g, 125);
  assert.equal(densityFor('flour').g, 125);
  assert.equal(densityFor('bread flour').g, 137);
  assert.equal(densityFor('almond flour'), null, 'no USDA cup weight, so no guess');
  assert.equal(densityFor('sugar').g, 200);
  assert.equal(densityFor('light brown sugar').g, 220);
  assert.equal(densityFor("confectioners' sugar").g, 120);
  assert.equal(densityFor("sifted confectioners' sugar").g, 100, 'sifted before measuring weighs less');
  assert.equal(densityFor('unsalted butter').g, 227);
  assert.equal(densityFor('peanut butter').g, 258);
  assert.equal(densityFor('buttermilk'), null);
  assert.equal(densityFor('oleo').g, 227);
  assert.equal(densityFor('uncooked long-grain rice').g, 185);
  assert.equal(densityFor('rice vinegar'), null);
  assert.equal(densityFor('old-fashioned rolled oats').g, 81);
  assert.equal(densityFor('unsweetened cocoa powder').g, 86);
  assert.equal(densityFor('honey').g, 339);
  assert.equal(densityFor('sugar snap peas'), null);
  assert.equal(densityFor('milk'), null, 'liquids go to millilitres');
  for (const d of DENSITIES) assert.match(d.ndb, /^\d{5}$/, `${d.name} has an NDB number`);
});

test('US to metric', () => {
  const m = { mode: 'metric' };
  assert.equal(show('2 cups all-purpose flour', m), '250 g all-purpose flour');
  assert.equal(show('1 cup sugar', m), '200 g sugar');
  assert.equal(show('1 cup brown sugar, packed', m), '220 g brown sugar, packed');
  assert.equal(show('1/2 cup butter', m), '114 g butter');
  assert.equal(show('1 stick butter', m), '113 g butter');
  assert.equal(show('2 tbsp butter', m), '28 g butter');
  assert.equal(show('1 cup milk', m), '235 ml milk', 'no weight for milk: millilitres');
  assert.equal(show('1 tsp vanilla', m), '1 tsp vanilla', 'teaspoons stay spoons');
  assert.equal(show('1 tsp baking soda', m), '1 tsp baking soda');
  assert.equal(show('3 tsp sugar', m), '3 tsp sugar');
  assert.equal(show('8 tbsp oil', m), '120 ml oil');
  assert.equal(show('1 lb ground beef', m), '454 g ground beef');
  assert.equal(show('2 sq. unsweetened chocolate', m), '57 g unsweetened chocolate');
  assert.equal(show('1 cup (2 sticks) butter', m), '227 g butter', 'the stick count drops out');
  assert.equal(show('2–3 tbsp lemon juice', m), '2–3 tbsp lemon juice');
  assert.ok(present(parseLine('2 cups flour'), m).conv.source.includes('USDA'));
});

test('metric to US', () => {
  const u = { mode: 'us' };
  assert.equal(show('250 g all-purpose flour', u), '2 cups all-purpose flour');
  assert.equal(show('200 g sugar', u), '1 cup sugar');
  assert.equal(show('150 g sugar', u), '¾ cup sugar');
  assert.equal(show('250 ml milk', u), '1 cup milk');
  assert.equal(show('500 g ground beef', u), '1 lb + 2 oz ground beef');
  assert.equal(show('200 g dark chocolate', u), '7 oz dark chocolate');
  assert.equal(show('1 cup sugar', u), '1 cup sugar', 'US stays as written');
  assert.equal(show('1 packet (7 g) dry yeast', u), '1 packet dry yeast (¼ oz)', 'not (0 oz)');
  assert.equal(show('1 packet (8 g) vanilla sugar', u), '1 packet vanilla sugar (¼ oz)', 'not (½ oz)');
  assert.equal(show('1 sachet (5 ml) vanilla extract', u), '1 packet vanilla extract (¼ fl oz)');
  assert.equal(show('1 can (400 g) tomatoes', u), '1 can tomatoes (14 oz)');
});

// ---------- steps ----------
test('times in steps become timers', () => {
  const t = s => findTimes(s).map(x => [x.text, x.secs, x.secs2, x.label]);
  assert.deepEqual(t('Bake 25–30 minutes, until golden.'), [['25–30 minutes', 1500, 1800, 'Bake']]);
  assert.deepEqual(t('Cook 10 to 12 minutes or until done.'), [['10 to 12 minutes', 600, 720, 'Cook']]);
  assert.deepEqual(t('Cover and let rise for 1 hour.'), [['1 hour', 3600, null, 'Let rise']]);
  assert.deepEqual(t('Simmer 1½ hours.'), [['1½ hours', 5400, null, 'Simmer']]);
  assert.deepEqual(t('Simmer for 1 hr. 15 min.'), [['1 hr. 15 min.', 4500, null, 'Simmer']]);
  assert.deepEqual(t('Roast for 1 hour and 30 minutes.'), [['1 hour and 30 minutes', 5400, null, 'Roast']]);
  assert.deepEqual(t('Boil for half an hour.'), [['half an hour', 1800, null, 'Boil']]);
  assert.deepEqual(t('Chill at least 2 hours or overnight.'), [['2 hours', 7200, null, 'Chill']]);
  assert.deepEqual(t('Beat 30 seconds.'), [['30 seconds', 30, null, 'Beat']]);
  assert.deepEqual(t('Heat the oven to 350°F.'), []);
  assert.equal(formatRange(1500, 1800), '25–30 min');
  assert.equal(clock(65), '1:05');
  assert.equal(clock(3725), '1:02:05');
});

test('times written with fractions and words are read whole', () => {
  const t = s => findTimes(s).map(x => [x.text, x.secs, x.secs2]);
  assert.deepEqual(t('Let it rest 1/2 hour before slicing.'), [['1/2 hour', 1800, null]], 'not 2 hours from the digit after the slash');
  assert.deepEqual(t('Let rise 1/2 hour'), [['1/2 hour', 1800, null]]);
  assert.deepEqual(t('Bake the rolls 3/4 hour.'), [['3/4 hour', 2700, null]]);
  assert.deepEqual(t('Cook 1/4 hour'), [['1/4 hour', 900, null]]);
  assert.deepEqual(t('Let rest ½ hour.'), [['½ hour', 1800, null]]);
  assert.deepEqual(t('Bake 1-1/2 hours'), [['1-1/2 hours', 5400, null]], '1-1/2 is one and a half, not a range');
  assert.deepEqual(t('Simmer 2-1/2 hours'), [['2-1/2 hours', 9000, null]]);
  assert.deepEqual(t('Bake 1-1/4 hours'), [['1-1/4 hours', 4500, null]]);
  assert.deepEqual(t('Bake 1 1/2 hours'), [['1 1/2 hours', 5400, null]]);
  assert.deepEqual(t('Bake 1 and 1/2 hours'), [['1 and 1/2 hours', 5400, null]]);
  assert.deepEqual(t('Bake one and a half hours'), [['one and a half hours', 5400, null]]);
  assert.deepEqual(t('Bake an hour and a half'), [['an hour and a half', 5400, null]]);
  assert.deepEqual(t('Bake 1-1/2 to 2 hours'), [['1-1/2 to 2 hours', 5400, 7200]]);
  // Ranges still read as ranges.
  assert.deepEqual(t('Bake 25–30 minutes'), [['25–30 minutes', 1500, 1800]]);
  assert.deepEqual(t('Bake 1-2 hours'), [['1-2 hours', 3600, 7200]]);
  assert.deepEqual(t('Bake 1/2-1 hour'), [['1/2-1 hour', 1800, 3600]]);
  assert.deepEqual(t('Bake 1 1/2-2 hours'), [['1 1/2-2 hours', 5400, 7200]]);
  assert.deepEqual(t('Bake forty-five minutes'), [['forty-five minutes', 2700, null]]);
  assert.deepEqual(t('Cut into 1/2-inch slices and bake 20 minutes.'), [['20 minutes', 1200, null]]);
});

test('a range whose ends have their own units is one timer', () => {
  const t = s => findTimes(s).map(x => [x.text, x.secs, x.secs2]);
  assert.deepEqual(t('Bake for 55 minutes to 1 hour.'), [['55 minutes to 1 hour', 3300, 3600]]);
  assert.deepEqual(t('Bake 45 minutes to 1 hour, until a straw comes out clean.'), [['45 minutes to 1 hour', 2700, 3600]]);
  assert.deepEqual(t('Simmer 1 hour to 1 hour 30 minutes.'), [['1 hour to 1 hour 30 minutes', 3600, 5400]]);
  assert.equal(formatRange(3300, 3600), '55 min to 1 hr');
  assert.deepEqual(t('Cook 5 minutes, then 10 minutes more.'), [['5 minutes', 300, null], ['10 minutes', 600, null]], 'two times in a row stay two');
});

test('oven temperatures and pan sizes in the chosen units', () => {
  const m = s => convertStep(s, 'metric').map(x => (x.was ? `[${x.text}]` : x.text)).join('');
  const u = s => convertStep(s, 'us').map(x => (x.was ? `[${x.text}]` : x.text)).join('');
  assert.equal(m('Preheat the oven to 350°F. Grease a 9x13-inch pan.'), 'Preheat the oven to [180°C]. Grease a [23 × 33 cm] pan.');
  assert.equal(m('Bake at 375 for 10 min.'), 'Bake at [190°C] for 10 min.');
  assert.equal(m('Moderate oven (350°).'), 'Moderate oven ([180°C]).');
  assert.equal(m('roll into a log 1½ inches across and slice ¼ inch thick'), 'roll into a log [4 cm] across and slice [0.6 cm] thick');
  assert.equal(u('Heat the oven to 180°C. Butter a 26 cm springform pan.'), 'Heat the oven to [350°F]. Butter a [10 inch] springform pan.');
  assert.equal(m('Bake 25 minutes.'), 'Bake 25 minutes.');
  assert.equal(convertStep('Bake at 350°F', 'as').length, 1, 'as written leaves it alone');
  assert.ok(stepHasAmounts('Pour about 1/3 cup of batter per pancake.'));
  assert.ok(!stepHasAmounts('Bake 25 minutes.'));
});

test('an oven temperature range converts at both ends', () => {
  const m = s => convertStep(s, 'metric').map(x => (x.was ? `[${x.text}]` : x.text)).join('');
  const u = s => convertStep(s, 'us').map(x => (x.was ? `[${x.text}]` : x.text)).join('');
  // The skill tells Claude to write old cards' ovens this way (references/old-cards.md, Ovens).
  const want = {
    'very slow oven (250–275°F)': 'very slow oven ([120–140°C])',
    'slow oven (300–325°F)': 'slow oven ([150–160°C])',
    'moderate oven (350°F)': 'moderate oven ([180°C])',
    'quick oven (375–400°F)': 'quick oven ([190–200°C])',
    'hot oven (400–450°F)': 'hot oven ([200–230°C])',
    'very hot oven (450–500°F)': 'very hot oven ([230–260°C])',
  };
  const md = readFileSync(join(root, 'skill/from-scratch-cards/references/old-cards.md'), 'utf8').split('## Ovens')[1].split('\n## ')[0];
  const rows = [...md.matchAll(/^\| [^|]+ \| `([^`]+)`/gm)].map(r => r[1]);
  assert.ok(rows.length >= 6, 'the Ovens table is there');
  for (const row of rows) assert.equal(m(row), want[row], `old-cards.md: ${row}`);
  assert.equal(m('Bake in a slow oven (300–325°F) 1 hour.'), 'Bake in a slow oven ([150–160°C]) 1 hour.');
  assert.equal(m('Heat the oven to 300 to 325 degrees F.'), 'Heat the oven to [150–160°C].');
  assert.equal(m('Bake at 350-375 for 30 min.'), 'Bake at [180–190°C] for 30 min.');
  assert.equal(u('Bake at 180-190°C.'), 'Bake at [350–375°F].');
  assert.equal(convertStep('slow oven (300–325°F)', 'metric').find(x => x.was).was, '300–325°F', 'the card’s words for both ends');
});

test('“a” or “an” before a converted size goes with the new number', () => {
  const m = s => convertStep(s, 'metric').map(x => (x.was ? `[${x.text}]` : x.text)).join('');
  const u = s => convertStep(s, 'us').map(x => (x.was ? `[${x.text}]` : x.text)).join('');
  assert.equal(m('Heat the oven to 350°F. Grease an 8-inch square pan.'), 'Heat the oven to [180°C]. Grease a [20 cm] square pan.');
  assert.equal(m('An 8-inch pan works too.'), 'A [20 cm] pan works too.');
  assert.equal(m('Grease a 9x13-inch pan.'), 'Grease a [23 × 33 cm] pan.');
  assert.equal(u('Butter a 20 cm tin.'), 'Butter an [8 inch] tin.');
  assert.equal(u('Use an 18 cm tin.'), 'Use a [7 inch] tin.');
  assert.equal(u('Line a 28 x 18 cm tin.'), 'Line an [11 × 7 inch] tin.');
});

test('a temperature already given in both units stays as it is', () => {
  const m = s => convertStep(s, 'metric').map(x => (x.was ? `[${x.text}]` : x.text)).join('');
  const u = s => convertStep(s, 'us').map(x => (x.was ? `[${x.text}]` : x.text)).join('');
  for (const s of ['Preheat the oven to 350°F (175°C).', 'Preheat to 350°F/180°C.', 'Heat to 350 degrees F (175 degrees C).', 'Bake at 180°C (350°F).', 'Preheat to 350 (180°C).', 'slow oven (300–325°F / 150–160°C)']) {
    assert.equal(m(s), s, `grams: ${s}`);
    assert.equal(u(s), s, `cups: ${s}`);
  }
  assert.equal(m('Bake at 350°F for 10 minutes, then at 400°F.'), 'Bake at [180°C] for 10 minutes, then at [200°C].', 'two of the same unit both convert');
});

test('each step lists the ingredients it uses', () => {
  const rosa = SAMPLES.find(r => r.id === 'sample-rosa-coffee-cake');
  const uses = stepIngredients(rosa.ingredients, rosa.steps).map(ix => ix.map(i => rosa.ingredients[i]));
  assert.deepEqual(uses[1], ['1 1/2 cups all-purpose flour', '3/4 cup sugar', '2 tsp baking powder', '1/2 tsp salt']);
  assert.ok(!uses[2].includes('1 1/2 cups all-purpose flour'), '"until no flour shows" is not a use');
  assert.deepEqual(uses[3], ['1/2 cup brown sugar, packed', '1/3 cup all-purpose flour', '2 tsp cinnamon', '3 tbsp cold butter', '1/2 cup chopped walnuts (optional)'], 'the step names the topping, so it gets the topping’s flour and butter');
  const walt = SAMPLES.find(r => r.id === 'sample-walt-chili');
  const w = stepIngredients(walt.ingredients, walt.steps).map(ix => ix.map(i => walt.ingredients[i]));
  assert.deepEqual(w[3], ['1 square unsweetened chocolate', 'Salt and pepper, to taste'], '"salt and pepper" is not the bell pepper');
  const june = SAMPLES.find(r => r.id === 'sample-june-lemon-cookies');
  const j = stepIngredients(june.ingredients, june.steps);
  assert.deepEqual(j[5].map(i => june.ingredients[i]), ["1 cup confectioners' sugar", '2–3 tbsp lemon juice']);
  assert.ok(j[5].every(i => i > 7), 'the glaze step uses the glaze’s sugar');
  assert.ok(j[0].includes(2), 'lemon zest is found from "Zest of 2 lemons"');
});

// ---------- pasting a whole recipe ----------
test('a pasted recipe with headings', () => {
  const r = splitRecipe(`Grandma Rosa's Banana Bread
Serves 8
Prep: 15 min | Bake: 1 hr

Ingredients
3 ripe bananas, mashed
1/3 cup melted butter
3/4 cup sugar
1 1/2 cups all-purpose flour

Directions
1. Preheat the oven to 350°F.
2. Mix the butter into the bananas. Add the flour last
and stir just until combined.
3. Bake 55 to 65 minutes.

Notes
Walnuts are good in it too.`);
  assert.equal(r.title, 'Banana Bread');
  assert.equal(r.from, 'Grandma Rosa');
  assert.equal(r.serves, '8');
  assert.equal(r.prep, '15 min');
  assert.equal(r.cook, '1 hr');
  assert.equal(r.ingredients.length, 4);
  assert.deepEqual(r.steps, ['Preheat the oven to 350°F.', 'Mix the butter into the bananas. Add the flour last and stir just until combined.', 'Bake 55 to 65 minutes.']);
  assert.equal(r.notes, 'Walnuts are good in it too.');
});

test('a pasted card with no headings, and one with sections', () => {
  const r = splitRecipe(`Molasses Crinkles
2 c. flour
2 t. soda
3/4 c. shortening
1 egg
Cream shortening and sugar. Add egg and molasses and beat well.
Chill dough 1 hour. Bake at 375 for 10-12 min.`);
  assert.equal(r.title, 'Molasses Crinkles');
  assert.equal(r.ingredients.length, 4);
  assert.equal(r.steps.length, 2);
  const s = splitRecipe(`Lemon Squares
From the kitchen of Nana Bea
Makes 16 squares

Crust:
1 cup flour
1/2 cup butter

Filling:
2 eggs
1 cup sugar

Press the crust into an 8-inch pan. Bake 20 minutes at 350.
Beat the filling and pour over the hot crust.`);
  assert.equal(s.from, 'Nana Bea');
  assert.equal(s.makes, '16 squares');
  assert.deepEqual(s.ingredients, ['Crust:', '1 cup flour', '1/2 cup butter', 'Filling:', '2 eggs', '1 cup sugar']);
  assert.equal(s.steps.length, 2);
  assert.equal(s.notes, '');
});

test('a pasted recipe with no headings starts its steps at a sentence after a blank line', () => {
  const r = splitRecipe(`Chocolate Chip Cookies

2 1/4 cups flour
1 tsp baking soda
1 cup butter, softened
3/4 cup sugar
2 eggs
2 cups chocolate chips

Preheat oven to 375 degrees.
Combine flour and baking soda in small bowl.
Beat butter and sugar until creamy.
Bake for 9 to 11 minutes or until golden brown.`);
  assert.equal(r.title, 'Chocolate Chip Cookies');
  assert.deepEqual(r.ingredients, ['2 1/4 cups flour', '1 tsp baking soda', '1 cup butter, softened', '3/4 cup sugar', '2 eggs', '2 cups chocolate chips']);
  assert.deepEqual(r.steps, ['Preheat oven to 375 degrees.', 'Combine flour and baking soda in small bowl.', 'Beat butter and sugar until creamy.', 'Bake for 9 to 11 minutes or until golden brown.']);
  // A line after a blank one that still reads as an ingredient stays one, and so does a section heading.
  const s = splitRecipe(`Shortcake

2 cups flour
1/2 cup butter

Salt, to taste.

Topping:
1 quart strawberries

Heat the oven (425°F)
Rub the butter into the flour.`);
  assert.deepEqual(s.ingredients, ['2 cups flour', '1/2 cup butter', 'Salt, to taste.', 'Topping:', '1 quart strawberries']);
  assert.deepEqual(s.steps, ['Heat the oven (425°F)', 'Rub the butter into the flour.']);
  // With a Directions heading, the heading says where the steps start, so a blank line doesn't: "Whipped cream
  // (optional)" and what comes after it stay ingredients, in a list copied with a blank line between every line too.
  const web = splitRecipe(`Strawberry Shortcake

Ingredients

2 cups flour

1/2 cup butter

Whipped cream (optional)

1 quart strawberries

Directions

Heat the oven to 425°F.

Rub the butter into the flour.`);
  assert.deepEqual(web.ingredients, ['2 cups flour', '1/2 cup butter', 'Whipped cream (optional)', '1 quart strawberries']);
  assert.deepEqual(web.steps, ['Heat the oven to 425°F.', 'Rub the butter into the flour.']);
  const served = splitRecipe(`Pancakes
Ingredients
2 cups flour
2 eggs
1 1/2 cups buttermilk

Maple syrup (to serve)
Butter (to serve)

Directions
Mix the dry ingredients.
Cook on a hot griddle.`);
  assert.deepEqual(served.ingredients, ['2 cups flour', '2 eggs', '1 1/2 cups buttermilk', 'Maple syrup (to serve)', 'Butter (to serve)']);
  assert.deepEqual(served.steps, ['Mix the dry ingredients.', 'Cook on a hot griddle.']);
  // With no headings, a blank line ends the list only after two or more ingredients in a row: in a list with a blank
  // line between every line, a blank line says nothing.
  const spaced = splitRecipe(`Pancakes

2 cups flour

2 eggs

1 1/2 cups buttermilk

Maple syrup (to serve)

Mix the flour, eggs and buttermilk together until smooth.
Cook on a hot griddle until bubbles form, then flip.`);
  assert.deepEqual(spaced.ingredients, ['2 cups flour', '2 eggs', '1 1/2 cups buttermilk', 'Maple syrup (to serve)']);
  assert.equal(spaced.steps.length, 2);
});

// ---------- recipes and boxes ----------
test('cleaning a recipe keeps its shape and drops junk', () => {
  const r = cleanRecipe({ title: '  Pie  ', from: 'Nana', ingredients: ['1 cup flour', { h: 'Filling' }, { qty: '2', unit: 'cups', item: 'apples', note: 'sliced' }, '', 7], steps: '1. Mix\n2. Bake', tags: 'Pie, pie, Dessert', rating: 9, t: 5, unsure: 'the oven temperature is smudged' });
  assert.equal(r.title, 'Pie');
  assert.deepEqual(r.ingredients, ['1 cup flour', 'Filling:', '2 cups apples, sliced', '7']);
  assert.deepEqual(r.steps, ['1. Mix', '2. Bake']);
  assert.deepEqual(r.tags, ['Pie', 'Dessert']);
  assert.equal(r.check, 'the oven temperature is smudged');
  assert.equal(r.rating, undefined);
  assert.equal(cleanRecipe({ title: '' }), null);
  assert.deepEqual(cleanRecipe({ id: 'x1', t: 9, del: 1, title: 'gone' }), { id: 'x1', t: 9, del: 1 });
});

test('whose it is, how many it makes, and search', () => {
  assert.equal(possessive('Grandma Rosa'), 'Grandma Rosa’s');
  assert.equal(possessive('Aunt June’s'), 'Aunt June’s');
  assert.deepEqual(yieldOf({ serves: '6–8' }), { n: 6, n2: 8, kind: 'serves', rest: '' });
  assert.equal(yieldText({ serves: '6–8' }, 1.5), 'Serves 9–12');
  assert.equal(yieldText({ makes: 'about 4 dozen' }, 1.5), 'Makes about 6 dozen');
  assert.equal(yieldText({ makes: '24 cookies' }, 0.5), 'Makes 12 cookies');
  assert.equal(yieldText({ serves: '4' }, 0.5), 'Serves 2');
  const walt = cleanRecipe(SAMPLES[1]);
  assert.ok(matches(walt, 'walt chocolate'));
  assert.ok(matches(walt, 'kidney'));
  assert.ok(!matches(walt, 'walt cinnamon'));
});

// A small random box: some recipes, some removed, some the same words under another id.
function randomBox(rnd, ids) {
  const recipes = {};
  for (const id of ids) {
    const x = rnd();
    if (x < 0.3) continue;
    const t = 1 + Math.floor(rnd() * 20);
    if (x < 0.45) recipes[id] = { id, t, del: 1 };
    else recipes[id] = cleanRecipe({ id, t, title: 'Recipe ' + (rnd() < 0.2 ? 'same' : id), ingredients: [`${Math.ceil(rnd() * 3)} cups flour`], from: rnd() < 0.5 ? 'Nana' : '' });
  }
  return { recipes };
}
function rng(seed) { let a = seed; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

test('merging is order-free, repeatable and loses nothing', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  for (let seed = 1; seed <= 400; seed++) {
    const rnd = rng(seed);
    const A = randomBox(rnd, ids), B = randomBox(rnd, ids);
    const ab = mergeBoxes(A, B), ba = mergeBoxes(B, A);
    assert.equal(canon(ab), canon(ba), `order matters for seed ${seed}`);
    assert.equal(canon(mergeBoxes(ab, ab)), canon(ab), 'merging twice changes nothing');
    assert.equal(canon(mergeBoxes(A, ab)), canon(ab), 'merging in what was already merged changes nothing');
    // Every recipe on either side is still there, unless a newer removal or the same words under another id replaced it.
    for (const side of [A, B]) for (const r of live(side)) {
      const m = ab.recipes[r.id];
      assert.ok(m, 'nothing disappears');
      if (m.del) assert.ok(m.t > r.t || m.to || (m.t === r.t), `a live recipe was only removed by a newer removal or a duplicate (seed ${seed})`);
    }
  }
});

// Devices syncing through one Drive file, in any order, end up with the same box once each has synced after the last change.
test('devices syncing through one file in any order end up the same', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  for (let seed = 1; seed <= 300; seed++) {
    const rnd = rng(seed * 7);
    const devices = [randomBox(rnd, ids), randomBox(rnd, ids), randomBox(rnd, ids)];
    let drive = { recipes: {} };
    for (let n = 0; n < 8; n++) { // a few syncs in a random order
      const i = Math.floor(rnd() * devices.length);
      drive = mergeBoxes(devices[i], drive);
      devices[i] = drive;
    }
    for (let i = 0; i < devices.length; i++) { drive = mergeBoxes(devices[i], drive); devices[i] = drive; }
    for (let i = 0; i < devices.length; i++) { drive = mergeBoxes(devices[i], drive); devices[i] = drive; }
    for (const d of devices) assert.equal(canon(d), canon(drive), `devices differ for seed ${seed}`);
  }
});

test('merging: newest wins, removals win when newer, and duplicates collapse', () => {
  const old = cleanRecipe({ id: 'r1', t: 10, title: 'Pie', ingredients: ['1 cup flour'] });
  const edited = cleanRecipe({ id: 'r1', t: 20, title: 'Apple Pie', ingredients: ['1 cup flour'] });
  assert.equal(mergeBoxes({ recipes: { r1: old } }, { recipes: { r1: edited } }).recipes.r1.title, 'Apple Pie');
  const gone = { id: 'r1', t: 30, del: 1 };
  assert.equal(mergeBoxes({ recipes: { r1: edited } }, { recipes: { r1: gone } }).recipes.r1.del, 1);
  const olderGone = { id: 'r1', t: 5, del: 1 };
  assert.equal(mergeBoxes({ recipes: { r1: edited } }, { recipes: { r1: olderGone } }).recipes.r1.title, 'Apple Pie', 'an edit after the removal brings it back');
  // The same card typed on two devices before either synced: one copy, and the other id points to it.
  const a = cleanRecipe({ id: 'ra', t: 10, title: 'Chili', from: 'Walt', ingredients: ['2 lb beef'] });
  const b = cleanRecipe({ id: 'rb', t: 12, title: 'chili', from: 'walt', ingredients: ['2 lb beef'] });
  const m = mergeBoxes({ recipes: { ra: a } }, { recipes: { rb: b } });
  assert.equal(live(m).length, 1);
  assert.equal(m.recipes.rb.to, 'ra');
  assert.equal(fingerprint(a), fingerprint(b));
  // A first sync keeps recipes that are only on one side.
  const only = mergeBoxes({ recipes: { x: cleanRecipe({ id: 'x', t: 1, title: 'X' }) } }, { recipes: { y: cleanRecipe({ id: 'y', t: 2, title: 'Y' }) } });
  assert.equal(live(only).length, 2);
});

test('two copies of a recipe with different notes, tags or times both stay', () => {
  const card = { title: 'Buttermilk Pancakes', from: 'Mom', ingredients: ['2 cups flour', '2 eggs'], steps: ['Mix.', 'Cook 2 minutes a side.'] };
  const mine = cleanRecipe({ ...card, id: 'rk3', t: 1000, notes: 'Mark: she used the cast-iron pan.', tags: ['Breakfast'], serves: '4' });
  const hers = cleanRecipe({ ...card, id: 'ra9', t: 2000, notes: 'Ann: double it for the cousins.', tags: ['Holidays'], source: 'Card in the green tin' });
  const m = mergeBoxes({ recipes: { rk3: mine } }, { recipes: { ra9: hers } });
  assert.deepEqual(live(m).map(r => r.id).sort(), ['ra9', 'rk3'], 'neither copy’s notes and tags are lost');
  assert.equal(canon(mergeBoxes(m, m)), canon(m), 'and merging again changes nothing');
  for (const [field, a, b] of [['notes', 'Use buttermilk.', 'Use sour milk.'], ['tags', ['Breakfast'], ['Holidays']], ['serves', '4', '6'], ['makes', '12', '16'],
    ['prep', '10 min', '15 min'], ['cook', '20 min', '25 min'], ['total', '30 min', '40 min'], ['source', 'The green tin', 'An email from Ann']]) {
    const x = cleanRecipe({ ...card, id: 'x1', t: 1, [field]: a }), y = cleanRecipe({ ...card, id: 'y1', t: 2, [field]: b });
    assert.equal(live(mergeBoxes({ recipes: { x1: x } }, { recipes: { y1: y } })).length, 2, `copies with different ${field} both stay`);
  }
  // Word for word the same, notes and tags included (tags in any order), is still one recipe.
  const one = cleanRecipe({ ...card, id: 'x1', t: 1, notes: 'Use buttermilk.', tags: ['Breakfast', 'Holidays'], serves: '4' });
  const two = cleanRecipe({ ...card, id: 'y1', t: 2, notes: 'use buttermilk.', tags: ['holidays', 'Breakfast'], serves: '4' });
  const same = mergeBoxes({ recipes: { x1: one } }, { recipes: { y1: two } });
  assert.equal(live(same).length, 1);
  assert.equal(same.recipes.y1.to, 'x1');
});

test('a box cleans every recipe and keeps the newest of duplicates', () => {
  const b = cleanBox({ fromScratch: 1, box: { recipes: [{ id: 'a', t: 1, title: 'One' }, { id: 'a', t: 3, title: 'Three' }, { title: '' }, null] } });
  assert.deepEqual(Object.keys(b.recipes), ['a']);
  assert.equal(b.recipes.a.title, 'Three');
});

// A stand-in for the browser's localStorage, with room for so many characters.
function fakeStorage() {
  const data = new Map();
  return {
    room: Infinity, data,
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem(k, v) {
      const others = [...data].reduce((n, [key, val]) => n + (key === k ? 0 : key.length + val.length), 0);
      if (others + k.length + String(v).length > this.room) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
      data.set(k, String(v));
    },
    removeItem: k => data.delete(k),
  };
}

// localStorage is shared by every tool at junkdrawer.works/REPO/, so it can fill up. A change that can't be saved
// must not look saved: the box stays as it was, and the page hears 'full' to say so.
test('a change that can’t be saved leaves the box as it was', async () => {
  const ls = globalThis.localStorage = fakeStorage(), data = ls.data;
  try {
    const { box, KEY } = await import('../js/store.js');
    const heard = [];
    box.onChange(why => heard.push(why));
    const pie = box.put({ id: 'r-pie', title: 'Apple Pie', ingredients: ['6 apples'] });
    assert.ok(pie && !box.full);
    ls.room = 0; // nothing more fits
    const seq = box.seq, before = canon(box.state);
    assert.equal(box.put({ id: 'r-crisp', title: 'Aunt Ruth’s Rhubarb Crisp' }), null, 'not saved, so not returned');
    assert.ok(box.full);
    assert.equal(box.get('r-crisp'), null, 'and not shown either');
    assert.equal(box.remove('r-pie'), undefined);
    assert.ok(box.get('r-pie'), 'a removal that couldn’t be saved leaves the recipe');
    assert.deepEqual(box.add([{ id: 'r-a', title: 'A' }, { id: 'r-b', title: 'B' }]), []);
    assert.equal(box.merge({ recipes: { 'r-c': { id: 'r-c', t: 5, title: 'C' } } }), null);
    heard.length = 0;
    assert.equal(box.replace({ recipes: {} }), false, 'a sync’s copy that couldn’t be saved');
    assert.deepEqual(heard, [], 'the sync says so itself');
    assert.equal(canon(box.state), before, 'the box is as it was');
    assert.equal(box.seq, seq);
    assert.equal(canon(JSON.parse(data.get(KEY))), before, 'and so is what a reload reads');
    ls.room = Infinity;
    assert.ok(box.put({ id: 'r-crisp', title: 'Aunt Ruth’s Rhubarb Crisp' }));
    assert.ok(!box.full);
    assert.ok(heard.includes('local'));
  } finally {
    delete globalThis.localStorage;
  }
});

test('loading a backup counts the recipes it brings, not its removal markers', async () => {
  globalThis.localStorage = fakeStorage();
  try {
    const { box } = await import('../js/store.js');
    const backup = { recipes: { 'b-plum': { id: 'b-plum', t: 5, title: 'Plum Cake' }, 'b-gone1': { id: 'b-gone1', t: 5, del: 1 }, 'b-gone2': { id: 'b-gone2', t: 5, del: 1 }, 'b-gone3': { id: 'b-gone3', t: 5, del: 1 } } };
    assert.deepEqual(box.merge(backup), { added: 1, removed: 0 }, 'one recipe, not four');
    assert.deepEqual(box.merge(backup), { added: 0, removed: 0 }, 'nothing new the second time');
    box.put({ id: 'b-soup', title: 'Bean Soup' });
    assert.deepEqual(box.merge({ recipes: { 'b-soup': { id: 'b-soup', t: Date.now() + 60000, del: 1 } } }), { added: 0, removed: 1 }, 'a newer removal takes one out');
    assert.equal(box.get('b-soup'), null);
  } finally {
    delete globalThis.localStorage;
  }
});

test('a backup’s photo that isn’t readable is skipped, not fatal', async () => {
  assert.equal(dataURLToBlob('data:image/jpeg;base64,@@@notbase64@@@'), null);
  assert.equal(dataURLToBlob('not a photo'), null);
  const ok = dataURLToBlob('data:image/png;base64,' + Buffer.from('hello').toString('base64'));
  assert.equal(ok.type, 'image/png');
  assert.equal(await ok.text(), 'hello');
});

// ---------- links ----------
test('links pack and unpack, compressed', async () => {
  const r = cleanRecipe({ ...SAMPLES[0], t: 99 });
  const data = await pack({ fromScratch: 1, recipes: [forLink(r)] });
  assert.equal(data[0], 'z');
  assert.match(data, /^[zj][A-Za-z0-9_-]+$/);
  const back = await unpack(data);
  assert.equal(back.recipes[0].title, r.title);
  assert.equal(back.recipes[0].t, undefined, 'change times don’t travel in links');
  const got = await readIncoming(`https://junkdrawer.works/from-scratch/#/add/${data}`);
  assert.equal(got.kind, 'batch');
  assert.deepEqual(got.recipes[0].ingredients, r.ingredients);
  assert.ok(LINK_RX.test('#/add/' + data));
  // Plain JSON works too (a file, or text pasted from Claude).
  const plain = await readIncoming(JSON.stringify({ fromScratch: 1, recipes: [{ title: 'Toast', ingredients: ['2 slices bread'], unsure: 'check the butter' }] }));
  assert.equal(plain.recipes[0].check, 'check the butter');
  // An uncompressed link.
  const j = 'j' + Buffer.from(JSON.stringify({ fromScratch: 1, recipes: [{ title: 'Tea' }] })).toString('base64url');
  assert.equal((await readIncoming('#/add/' + j)).recipes[0].title, 'Tea');
  await assert.rejects(readIncoming('#/add/zNOTREAL'));
});

test('a link with a full stop after it, or words around it, still opens', async () => {
  const link = `https://junkdrawer.works/from-scratch/#/add/${await pack({ fromScratch: 1, recipes: [{ title: 'Tea', ingredients: ['1 tea bag'] }] })}`;
  assert.equal((await readIncoming(link + '.')).recipes[0].title, 'Tea');
  assert.equal((await readIncoming(`Here it is: ${link} Enjoy!`)).recipes[0].title, 'Tea');
  assert.equal((await readIncoming(`Mom’s tea (${link}), from Claude`)).recipes[0].title, 'Tea');
  // A file is JSON, even when a note in it has a link.
  const file = JSON.stringify([{ title: 'Scones', notes: `Like the tea: ${link}` }]);
  assert.equal((await readIncoming(file)).recipes[0].title, 'Scones');
  assert.equal((await readIncoming(JSON.stringify({ fromScratch: 1, recipes: [{ title: 'Jam', source: link }] }))).recipes[0].title, 'Jam');
});

test('every sample recipe is complete and parses cleanly', () => {
  for (const s of SAMPLES) {
    const r = cleanRecipe(s);
    assert.ok(r.title && r.from && r.ingredients.length && r.steps.length, s.id);
    for (const line of r.ingredients) {
      const p = parseLine(line);
      assert.ok(p.h || p.q != null || /to taste|for dusting/i.test(line), `${s.id}: “${line}” has an amount`);
    }
  }
});

// ---------- the Claude skill ----------
// The skill's script and the page must agree: every example in the skill's format reference goes through the
// script, and the link it prints opens in the page with every field intact and every ingredient read as documented.
const python = spawnSync('python3', ['--version']).status === 0 ? 'python3' : null;
test('the Claude skill’s script makes links this page reads', { skip: !python && 'python3 not found' }, async () => {
  const skill = join(root, 'skill/from-scratch-cards');
  const example = join(skill, 'references/example-batch.json');
  const out = mkdtempSync(join(tmpdir(), 'fs-skill-'));
  const printed = execFileSync(python, [join(skill, 'scripts/make_card_link.py'), example, '--out', out], { encoding: 'utf8' });
  const link = /Link: (\S+)/.exec(printed)[1];
  assert.ok(link.startsWith('https://junkdrawer.works/from-scratch/#/add/z'), 'the link points at the real site');
  const fromLink = await readIncoming(link);
  const file = readdirSync(out).find(f => f.endsWith('.fromscratch.json'));
  const fromFile = await readIncoming(readFileSync(join(out, file), 'utf8'));
  assert.equal(canon(fromLink.recipes), canon(fromFile.recipes), 'the link and the file carry the same recipes');
  const src = JSON.parse(readFileSync(example, 'utf8'));
  assert.equal(fromLink.recipes.length, src.recipes.length);
  assert.equal(fromLink.name, src.name);
  const expected = JSON.parse(readFileSync(join(skill, 'references/example-parsed.json'), 'utf8'));
  for (const [i, r] of fromLink.recipes.entries()) {
    const s = src.recipes[i];
    assert.equal(r.title, s.title);
    assert.equal(r.from, s.from);
    assert.deepEqual(r.steps, s.steps);
    assert.equal(r.check || '', s.unsure || '');
    assert.match(r.id, /^c\d{8}-[0-9a-f]{10}$/, 'the script gives each recipe an id from its content');
    // Each ingredient line reads the way references/format.md says it should.
    const parsed = r.ingredients.map(line => { const p = parseLine(line); return p.h ? { h: p.h } : pick(p); });
    assert.deepEqual(parsed, expected[i], `ingredients of “${r.title}”`);
  }
});

test('every ingredient line in the skill’s format reference reads as the reference says', () => {
  const md = readFileSync(join(root, 'skill/from-scratch-cards/references/format.md'), 'utf8').split('## Ingredient lines')[1].split('\n## ')[0];
  const rows = [...md.matchAll(/^\| `([^`]+)` \|([^|\n]*)\|([^|\n]*)\|([^|\n]*)\|([^|\n]*)\|$/gm)];
  assert.ok(rows.length >= 12, 'the table is there');
  for (const [, line, amount, unit, item, note] of rows.map(r => r.map(x => x.trim()))) {
    const p = parseLine(line);
    if (amount === 'a section heading') { assert.ok(p.h, line); continue; }
    assert.equal(p.u, unit, `${line}: unit`);
    assert.equal(p.item, item.replace(/ \(juice of\)$/, ''), `${line}: item`);
    assert.equal(p.note, note, `${line}: note`);
    if (!amount) { assert.equal(p.q, null, `${line}: no amount`); continue; }
    const m = /^(about )?([\d½¼¾⅓⅔⅛]+)(?: to ([\d½¼¾⅓⅔⅛]+))?(?:, each ([\d½¼¾]+) oz)?(?: \(also (\d+) sticks\))?(?:, (scant))?(?:, plus ([\d½¼¾⅓⅔⅛]+) ([a-z ]+))?$/.exec(amount);
    assert.ok(m, `${line}: the reference's amount "${amount}" is in a form this test knows`);
    assert.equal(kitchen(p.q, [2, 3, 4, 8]), m[2], `${line}: amount`);
    if (m[1]) assert.equal(p.mod, 'about');
    if (m[3]) assert.equal(kitchen(p.q2, [2, 3, 4, 8]), m[3], `${line}: top of the range`);
    if (m[4]) assert.equal(kitchen(p.size.q, [2, 4]), m[4], `${line}: size`);
    if (m[5]) assert.equal(p.alt.q, +m[5], `${line}: also`);
    if (m[6]) assert.equal(p.mod, 'scant');
    if (m[7]) assert.deepEqual([kitchen(p.plus.q, [2, 3, 4, 8]), p.plus.item], [m[7], m[8]], `${line}: the second count`);
  }
});

test('the skill’s script knows the same unit words as the page', { skip: !python && 'python3 not found' }, async () => {
  const { UNIT_NAMES } = await import('../js/units.js');
  const script = JSON.parse(execFileSync(python, [join(root, 'skill/from-scratch-cards/scripts/make_card_link.py'), '--units'], { encoding: 'utf8' }));
  assert.deepEqual([...script].sort(), UNIT_NAMES.map(u => u.name).sort());
});

// The names and contents in a zip file, read from its central directory (stored or deflated entries).
function readZip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'a zip file');
  const files = [];
  for (let at = buf.readUInt32LE(end + 16), i = 0; i < buf.readUInt16LE(end + 10); i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50);
    const method = buf.readUInt16LE(at + 10), size = buf.readUInt32LE(at + 20), nameLen = buf.readUInt16LE(at + 28);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen), local = buf.readUInt32LE(at + 42);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    files.push([name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw)]);
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return files;
}

// The Add page links to this zip for uploading the skill in claude.ai, so it must hold the folder as it is now.
test('the skill’s zip holds exactly what its folder does', async () => {
  const { skillFiles, ZIP } = await import('../tools/skill-zip.mjs');
  const fix = 'run node tools/skill-zip.mjs';
  const got = readZip(readFileSync(ZIP)), want = skillFiles();
  assert.ok(want.some(([name]) => name === 'from-scratch-cards/SKILL.md'), 'the folder is at the top of the zip');
  assert.deepEqual(got.map(f => f[0]), want.map(f => f[0]), `the zip has other files than the folder: ${fix}`);
  for (const [i, [name, data]] of want.entries()) assert.ok(got[i][1].equals(data), `${name} in the zip is out of date: ${fix}`);
  // And a zip tool other than this file's reader opens it, checksums and all.
  if (python) execFileSync(python, ['-c', 'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None', ZIP]);
  const url = /const SKILL_URL = '([^']+)'/.exec(readFileSync(join(root, 'js/app.js'), 'utf8'))[1];
  assert.equal(url, 'https://github.com/markjf99702/from-scratch/raw/main/skill/from-scratch-cards.zip', 'the Add page links to the zip');
});

test('the offline copy lists every file the page uses', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const shell = JSON.parse('[' + /const SHELL = \[([\s\S]*?)\];/.exec(sw)[1].replace(/\/\/[^\n]*/g, '').replace(/'/g, '"').replace(/,\s*$/, '') + ']');
  const want = [
    ...readdirSync(join(root, 'js')).map(f => 'js/' + f),
    ...readdirSync(join(root, 'css')).map(f => 'css/' + f),
    ...readdirSync(join(root, 'fonts')).filter(f => f.endsWith('.woff2')).map(f => 'fonts/' + f),
    ...readdirSync(root).filter(f => /^icon.*\.(png|svg)$/.test(f)),
    'index.html', 'manifest.webmanifest', 'samples/rosa-card.jpg',
  ];
  for (const f of want) assert.ok(shell.includes(f), `sw.js is missing ${f}`);
  for (const f of shell) if (f !== './') assert.ok(want.includes(f), `sw.js lists ${f}, which isn't there`);
});

// Every tool at junkdrawer.works/REPO/ shares one Cache Storage: a new version must clear only its own old copies,
// by their exact names, so a project called from-scratch-something keeps its offline copy.
test('the offline copy clears only its own old caches', async () => {
  const src = readFileSync(join(root, 'sw.js'), 'utf8');
  const current = /const CACHE = '([^']+)'/.exec(src)[1];
  const stored = new Set(['from-scratch-v0', 'other-tool-v1', 'every-so-often-v3', 'from-scratch', 'from-scratch-x-v1', 'from-scratch-cards-v2', current]);
  const on = {};
  vm.runInNewContext(src, {
    self: { addEventListener: (type, fn) => { on[type] = fn; }, clients: { claim: async () => {} }, skipWaiting: async () => {} },
    caches: { keys: async () => [...stored], delete: async k => stored.delete(k) },
    location: { origin: 'https://junkdrawer.works' },
  });
  let done;
  on.activate({ waitUntil: p => { done = p; } });
  await done;
  assert.deepEqual([...stored].sort(), ['every-so-often-v3', 'from-scratch', 'from-scratch-x-v1', 'from-scratch-cards-v2', current, 'other-tool-v1'].sort(), 'only from-scratch-v0 goes');
});
