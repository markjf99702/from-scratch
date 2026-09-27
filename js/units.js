// Kitchen units: what each one is called on a card, what it measures, and how big it is.
// Volumes are in millilitres and weights in grams, so any two of the same kind convert.

export const UNITS = {
  // US volume
  tsp: { kind: 'vol', ml: 4.92892, sys: 'us', one: 'tsp', many: 'tsp', names: ['teaspoons', 'teaspoon', 'teasp', 'tsps', 'tsp', 't'] },
  tbsp: { kind: 'vol', ml: 14.7868, sys: 'us', one: 'tbsp', many: 'tbsp', names: ['tablespoons', 'tablespoon', 'tablesp', 'tbsps', 'tbsp', 'tbls', 'tbl', 'tbs', 'tb', 'T'] },
  cup: { kind: 'vol', ml: 236.588, sys: 'us', one: 'cup', many: 'cups', names: ['cups', 'cup', 'c', 'C'] },
  floz: { kind: 'vol', ml: 29.5735, sys: 'us', one: 'fl oz', many: 'fl oz', names: ['fluid ounces', 'fluid ounce', 'fl. oz', 'fl oz', 'fl.oz', 'floz'] },
  pint: { kind: 'vol', ml: 473.176, sys: 'us', one: 'pint', many: 'pints', names: ['pints', 'pint', 'pts', 'pt'] },
  quart: { kind: 'vol', ml: 946.353, sys: 'us', one: 'quart', many: 'quarts', names: ['quarts', 'quart', 'qts', 'qt'] },
  gallon: { kind: 'vol', ml: 3785.41, sys: 'us', one: 'gallon', many: 'gallons', names: ['gallons', 'gallon', 'gal'] },
  // A stick of butter is half a cup (and 113 g of butter, from the same USDA table as the rest).
  stick: { kind: 'vol', ml: 118.294, sys: 'us', one: 'stick', many: 'sticks', names: ['sticks', 'stick'] },
  // Metric volume
  ml: { kind: 'vol', ml: 1, sys: 'metric', one: 'ml', many: 'ml', names: ['millilitres', 'milliliters', 'millilitre', 'milliliter', 'mls', 'ml', 'mL'] },
  cl: { kind: 'vol', ml: 10, sys: 'metric', one: 'cl', many: 'cl', names: ['centilitres', 'centiliters', 'cl'] },
  dl: { kind: 'vol', ml: 100, sys: 'metric', one: 'dl', many: 'dl', names: ['decilitres', 'deciliters', 'dl'] },
  l: { kind: 'vol', ml: 1000, sys: 'metric', one: 'L', many: 'L', names: ['litres', 'liters', 'litre', 'liter', 'ltr', 'l', 'L'] },
  // Weight
  oz: { kind: 'mass', g: 28.3495, sys: 'us', one: 'oz', many: 'oz', names: ['ounces', 'ounce', 'ozs', 'oz'] },
  lb: { kind: 'mass', g: 453.592, sys: 'us', one: 'lb', many: 'lb', names: ['pounds', 'pound', 'lbs', 'lb', '#'] },
  g: { kind: 'mass', g: 1, sys: 'metric', one: 'g', many: 'g', names: ['grams', 'gram', 'grammes', 'gramme', 'gr', 'gms', 'gm', 'g'] },
  kg: { kind: 'mass', g: 1000, sys: 'metric', one: 'kg', many: 'kg', names: ['kilograms', 'kilogram', 'kilos', 'kilo', 'kgs', 'kg'] },
  // A square of baking chocolate is an ounce.
  square: { kind: 'mass', g: 28.3495, sys: 'us', one: 'square', many: 'squares', names: ['squares', 'square', 'sq'], keep: true },
  // Counts and containers: scaled, never converted.
  pinch: { kind: 'count', one: 'pinch', many: 'pinches', names: ['pinches', 'pinch'] },
  dash: { kind: 'count', one: 'dash', many: 'dashes', names: ['dashes', 'dash'] },
  drop: { kind: 'count', one: 'drop', many: 'drops', names: ['drops', 'drop'] },
  clove: { kind: 'count', one: 'clove', many: 'cloves', names: ['cloves', 'clove'] },
  can: { kind: 'count', box: true, one: 'can', many: 'cans', names: ['cans', 'can', 'tins', 'tin'] },
  package: { kind: 'count', box: true, one: 'package', many: 'packages', names: ['packages', 'package', 'pkgs', 'pkg', 'pks', 'pk', 'packs', 'pack'] },
  packet: { kind: 'count', box: true, one: 'packet', many: 'packets', names: ['packets', 'packet', 'pkts', 'pkt', 'sachets', 'sachet'] },
  envelope: { kind: 'count', box: true, one: 'envelope', many: 'envelopes', names: ['envelopes', 'envelope', 'envs', 'env'] },
  jar: { kind: 'count', box: true, one: 'jar', many: 'jars', names: ['jars', 'jar'] },
  box: { kind: 'count', box: true, one: 'box', many: 'boxes', names: ['boxes', 'box'] },
  bag: { kind: 'count', box: true, one: 'bag', many: 'bags', names: ['bags', 'bag'] },
  bottle: { kind: 'count', box: true, one: 'bottle', many: 'bottles', names: ['bottles', 'bottle'] },
  carton: { kind: 'count', box: true, one: 'carton', many: 'cartons', names: ['cartons', 'carton', 'containers', 'container', 'tubs', 'tub'] },
  bunch: { kind: 'count', one: 'bunch', many: 'bunches', names: ['bunches', 'bunch'] },
  head: { kind: 'count', one: 'head', many: 'heads', names: ['heads', 'head'] },
  sprig: { kind: 'count', one: 'sprig', many: 'sprigs', names: ['sprigs', 'sprig'] },
  stalk: { kind: 'count', one: 'stalk', many: 'stalks', names: ['stalks', 'stalk', 'ribs', 'rib'] },
  slice: { kind: 'count', one: 'slice', many: 'slices', names: ['slices', 'slice'] },
  piece: { kind: 'count', one: 'piece', many: 'pieces', names: ['pieces', 'piece', 'pcs', 'pc'] },
  handful: { kind: 'count', one: 'handful', many: 'handfuls', names: ['handfuls', 'handful'] },
  dozen: { kind: 'count', one: 'dozen', many: 'dozen', names: ['dozen', 'doz'] },
};

// Every name, longest first, so "tablespoons" wins over "tb" and "fl oz" over "fl".
// Single letters are case-sensitive, as on old cards: T is a tablespoon, t a teaspoon, c or C a cup, l or L a litre.
export const UNIT_NAMES = Object.entries(UNITS)
  .flatMap(([key, u]) => u.names.map(name => ({ name, key, exact: name.length === 1 || name === 'mL' })))
  .sort((a, b) => b.name.length - a.name.length);

export const unitName = (key, plural) => (UNITS[key] ? (plural ? UNITS[key].many : UNITS[key].one) : '');
export const isMeasure = key => !!UNITS[key] && UNITS[key].kind !== 'count';
export const isContainer = key => !!UNITS[key]?.box;

// Oven temperatures and pan sizes, for the steps.
export const fToC = f => (f - 32) * 5 / 9;
export const cToF = c => c * 9 / 5 + 32;
