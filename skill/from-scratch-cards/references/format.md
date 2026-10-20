# From Scratch formats

Use this when you can't run `scripts/make_card_link.py` and need to write recipes by hand, when an ingredient line
might not read the way you mean, or when you're reading someone's recipe file.

## Recipes to hand over

```json
{"fromScratch": 1, "name": "Grandma Rosa's cards", "recipes": [
  {"title": "Cinnamon Crumb Coffee Cake", "from": "Grandma Rosa", "cook": "35–40 min",
   "ingredients": ["1 1/2 cups flour", "For the topping:", "1/2 cup brown sugar"],
   "steps": ["Mix the dry ingredients.", "Bake in a moderate oven (350°F) 35–40 minutes."],
   "unsure": "the oven temperature is smudged"}
]}
```

`references/example-batch.json` is a complete example: two cards, one of them `samples/rosa-card.jpg` in the From
Scratch repository, typed up by following SKILL.md.

| Field | Meaning |
|---|---|
| `name` | What the batch is, shown when the link is opened. Up to 120 characters |
| `recipes[]` | The recipes, in the order of the photos |

Each recipe:

| Field | Meaning |
|---|---|
| `title` | Required. The recipe's name, with the card's abbreviations expanded ("Cinn." → "Cinnamon"). Up to 200 characters |
| `from` | Whose recipe it is, as the family says it: "Grandma Rosa". Shown as "From the kitchen of Grandma Rosa" and "Grandma Rosa’s" |
| `serves` | How many it serves, as a number or range: "8", "6–8". Scaling by servings uses the first number |
| `makes` | What it makes: "about 4 dozen", "2 loaves", "24 cookies". Scaling uses its number |
| `prep`, `cook`, `total` | Times as short text: "20 min", "1 hr 15 min", "35–40 min" |
| `ingredients` | One line each; see below. A line ending in a colon ("For the glaze:") starts a section. Up to 150 lines |
| `steps` | One step each, in order. Times in them ("bake 25–30 minutes") become timers; °F and inches convert when someone switches to grams |
| `notes` | Stories and clarifications. Line breaks are kept. It's shown in handwriting, like a note on the card |
| `tags` | A few plain words: `["Baking", "Holidays"]` |
| `source` | Where it came from: "Index card in her handwriting", "Margin of the 1975 Joy of Cooking" |
| `unsure` | What to check against the card, in a few words. From Scratch shows it as a flag until someone says it's right |

From Scratch ignores fields it doesn't know, trims text to the limits above, and cleans every recipe that comes in, so a
slip degrades quietly. Get the amounts right.

## Ingredient lines

Write each line as **amount, unit, item, then a comma and any note**. From Scratch reads it into those parts, which is
what lets it scale the amount, turn cups into grams, and show which ingredients each step uses.

| Line | Amount | Unit | Item | Note |
|---|---|---|---|---|
| `1 1/2 cups flour, sifted` | 1½ | cup | flour | sifted |
| `1½ tsp baking powder` | 1½ | tsp | baking powder | |
| `3/4 cup brown sugar, packed` | ¾ | cup | brown sugar | packed |
| `2–3 tbsp lemon juice` | 2 to 3 | tbsp | lemon juice | |
| `3 1/2–4 cups flour` | 3½ to 4 | cup | flour | |
| `1 (15 oz) can kidney beans, drained` | 1, each 15 oz | can | kidney beans | drained |
| `1 (1/4 oz) envelope active dry yeast` | 1, each ¼ oz | envelope | active dry yeast | |
| `1 cup (2 sticks) butter, softened` | 1 (also 2 sticks) | cup | butter | softened |
| `1 scant cup sugar` | 1, scant | cup | sugar | |
| `about 2 cups milk` | about 2 | cup | milk | |
| `1 cup plus 2 tbsp flour` | 1⅛ | cup | flour | |
| `2 large eggs` | 2 | | large eggs | |
| `2 large eggs plus 1 yolk` | 2, plus 1 yolk | | large eggs | |
| `Juice of 1 lemon` | 1 | | lemon (juice of) | |
| `Pinch of salt` | 1 | pinch | salt | |
| `Salt and pepper, to taste` | | | Salt and pepper | to taste |
| `For the glaze:` | a section heading | | | |

- **Amounts**: whole numbers, `1/2`, `1 1/2`, `1½`, decimals (`0.5`, and `1,5` for metric cards), ranges with a dash
  or "to" (`2–3`, `2 to 3`), and "a", "one", "half a". Keep "scant", "heaping", "rounded" and "about".
- **Units** From Scratch reads: cup, tbsp (T, Tbsp, tablespoon), tsp (t, tsp, teaspoon), fl oz, pint, quart, gallon,
  stick, ml, cl, dl, l, oz, lb (# too), g, kg, square (of chocolate), pinch, dash, drop, clove, can, tin, package, pkg,
  packet, envelope, jar, box, bag, bottle, carton, bunch, head, sprig, stalk, rib, slice, piece, handful, dozen. A single
  capital T is a tablespoon and a small t a teaspoon, as on old cards, but spelling them out saves the next person a
  guess. `scripts/make_card_link.py --units` prints the full list.
- **Sizes** of cans and packages go in brackets between the count and the unit: `1 (15 oz) can`. They stay the same
  when the recipe is scaled.
- **Notes** go after a comma: `1 onion, chopped`. A note in brackets at the end works too: `2 cups walnuts (optional)`.
- **A second count** after the item, as in `2 large eggs plus 1 yolk`, scales with the line: halved, it reads 1 large
  egg plus ½ yolk. Keep it on one line, the way the card has it.

Things with no amount ("Salt, to taste", "Melted butter, for brushing") are fine; they're shown as written and never
scaled.

## Links

A link is From Scratch's address with the recipes in the part after `#`:

```
https://junkdrawer.works/from-scratch/#/add/z<data>
```

`<data>` is the compact JSON above, compressed with raw DEFLATE (zlib with `wbits=-15`), then base64url-encoded
without padding. `#/add/j<data>` is the same JSON base64url-encoded without compression. The part after `#` never
reaches a server. A recipe someone sends from From Scratch itself is the same kind of link.

Each recipe can carry an `id`. From Scratch keeps it, so when a link is opened a second time it can say the recipe is
already in the box. The script makes ids from the recipe's words: `c` + the date + `-` + ten hex digits.

## The recipe file (read only)

With Google Drive saving on, the whole box is `My Drive › From Scratch › From Scratch recipes.json`, and a backup
downloaded from From Scratch has the same shape (plus `photos`, if photos of cards were included):

```json
{"fromScratch": 1, "box": {"recipes": {
  "sample-rosa-coffee-cake": {"id": "sample-rosa-coffee-cake", "t": 1790000000000, "title": "Cinnamon Crumb Coffee Cake", "from": "Grandma Rosa", "ingredients": ["…"], "steps": ["…"], "added": "2026-09-20"},
  "r4k2x9…": {"id": "r4k2x9…", "t": 1790000500000, "del": 1}
}}}
```

Recipes are keyed by id. `t` is when the recipe last changed, in milliseconds. `"del": 1` marks a removed recipe, kept
so the removal reaches other devices; skip those (a `to` field on one says which recipe it turned out to be a copy of).
`added` is the date it went into the box. `check` holds an unresolved "unsure" note. Empty fields are left out.
From Scratch owns this file: read it, never write it.
