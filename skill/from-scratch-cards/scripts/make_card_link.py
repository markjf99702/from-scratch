#!/usr/bin/env python3
"""Turn typed-up recipe cards into a From Scratch link and a .fromscratch.json file.

    python3 make_card_link.py cards.json [--out DIR] [--base URL] [--no-link]

cards.json (every field but "title" is optional; see references/format.md):

{
  "name": "Grandma Rosa's cards",                 # shown when the link is opened
  "recipes": [
    {"title": "Cinnamon Crumb Coffee Cake", "from": "Grandma Rosa",
     "serves": "9", "makes": "", "prep": "20 min", "cook": "35–40 min",
     "ingredients": ["1 1/2 cups flour", "3/4 cup sugar", "For the topping:", "1/2 cup brown sugar"],
     "steps": ["Mix the dry ingredients.", "Bake in a moderate oven (350°F) 35–40 minutes."],
     "notes": "Oleo is margarine.", "tags": ["Baking"], "source": "Index card in her handwriting",
     "unsure": "the oven temperature is smudged"}   # what to check against the card, in a few words
  ]
}

It cleans every field, warns about ingredient lines From Scratch may not read the way you meant, gives each recipe an
id made from its words (so the same link opened twice isn't added twice), and exits 1 (saying why) if the input can't
be used. The link is the JSON compressed with raw DEFLATE and base64url-encoded, after #/add/z.
"""
import argparse, base64, datetime, hashlib, json, re, sys, zlib
from pathlib import Path

DEFAULT_BASE = 'https://junkdrawer.works/from-scratch/'

# The unit words From Scratch reads (js/units.js). The page's tests check this list against the page's own.
UNITS = [
    'teaspoons', 'teaspoon', 'teasp', 'tsps', 'tsp', 't',
    'tablespoons', 'tablespoon', 'tablesp', 'tbsps', 'tbsp', 'tbls', 'tbl', 'tbs', 'tb', 'T',
    'cups', 'cup', 'c', 'C',
    'fluid ounces', 'fluid ounce', 'fl. oz', 'fl oz', 'fl.oz', 'floz',
    'pints', 'pint', 'pts', 'pt', 'quarts', 'quart', 'qts', 'qt', 'gallons', 'gallon', 'gal',
    'sticks', 'stick',
    'millilitres', 'milliliters', 'millilitre', 'milliliter', 'mls', 'ml', 'mL',
    'centilitres', 'centiliters', 'cl', 'decilitres', 'deciliters', 'dl',
    'litres', 'liters', 'litre', 'liter', 'ltr', 'l', 'L',
    'ounces', 'ounce', 'ozs', 'oz', 'pounds', 'pound', 'lbs', 'lb', '#',
    'grams', 'gram', 'grammes', 'gramme', 'gr', 'gms', 'gm', 'g',
    'kilograms', 'kilogram', 'kilos', 'kilo', 'kgs', 'kg',
    'squares', 'square', 'sq',
    'pinches', 'pinch', 'dashes', 'dash', 'drops', 'drop', 'cloves', 'clove',
    'cans', 'can', 'tins', 'tin', 'packages', 'package', 'pkgs', 'pkg', 'pks', 'pk', 'packs', 'pack',
    'packets', 'packet', 'pkts', 'pkt', 'sachets', 'sachet', 'envelopes', 'envelope', 'envs', 'env',
    'jars', 'jar', 'boxes', 'box', 'bags', 'bag', 'bottles', 'bottle',
    'cartons', 'carton', 'containers', 'container', 'tubs', 'tub',
    'bunches', 'bunch', 'heads', 'head', 'sprigs', 'sprig', 'stalks', 'stalk', 'ribs', 'rib',
    'slices', 'slice', 'pieces', 'piece', 'pcs', 'pc', 'handfuls', 'handful', 'dozen', 'doz',
]
AMOUNT = re.compile(r"""^(?:about\s+|approx\.?\s+|scant\s+|heaping\s+)?
    (?:\d+(?:[.,]\d+)?(?:\s+\d+/\d+|-\d+/\d+)?|\d+/\d+|[¼½¾⅓⅔⅛⅜⅝⅞]|\d+\s*[¼½¾⅓⅔⅛⅜⅝⅞]
      |an?\b|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half)""", re.X | re.I)
