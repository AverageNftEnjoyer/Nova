# Nova City cosmetics: art still to be made

Status: **all 18 cosmetic sheets are missing.** `hud/public/pixel-city/town/cosmetics/` does not exist yet and no PixelLab tool was available when the wardrobe was built, so no art was faked. Until a sheet exists:

- the city draws the resident's default look for that slot (outfit: the job sheet in `characters/`, hat: nothing);
- the resident card's live preview does the same, and says "<item> has no art yet";
- the wardrobe grid shows a text tile (name and rarity, rarity-coloured border) instead of a thumbnail;
- the item can still be equipped once unlocked; its art appears as soon as the PNG is dropped in (no code change, no rebuild of data: a missing file is remembered per page load, so reload Home after adding art).

Item ids, names, rarities and descriptions come from `hud/lib/town/cosmetics.ts`; the file name is always `<id>.png`.

## Format (every sheet)

| Property | Value |
|---|---|
| Path | `hud/public/pixel-city/town/cosmetics/<id>.png` (served as `/pixel-city/town/cosmetics/<id>.png`) |
| Size | **224 x 256 px**, PNG, transparent background (RGBA) |
| Grid | **7 columns x 8 rows**, **32 px cells**, exactly the layout of `hud/public/pixel-city/town/characters/*.png` |
| Columns | 0 = standing, 1 to 6 = the six walk frames (same stride timing as the character sheets) |
| Rows (direction) | 0 S, 1 SE, 2 E, 3 NE, 4 N, 5 NW, 6 W, 7 SW (the renderer's `directionRow` order) |
| Feet | Outfits: lowest opaque row of the standing frames is **row 30** of each cell, centred horizontally, same as `agent.png` (the figure stands at x=16). Figures are about 28 px tall |
| Anti-aliasing | None. Hard pixels, 1 px dark outline `#1a1424`, no gradients, no dithering |
| Light | From the upper left, like the city painting |

### Outfits (slot `outfit`)

A full body sheet that **replaces** the body sheet. It must contain the whole character (head, hair, skin, hands, legs, shoes), because nothing is drawn under it. Keep the silhouette, head position and walk cycle identical to `agent.png`, so hats line up. An outfit should still read as a Nova resident: keep the face readable; the Nova agent look (teal suit and cyan visor) is for agents, so outfits should not use it.

### Hats (slot `hat`)

A **transparent** sheet with the same grid. Only the hat pixels are drawn, in the head region of each cell, aligned to the body's cell: the renderer draws the hat sheet over the body at the same cell (same column, same row, same anchor), so the hat must sit on the head of `agent.png` in **every** frame and direction, including the up-and-down bob of the walk cycle. The head occupies about rows 2 to 12 of a cell; hat pixels may rise to row 0. Everything below the head must be fully transparent (a hat must never recolour the body). Where a hat covers hair, draw the hair-hiding pixels as part of the hat.

### Palette

Night palette of the city, from `nova-town-pixellab-brief.md` (outline `#1a1424`, violet and indigo shadows, warm window glow `#ffcf6e`, neon cyan `#4ee8ff`, pink `#ff5ec4`, green `#5cf58a`, yellow `#ffe25c`, purple `#b06cff`). Use 3 to 4 tones per material (dark, base, light, optional rim light). Style reference for body proportions and shading: `hud/public/pixel-city/town/characters/agent.png` and `folk-*.png` (see `nova-town-sprites.md`). Rarity is shown in the UI by a border colour, not in the art, but higher rarity should look richer: more tones, a small glow or accent in a neon colour.

### Suggested PixelLab workflow

`create_character_4dir` at 32 px with the style prefix from the brief (minus "city view"), then 8-direction rotate and `animate_character` `walk` (6 frames) plus an idle frame for column 0. For hats, generate the same character wearing the hat and an identical one bare-headed, and keep only the pixels that differ (so alignment is exact), then clear everything below the head.

## The 18 items

### Starter (given from the start)

| Id | Slot | Name | Description | Look to draw |
|---|---|---|---|---|
| `outfit-street` | outfit | Street Wear | A hoodie and jeans for everyday errands around the city. | Mid-grey hoodie with a lighter drawstring, dark-indigo jeans, white sneakers. A recolour of the base townsperson body is fine. Prompt: `townsperson, grey hoodie, dark blue jeans, white sneakers, short hair` |
| `outfit-office` | outfit | Office Attire | A tidy shirt and trousers for the desk crowd. | Pale blue shirt with rolled sleeves, charcoal trousers, dark shoes, small tie in warm yellow. Prompt: `townsperson, light blue shirt, charcoal trousers, small yellow tie, neat hair` |
| `outfit-overalls` | outfit | Overalls | Sturdy workwear for building things. | Orange-brown denim overalls over a cream shirt, big front pocket, work boots. Prompt: `townsperson, brown overalls, cream shirt, work boots, tool pocket` |
| `hat-beanie` | hat | Beanie | A snug knit beanie. | Teal knit beanie with a folded cuff and a small pompom, slightly lighter cuff row. |
| `hat-cap` | hat | Cap | A classic baseball cap. | Red cap with a dark brim and a button on top. Brim direction follows the facing: forward in S, SE, E, SW, W; none visible from N (back panel and adjustment strap instead). |

### Common (early quests)

| Id | Slot | Name | Description | Look to draw |
|---|---|---|---|---|
| `hat-headphones` | hat | Headphones | Big over-ear headphones for tuning out the noise. | Dark band over the head with chunky ear cups in neon pink with a cyan glow pixel. Ear cups visible from S and N, one cup from E and W. |
| `hat-flower-crown` | hat | Flower Crown | A ring of blossoms from the archive garden. | Ring of small blossoms (pink, yellow, white) with green leaves around the top of the head. |
| `hat-chef` | hat | Chef Hat | A tall white toque for whoever is cooking up tasks. | Tall puffy white toque with grey shadow folds and a dark outline; rises to row 0. |
| `outfit-raincoat` | outfit | Raincoat | A yellow slicker for waiting at the bus stop. | Yellow hooded slicker (`#ffe25c` base, darker shade), dark-green wellington boots, hood up, face visible. |
| `outfit-varsity` | outfit | Varsity Jacket | A letterman jacket for the Academy's best. | Deep-purple jacket with cream sleeves, a small gold letter on the chest (an abstract block, no readable text), dark trousers, white shoes. |

### Rare (mid-tier milestones)

| Id | Slot | Name | Description | Look to draw |
|---|---|---|---|---|
| `outfit-neon-jacket` | outfit | Neon Jacket | A glowing jacket that owns the night skyline. | Black jacket with glowing cyan and pink piping along the seams (bright, unshaded pixels so it reads in the dark), dark trousers, cyan sole lights. |
| `outfit-astronaut` | outfit | Astronaut Suit | A pressure suit for stargazers at the Observatory. | White-grey pressure suit with an orange chest panel, a clear helmet with a violet reflection (face still visible), boots and gloves in grey. |
| `hat-top-hat` | hat | Top Hat | A silk top hat fit for a banker. | Black silk top hat, tall crown, wide flat brim, thin gold band. |
| `hat-cat-ears` | hat | Cat Ears | Pointy ears, in honour of Nova the cat. | Two upright triangular ears on a dark band, dark outer fur and a pink inner ear; lime-green eye-glint pixel on the band as a nod to Nova's eyes (see `characters/cat.png`). |

### Epic (top milestones)

| Id | Slot | Name | Description | Look to draw |
|---|---|---|---|---|
| `outfit-knight` | outfit | Knight Armor | Polished plate armor for a seasoned workforce commander. | Steel plate armor (3 to 4 greys with a violet rim light), gold trim on the shoulders, red cape visible from N and the sides. Draw the head bare (no helm), because the hat slot can hold a hat. |
| `outfit-wizard` | outfit | Wizard Robe | A starry robe for a master of skills. | Deep indigo robe to the ankles with tiny cyan and yellow star pixels, wide sleeves, a gold sash; head bare. |
| `hat-wizard` | hat | Wizard Hat | A pointed hat that knows every note ever written. | Tall pointed indigo hat with a bent tip, wide brim, yellow star and a gold band. Tip rises to row 0. |
| `hat-crown` | hat | Crown | A golden crown for the ruler of a fully connected city. | Gold crown with five points, a pink and a cyan gem, bright top-left highlight, small sparkle pixel that twinkles between frames is optional. |

## Checklist per sheet

- [ ] 224 x 256 px, RGBA, transparent background
- [ ] 7 x 8 cells of 32 px, direction rows in the order above
- [ ] Outfits: feet on row 30 of every cell, same body proportions as `agent.png`
- [ ] Hats: transparent except the hat, aligned to `agent.png`'s head in every cell
- [ ] No anti-aliasing, 1 px outline `#1a1424`, night palette
- [ ] Saved as `hud/public/pixel-city/town/cosmetics/<id>.png`; add a row to the quality checks in `nova-town-sprites.md` if the pipeline needs one
