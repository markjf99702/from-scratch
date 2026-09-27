---
name: from-scratch-cards
description: Type up family recipes for From Scratch, the recipe-box app at junkdrawer.works, from photos of handwritten or typed recipe cards, clippings, cookbook margins or a recipe someone dictates, and hand them over as a one-tap link and a file. Use this whenever someone sends a photo of a recipe card or a handwritten recipe, wants a family recipe typed up, saved or added to their recipe box, mentions From Scratch, or asks about the recipes in their box (what Grandma's pie needs, whose chili it was).
---

# From Scratch recipe cards

From Scratch (https://junkdrawer.works/from-scratch/) is a family recipe box that keeps its recipes in the person's
browser and, if they turn it on, in one file in their own Google Drive. Nothing is stored anywhere else. Your job is to
turn photos of their recipe cards into accurate typed recipes and hand them to From Scratch as a **link**. Opening the
link shows each recipe to check against the card before anything is added.

Two things make this worth doing, so protect them:
- **Her recipe, not a better one.** Type what the card says: her amounts, her ingredients, her order, her words. Don't
  modernise, correct, "improve" or fill gaps from other recipes. If the card says oleo, it's oleo. If it has no baking
  time, the recipe has no baking time; say so in `unsure`.
- **Whose it is.** The name on the recipe ("Grandma Rosa", "Aunt June") is often the reason the card is kept. Get it
  right, in the form the family uses.

## 1. Read the cards

Work through every photo. A card often has a front and a back, and the back holds the method, a note or the name.
Before writing anything, read the whole card once so you know where it ends.

- **Handwriting.** Read slowly and in context. `references/old-cards.md` lists the usual traps: 1 and 7, 4 and 9, ¼ and ½
  when the bar is faint, capital T (tablespoon) against small t (teaspoon), "oz" against "02".
- **Abbreviations and old words.** c. = cup, T. or Tbsp. = tablespoon, t. or tsp. = teaspoon, oleo = margarine,
  B.P. = baking powder, soda = baking soda, "a scant cup", "butter the size of an egg", "moderate oven". The full list,
  with oven temperatures and old can sizes, is in `references/old-cards.md`. Read it the first time you do this.
- **Directions mixed in with ingredients** ("3 T. cold butter, cut in till crumbly") are common. Put the amount in the
  ingredient list and the doing in the steps.
- **Crossings-out and margin notes.** Use the corrected amount, and mention the change in `notes` ("the sugar was
  changed from 1 cup to ¾"). A note in another hand is worth keeping in `notes` too, with who wrote it if they tell you.
- **What you can't read.** If a guess is reasonable, use it and say what to check in `unsure`, in a few words: "the oven
  temperature is smudged; 350°F fits a cake like this", "could be 1½ or 1¼ cups". If you can't guess, leave the part
  out, say so in `unsure`, and tell them in your reply. Never invent an amount.

## 2. Whose it is

- Use the name the family uses: if they say "these are Grandma Rosa's", write `"from": "Grandma Rosa"` even if the card
  is signed "Rosa". If the card has a printed "From the kitchen of" line, that's the name to start from.
- If you don't know whose it is and they didn't say, ask once, briefly, and don't hold things up: they can fill it in
  when they check the recipe in From Scratch.
- Anything they tell you about the recipe ("she made it every Christmas", "Dad always doubled the cinnamon") belongs in
  `notes`, in their words.

## 3. Write the recipes

When code tools are available, write the recipes as JSON and run the bundled script:

```
python3 scripts/make_card_link.py cards.json --out /mnt/user-data/outputs
```

(Use any writable folder for `--out`; `/mnt/user-data/outputs` is where claude.ai offers files for download.)

```json
{"name": "Grandma Rosa's cards",
 "recipes": [
  {"title": "Cinnamon Crumb Coffee Cake", "from": "Grandma Rosa", "cook": "35–40 min",
   "ingredients": ["1 1/2 cups flour", "3/4 cup sugar", "2 tsp baking powder", "1/2 tsp salt",
                   "1/3 cup oleo, melted", "1 egg", "3/4 cup milk", "1 tsp vanilla",
                   "For the topping:", "1/2 cup brown sugar", "1/3 cup flour", "2 tsp cinnamon",
                   "3 tbsp cold butter", "1/2 cup nuts"],
   "steps": ["Mix the dry ingredients.", "Add the oleo, egg, milk and vanilla. Spread in a greased 8-inch square pan.",
             "For the topping, cut the cold butter into the brown sugar, flour and cinnamon until crumbly, and add the nuts. Sprinkle the topping over.",
             "Bake in a moderate oven (350°F) 35–40 minutes."],
   "notes": "Oleo is margarine; melted butter works the same.",
   "tags": ["Baking", "Breakfast"], "source": "Index card in her handwriting"}
 ]}
```

Every field but `title` is optional. The full list and the rules for each are in `references/format.md`. The ones that
matter most:

- **`ingredients`**: one line each, written the way From Scratch reads them: amount, unit, item, then a comma and any
  note. `"1 1/2 cups flour, sifted"`, `"2–3 tbsp lemon juice"`, `"1 (15 oz) can kidney beans, drained"`,
  `"Salt and pepper, to taste"`. Spell units out or use the plain abbreviations (cup, tbsp, tsp, oz, lb, pint, quart,
  stick, g, ml); expand the card's "c." "T." "t." so nobody has to decode them twice. Keep "scant", "heaping" and
  "about" in the line (`"1 scant cup sugar"`). A heading for a part of the recipe is its own line ending in a colon:
  `"For the glaze:"`.
- **`steps`**: one step per item, in the card's order. Split a run-on paragraph at its sentences, expand abbreviations,
  and keep her wording. Keep her oven words and add the temperature in brackets: `"Bake in a moderate oven (350°F)"`.
  Write times as the card has them ("35–40 minutes", "1 hr."); From Scratch turns them into timers.
- **`serves`**, **`makes`**, **`prep`**, **`cook`**: only if the card says, or the person tells you.
- **`notes`**: stories, who wrote what, and one short line explaining any old ingredient a young cook wouldn't know.
- **`unsure`**: what to check against the card. From Scratch shows it as a flag on the recipe until someone says it's
  right.
- **`tags`**: a few plain words: Baking, Cookies, Dinner, Holidays.

The script:
- cleans every field and keeps only what From Scratch reads;
- warns about ingredient lines it doesn't recognise (no amount, or a unit From Scratch won't read), so you can look again;
- gives each recipe an id made from its words, so opening the same link twice doesn't add it twice;
- prints a summary, a **link** and a `.fromscratch.json` file path.

If it prints warnings, read them: a line with an odd unit is often a misread abbreviation.

Without code tools, write the same JSON by hand, wrapped as `{"fromScratch": 1, "recipes": [ … ]}`, and give it as text
to paste into From Scratch (**Add** › **Photograph a card** › paste box). The link needs the script.

## 4. Hand it over

Keep the reply tidy:
1. One line: how many recipes, and whose.
2. Each recipe, short: its title and whose it is, and anything flagged to check.
3. Anything you couldn't read, and where it is on the card.
4. The From Scratch link, as a link. Tapping it opens the recipes to review. Copy it character for character from the
   script's output: it's compressed data, and one changed character breaks it.
5. The file as the fallback (**Add** › **Photograph a card** › **Open a file** in From Scratch).
6. A reminder that they can keep the photo of the card with the recipe: **Edit** › **Add a photo of the card** in From
   Scratch. The link can't carry the photo.

Don't claim you've added the recipes to their box. They add them when they open the link and tap **Add**.

Opening the same link twice is safe: From Scratch says the recipe is already in the box.

## Questions about their recipe box

If a Google Drive connector is available and they ask about their recipes ("what goes in Grandma's coffee cake?",
"whose chili recipe do we have?"), read the recipe file:
1. Search Drive for the title `From Scratch recipes.json` (in a folder called `From Scratch`).
2. Download it and parse the JSON: `{"fromScratch": 1, "box": {"recipes": {id: recipe}}}`.
3. Skip recipes with `"del": 1`; they were removed.

**Only read this file; never write, move or rename it.** From Scratch syncs it and manages it. New recipes go in
through a link. Changes to a recipe are made in From Scratch itself.