NO_AMOUNT_OK = re.compile(r'to taste|as needed|if needed|for (serving|garnish|dusting|frying|greasing|the pan|brushing)|^(juice|zest|grated zest|rind) of|^(pinch|dash|handful|sprig)', re.I)


def s(v, n):
    if isinstance(v, bool) or v is None or isinstance(v, (dict, list)):
        return ''
    return re.sub(r'\s+', ' ', str(v)).strip()[:n]


def para(v, n):
    if not isinstance(v, str):
        return ''
    v = re.sub(r'[ \t]+\n', '\n', v.replace('\r\n', '\n').replace('\r', '\n'))
    return re.sub(r'\n{3,}', '\n\n', v).strip()[:n]


def ingredient(x):
    if isinstance(x, (int, float)) and not isinstance(x, bool):
        return str(x)
    if isinstance(x, str):
        return s(x, 300)
    if isinstance(x, dict):
        h = x.get('h') or x.get('heading') or x.get('section')
        if h:
            h = s(h, 80).rstrip(':')
            return h + ':' if h else ''
        if x.get('text'):
            return s(x['text'], 300)
        amount = ' '.join(t for t in (s(x.get('qty') or x.get('q') or x.get('amount'), 40), s(x.get('unit') or x.get('u'), 40)) if t)
        main = ' '.join(t for t in (amount, s(x.get('item') or x.get('name'), 200)) if t)
        note = s(x.get('note'), 200)
        return main + (', ' + note if main and note else '')
    return ''


def check_line(line, title, warn):
    if line.endswith(':') and len(line) <= 60:
        return
    m = AMOUNT.match(line)
    if not m:
        if not NO_AMOUNT_OK.search(line):
            warn.append(f'“{title}”: “{line}” has no amount. Fine for “salt, to taste”; otherwise look at the card again.')
        return
    rest = line[m.end():].lstrip()
    rest = re.sub(r'^\(([^)]*)\)\s*', '', rest)  # a size like (15 oz)
    word = re.match(r"^([A-Za-z#.]+(?: oz)?\.?)", rest)
    if word:
        w = word.group(1)
        bare = w.rstrip('.')
        if w.endswith('.') and bare not in UNITS and bare.lower() not in [u.lower() for u in UNITS if len(u) > 1]:
            warn.append(f'“{title}”: “{line}”: From Scratch doesn’t know the unit “{w}”. Write it out (cup, tbsp, tsp, oz, lb, package…).')


def clean(r, i, warn):
    if not isinstance(r, dict):
        warn.append(f'#{i + 1}: not a recipe, left out')
        return None
    title = s(r.get('title') or r.get('name'), 200)
    if not title:
        warn.append(f'#{i + 1}: no title, left out')
        return None
    ings = r.get('ingredients') or []
    if isinstance(ings, str):
        ings = ings.split('\n')
    ingredients = [x for x in (ingredient(x) for x in ings if x is not None) if x][:150]
    steps = r.get('steps') or r.get('directions') or r.get('method') or []
    if isinstance(steps, str):
        steps = steps.split('\n')
    steps = [x for x in (para(x if isinstance(x, str) else (x or {}).get('text', '') if isinstance(x, dict) else '', 3000).replace('\n', ' ') for x in steps) if x][:80]
    tags = r.get('tags') or []
    if isinstance(tags, str):
        tags = tags.split(',')
    seen, tag_list = set(), []
    for t in tags if isinstance(tags, list) else []:
        t = s(t, 30).lstrip('#')
        if t and t.lower() not in seen:
            seen.add(t.lower())
            tag_list.append(t)
    out = {
        'title': title,
        'from': s(r.get('from') or r.get('whose') or r.get('by'), 100),
        'serves': s(r.get('serves') or r.get('servings'), 30),
        'makes': s(r.get('makes') or r.get('yield'), 80),
        'prep': s(r.get('prep'), 40),
        'cook': s(r.get('cook'), 40),
        'total': s(r.get('total'), 40),
        'ingredients': ingredients,
        'steps': steps,
        'notes': para(r.get('notes') or r.get('story') or '', 5000),
        'tags': tag_list[:12],
        'source': s(r.get('source'), 200),
        'unsure': s(r.get('unsure') or r.get('check'), 500),
    }
    if not ingredients:
        warn.append(f'“{title}”: no ingredients')
    if not steps:
        warn.append(f'“{title}”: no steps')
    for line in ingredients:
        check_line(line, title, warn)
    out = {k: v for k, v in out.items() if v not in ('', [], None)}
    body = json.dumps({k: out.get(k) for k in ('title', 'from', 'ingredients', 'steps')}, ensure_ascii=False, sort_keys=True)
    out['id'] = 'c' + datetime.date.today().strftime('%Y%m%d') + '-' + hashlib.sha1(body.encode()).hexdigest()[:10]
    return out


