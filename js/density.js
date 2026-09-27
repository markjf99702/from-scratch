// What a cup of common baking ingredients weighs, for switching between cups and grams.
// Every figure is a household portion weight from USDA FoodData Central, SR Legacy (April 2018),
// with its NDB number so it can be checked: https://fdc.nal.usda.gov/
// Cups are spooned and levelled, as USDA measures them; a cup of flour scooped from the bag weighs more.
// Anything not in this list keeps its cups (or becomes millilitres), because guessing a weight is worse than none.

const CUP = 236.588; // millilitres in a US cup

// [name shown in the note, grams per cup, NDB number, USDA's description, test on the item's words]
const TABLE = [
  ['bread flour', 137, '20083', 'Wheat flour, white, bread, enriched', /\bbread flour\b/],
  ['cake flour', 137, '20084', 'Wheat flour, white, cake, enriched (unsifted, dipped)', /\bcake flour\b/],
  ['whole wheat flour', 120, '20080', 'Wheat flour, whole-grain', /\bwhole[- ]?(wheat|grain|meal)( pastry)? flour\b|\bgraham flour\b/],
  ['dark rye flour', 128, '20063', 'Rye flour, dark', /\bdark rye flour\b/],
  ['rye flour', 102, '20064', 'Rye flour, medium', /\brye flour\b/],
  ['rice flour', 158, '20061', 'Rice flour, white, unenriched', /\brice flour\b/],
  ['self-rising flour', 125, '20082', 'Wheat flour, white, all-purpose, self-rising, enriched', /\bself[- ]?rais(ing|ed) flour\b|\bself[- ]?rising flour\b/],
  ['semolina', 167, '20066', 'Semolina, enriched', /\bsemolina\b/],
  ['cornstarch', 128, '20027', 'Cornstarch', /\bcorn ?starch\b|\bcornflour\b/],
  ['stone-ground cornmeal', 122, '20020', 'Cornmeal, whole-grain, yellow', /\b(stone[- ]?ground|whole[- ]?grain)\b.*\bcorn ?meal\b/],
  ['cornmeal', 157, '20022', 'Cornmeal, degermed, enriched, yellow', /\bcorn ?meal\b/],
  // Plain "flour" on a card means all-purpose. Other flours with no USDA cup weight are left alone.
  ['all-purpose flour', 125, '20081', 'Wheat flour, white, all-purpose, enriched, bleached', item => /\bflour\b/.test(item) && !/\b(almond|coconut|oat|chickpea|garbanzo|potato|tapioca|masa|nut|spelt|buckwheat|gluten|00|pastry|cassava|sorghum|teff|millet|quinoa|soy|arrowroot|barley|hazelnut|pea|corn)\b/.test(item)],

  ['powdered sugar, sifted', 100, '19336', 'Sugars, powdered (1 cup sifted)', /\bsifted\b.*\b(powdered|confectioners?|icing|10-?x|xxxx)\b/],
  ['powdered sugar', 120, '19336', 'Sugars, powdered (1 cup unsifted)', /\b(powdered|confectioners?|icing|10-?x|xxxx) sugar\b|\bicing sugar\b/],
  ['brown sugar, loosely packed', 145, '19334', 'Sugars, brown (1 cup unpacked)', /\b(unpacked|loosely packed|not packed)\b.*\bbrown sugar\b/],
  ['brown sugar', 220, '19334', 'Sugars, brown (1 cup packed)', /\bbrown sugar\b/],
  ['turbinado sugar', 202, '19908', 'Sugar, turbinado', /\b(turbinado|demerara|raw) sugar\b/],
  ['sugar', 200, '19335', 'Sugars, granulated', /^(granulated |white |caster |castor |superfine |cane |fine |regular |plain )?sugars?$/],

  ['peanut butter', 258, '16098', 'Peanut butter, smooth style, with salt', /\bpeanut butter\b/],
  ['butter', 227, '01145', 'Butter, without salt', item => /\bbutter\b/.test(item) && !/\b(apple|almond|cashew|nut|cocoa|shea|sunflower|seed|pumpkin|cookie|bean|beans|lettuce|squash)\b|\bbutter(milk|scotch|nut|cream|fingers?)\b/.test(item)],
  ['margarine', 227, '04610', 'Margarine, regular, 80% fat, stick', /\b(margarine|oleo|oleomargarine)\b/],
  ['shortening', 205, '04031', 'Shortening, household, soybean-cottonseed', /\bshortening\b|\bcrisco\b/],
  ['lard', 205, '04002', 'Lard', /\blard\b/],

  ['honey', 339, '19296', 'Honey', /^(raw |clover |liquid |runny |mild )?honey$/],
  ['maple syrup', 315, '19353', 'Syrups, maple', /\bmaple syrup\b/],
  ['molasses', 337, '19304', 'Molasses', /\bmolasses\b/],
  ['corn syrup', 341, '19350', 'Syrups, corn, light', /\bcorn syrup\b/],

  ['cocoa', 86, '19165', 'Cocoa, dry powder, unsweetened', item => /\bcocoa\b/.test(item) && !/\b(nibs?|mix|butter|beans?)\b|\bhot cocoa\b/.test(item)],
  ['rolled oats', 81, '08120', 'Cereals, oats, regular and quick, not fortified, dry', item => /\b(oats|oatmeal)\b/.test(item) && !/\b(steel|cooked|flour|milk|bran)\b/.test(item)],
  ['rice', 185, '20044', 'Rice, white, long-grain, regular, raw', item => /\brice\b/.test(item) && !/\b(flour|vinegar|wine|noodles?|paper|krispies|cereal|cakes?|milk|cooked|leftover|steamed|wild|pudding|syrup)\b/.test(item)],
  ['mini chocolate chips', 173, '19080', 'Candies, semisweet chocolate (1 cup mini chips)', /\bmini(ature)?\b.*\b(chips|morsels)\b/],
  ['chocolate chips', 168, '19080', 'Candies, semisweet chocolate (1 cup chips)', /\b(chips|morsels)\b/],
  ['sliced almonds', 92, '12061', 'Nuts, almonds (1 cup sliced)', /\b(sliced|flaked)\b.*\balmonds\b/],
  ['slivered almonds', 108, '12061', 'Nuts, almonds (1 cup slivered)', /\bslivered\b.*\balmonds\b/],
  ['almonds', 143, '12061', 'Nuts, almonds (1 cup whole)', /\balmonds\b/],
  ['pecan halves', 99, '12142', 'Nuts, pecans (1 cup halves)', /\bpecans?\b.*\bhalves\b|\bpecan halves\b/],
  ['pecans', 109, '12142', 'Nuts, pecans (1 cup chopped)', /\bpecans?\b/],
  ['walnut halves', 100, '12155', 'Nuts, walnuts, english (1 cup shelled halves)', /\bwalnuts?\b.*\bhalves\b|\bwalnut halves\b/],
  ['walnuts', 117, '12155', 'Nuts, walnuts, english (1 cup chopped)', item => /\bwalnuts?\b/.test(item) || /^(chopped |finely chopped |coarsely chopped )?nuts$/.test(item) || /\bnutmeats\b/.test(item)],
  ['raisins, packed', 165, '09298', 'Raisins, dark, seedless (1 cup packed)', /\bpacked\b.*\braisins\b/],
  ['raisins', 145, '09298', 'Raisins, dark, seedless (1 cup not packed)', /\braisins\b/],
  ['shredded coconut', 93, '12179', 'Nuts, coconut meat, dried, sweetened, shredded', item => /\bcoconut\b/.test(item) && !/\b(milk|cream|oil|water|extract|flour|sugar|aminos)\b/.test(item)],
  ['graham cracker crumbs', 84, '18173', 'Cookies, graham crackers (1 cup crushed)', /\bgraham( cracker)? crumbs\b/],

  ['sour cream', 230, '01056', 'Cream, sour, cultured', /\bsour cream\b/],
  ['cream cheese', 232, '01017', 'Cheese, cream', /\bcream cheese\b/],
  ['ricotta', 246, '01036', 'Cheese, ricotta, whole milk', /\bricotta\b/],
  ['yogurt', 245, '01116', 'Yogurt, plain, whole milk', /\by(o|oe)g(h)?(u|o)rt\b/],
  ['parmesan', 100, '01032', 'Cheese, parmesan, grated', /\bparmesan\b|\bparmigiano\b/],
  ['cheddar', 113, '01009', 'Cheese, cheddar (1 cup shredded)', /\bcheddar\b/],
  ['table salt', 292, '02047', 'Salt, table', /^(table |fine |iodized |fine sea )?salt$/],
];

export const DENSITIES = TABLE.map(([name, g, ndb, usda, test]) => ({
  name, g, ndb, usda,
  gPerMl: g / CUP,
  test: typeof test === 'function' ? test : item => test.test(item),
}));

// The cup weight for an ingredient's words ("all-purpose flour", "firmly packed light brown sugar"), or null.
// Only the item is looked at: "sifted" before the item means sift first, then measure.
export function densityFor(item) {
  const words = String(item || '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[’`]/g, "'").replace(/'s?\b/g, '')
    .replace(/[^a-z0-9 -]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!words) return null;
  return DENSITIES.find(d => d.test(words)) || null;
}

export const source = d => `USDA FoodData Central, SR Legacy ${d.ndb}: ${d.usda}, 1 cup = ${d.g} g`;