def build(doc, warn):
    if isinstance(doc, list):
        doc = {'recipes': doc}
    if isinstance(doc, dict) and 'title' in doc and 'recipes' not in doc:
        doc = {'recipes': [doc]}
    if not isinstance(doc, dict) or not isinstance(doc.get('recipes'), list):
        raise SystemExit('error: the input needs a "recipes" list')
    recipes = [r for r in (clean(r, i, warn) for i, r in enumerate(doc['recipes'])) if r]
    if not recipes:
        raise SystemExit('error: no usable recipes (each needs at least a title)')
    ids = {}
    for r in recipes:
        if r['id'] in ids:
            warn.append(f'“{r["title"]}” appears twice with the same words; the second copy was left out.')
        ids.setdefault(r['id'], r)
    out = {'fromScratch': 1, 'name': s(doc.get('name'), 120), 'made': datetime.date.today().isoformat(), 'recipes': list(ids.values())}
    return {k: v for k, v in out.items() if v != ''}


def link(out, base):
    raw = json.dumps(out, ensure_ascii=False, separators=(',', ':')).encode()
    z = zlib.compressobj(9, zlib.DEFLATED, -15)
    packed = z.compress(raw) + z.flush()
    return base + '#/add/z' + base64.urlsafe_b64encode(packed).decode('ascii').rstrip('=')


def slug(t):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', t.lower())).strip('-')[:48] or 'recipes'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('cards', nargs='?')
    ap.add_argument('--out', default='.', help='folder for the .fromscratch.json file')
    ap.add_argument('--base', default=DEFAULT_BASE, help='where From Scratch lives')
    ap.add_argument('--no-link', action='store_true')
    ap.add_argument('--units', action='store_true', help='print the unit words From Scratch reads, as JSON, and stop')
    a = ap.parse_args()
    if a.units:
        print(json.dumps(UNITS))
        return
    if not a.cards:
        ap.error('which file? python3 make_card_link.py cards.json')
    try:
        doc = json.loads(Path(a.cards).read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as e:
        raise SystemExit(f'error: can’t read {a.cards}: {e}')
    warn = []
    out = build(doc, warn)
    recipes = out['recipes']
    print(f'{out.get("name") or "Recipes"}: {len(recipes)} recipe{"s" if len(recipes) != 1 else ""}')
    for r in recipes:
        who = f'{r["from"]}’s ' if r.get('from') else ''
        print(f'  {"?" if r.get("unsure") else "-"} {who}{r["title"]}: {len(r.get("ingredients", []))} ingredients, {len(r.get("steps", []))} steps')
        if r.get('unsure'):
            print(f'      check: {r["unsure"]}')
    for w in warn:
        print(f'warning: {w}')
    Path(a.out).mkdir(parents=True, exist_ok=True)
    first = recipes[0]['title'] if len(recipes) == 1 else (out.get('name') or 'recipes')
    f = Path(a.out) / f'{slug(first)}-{out["made"]}.fromscratch.json'
    f.write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'\nFile: {f}')
    if not a.no_link:
        url = link(out, a.base if a.base.endswith('/') else a.base + '/')
        if len(url) > 30000:
            print(f'\nThe link is {len(url):,} characters, too long to pass around safely. Hand over the file instead.')
        else:
            print(f'\nLink: {url}')


if __name__ == '__main__':
    main()
