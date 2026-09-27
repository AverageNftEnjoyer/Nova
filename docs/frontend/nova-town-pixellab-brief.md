# Nova Town: PixelLab asset brief

**Reference image:** `C:\Nova\.claude\image_845cef19.jpeg` (1024 x 572, "NOVA" city at dusk). Copy it to `docs/frontend/reference/nova-town-reference.jpg` before sharing this brief so the path survives.
**Goal:** every sprite the District view (`hud/components/pixel-city/district/`) needs to look like that image instead of the code-drawn boxes it uses today.
**Generator:** [PixelLab](https://www.pixellab.ai) (web app or API). Tool names below are PixelLab's.
**Drop folder:** `hud/public/pixel-city/town/raw/<group>/<file>.png`. Raw generator output is fine; cropping, grid snapping and palette matching happen on our side.

Companion docs: `nova-town-concept.md` (what the town means), `nova-town-sprites.md` (the older generator-agnostic checklist; this brief supersedes its sizes and style notes).

---

## 1. What the reference looks like (match all of this)

| Aspect | In the reference |
|---|---|
| Camera | 3/4 isometric city view, roughly 2:1 diamond tiles, camera rotated 45 degrees so every building shows a **front-left face, a front-right face and a roof**. Light from the upper left, right faces slightly darker |
| Time | Dusk. Violet-to-purple sky (dark at the top, lighter near the skyline), a silhouetted row of distant rooftops across the top edge, every window lit warm, neon signs on, street lamps on |
| Pixel density | About 1 pixel = 1 screen pixel at 1024 wide. A two-storey shop is ~110 px wide and ~120 px tall; people are ~22 px tall; a storey is ~20 px |
| Line work | Dark 1 px outlines on every silhouette, clean pixel clusters, no anti-aliasing, no gradients (dithering only in the sky and the fountain glow) |
| Materials | Red and brown brick, tan/cream plaster with dark timber framing (Tudor houses), grey concrete and stone, blue and teal glass curtain walls, brown/red roof tiles, grey slate, steel lattice trusses |
| Signs | Neon lettering in pink, cyan, green, red, orange, yellow and purple, mounted on dark sign boards, often with vertical hanging signs on the building corner |
| Streets | Dark asphalt with white lane lines and zebra crossings, light grey concrete sidewalks with kerbs, stone stairs and retaining walls between levels, a pedestrian overpass, an elevated train viaduct crossing the main road |
| Greenery | Round dark-green street trees, conifers, low hedges, planters, a park with a cyan-glowing fountain, benches and lamp posts |
| Street life | ~20 townsfolk in varied clothes, a horse-drawn cart, a white-and-grey elevated train, red and blue vending machines, a "NOVA CITY" noticeboard, warm double-headed lamp posts |

### Palette (sampled by eye; approximate)

Use these as PixelLab's **forced palette** where the tool supports it, otherwise paste them into the prompt as colour words.

| Use | Hex |
|---|---|
| Sky (top to horizon) | `#3d2a63` `#5b3f8c` `#7a5aa6` |
| Distant skyline silhouette | `#2a1f45` |
| Asphalt / lane line | `#3d3f52` / `#d8d4c8` |
| Sidewalk / kerb | `#7d7f93` / `#9a9cae` |
| Brick dark / brick light / mortar | `#7a3b2e` / `#a0523c` / `#c98a6a` |
| Plaster / timber | `#d9c3a3` / `#4a2e22` |
| Concrete dark / light | `#8a8ca0` / `#b0b2c4` |
| Glass dark / mid / lit | `#1e2f52` / `#3e6a9e` / `#6aa0d8` |
| Roof tile brown / slate grey | `#7b3f34` / `#5b5f74` |
| Window glow / bright | `#ffcf6e` / `#ffe6a3` |
| Neon pink / cyan / green | `#ff5ec4` / `#4ee8ff` / `#5cf58a` |
| Neon red / orange / yellow / purple | `#ff4a4a` / `#ffa244` / `#ffe25c` / `#b06cff` |
| Grass / hedge / canopy dark / canopy light / conifer | `#3f7c4a` / `#2e5e3a` / `#2f6b3d` / `#4a8f4f` / `#24503a` |
| Fountain water / glow | `#5fd6ff` / `#a8ecff` |
| Lamp light | `#ffc46b` |
| Train body / train trim | `#e8ecf2` / `#6c7080` |
| Outline | `#1a1424` |

---

## 2. Rules for every generation

1. **Style prompt prefix** (put this in front of every prompt):
   `hi-bit pixel art, isometric city view, 45 degree camera, dusk, violet sky, warm lit windows, neon signs, dark 1px outlines, crisp pixel clusters, no anti-aliasing, detailed, Nova City`
2. **Negative prompt:** `blurry, gradients, anti-aliasing, photo, 3d render, text, letters, words, watermark`
3. **Background:** transparent (PixelLab toggle). One object per image, centred, small margin.
4. **Camera settings:** view `high top-down`, direction `south-east` (front faces toward the lower-left and lower-right), projection `isometric` wherever the tool offers it. Light from the top-left.
5. **No readable text.** Leave every sign as a **blank glowing neon panel** in the right colour. The engine letters signs itself (`font.ts`, `drawTextOnFace`) so names, prices and CLOSED states stay live. If PixelLab insists on writing letters, generate anyway; we inpaint the panel blank.
6. **Night first, day second.** The reference is dusk, so `<name>.png` is the dusk/night version with lights on. Then produce `<name>-day.png` with PixelLab **inpaint/edit** ("same building, midday, blue sky light, all windows dark glass, neon off") so the silhouette is pixel-identical. Disconnected/CLOSED integrations are darkened in code; no extra file.
7. **Scale.** Ground tile is a **64 x 32 diamond** (one lot tile). One storey is about 20 px. Canvas sizes below are the frame to generate into; the object should fill it.
   - 1x1 lot object: 64 wide
   - 2x2 lot building: 128 wide
   - 3x3 lot building: 192 wide
   - 2x3 / 3x2 lot: 160 wide
   - person: 32 x 32 canvas, figure ~24 px tall
   - vehicle: 96 x 64
8. **PixelLab limits to plan around:** `generate_image` (Pixflux) max 400 x 400; style-reference generation (Bitforge) max 200 x 200; `create_isometric_tile` 16-64 px; characters 32-168 px; `animate_with_text_v2` 32-256 px; `rotate` for 4/8 directions. Anything taller than 400 px (only Nova HQ) is generated in parts.
9. **Style reference.** For the first building, use the reference image cropped to the POST building (bottom-left) as the style reference in Bitforge mode at 128 px. Once that first result matches, use *our* accepted sprites as the style reference for everything after, so the set stays consistent.
10. **File names:** exactly the names below, lowercase, `.png`. Animation frames `-1`, `-2` ... Day variants `-day`. Character exports keep PixelLab's ZIP layout inside `characters/<name>/`.
11. **Priority:** **P1** = needed to ship the first sprite-based District. **P2** = after the look is confirmed. **P3** = nice to have.

---

## 3. Asset list

### 3.1 Nova HQ, the landmark (P1)

Tool: `generate_image` (Pixflux, 400 x 400 max), transparent background. Three parts, stacked by the engine; generate the base first and use it as the init image for the others so the glass matches.

Reference cue: centre of the image. A tall glass-and-steel tower, cyan-blue curtain wall, a glowing round "N" emblem on the facade, topped by a huge arched sign held between two steel lattice truss pylons.

| File | Canvas | Prompt (after the prefix) |
|---|---|---|
| `hq-base` | 192 x 200 | `isometric glass skyscraper base, 3x3 footprint, blue and cyan glass curtain wall, lit floors, dark steel frame, grand glass entrance lobby with warm light, planters and lamp posts at the door` |
| `hq-mid` | 192 x 200 | `middle section of the same glass skyscraper, repeating lit floors, large round glowing emblem panel in the centre of the facade, empty circular light` |
| `hq-crown` | 192 x 160 | `top of a glass skyscraper, roof with a huge arched blank neon sign board held between two dark steel lattice truss towers, antennas, warm and cyan lights` |
| `hq-emblem` | 32 x 32 | `round glowing golden neon emblem, empty circle, isometric sign face` (the engine draws the N inside) |

Also `hq-base-day`, `hq-mid-day`, `hq-crown-day` (inpaint edits).

### 3.2 Civic and workplace buildings the engine already has (P1)

Tool: `generate_image` or Bitforge with style reference, transparent. These are the buildings in `district/map.ts` (`BUILDINGS`). Each is one image plus its `-day` edit.

| File | Engine kind | Footprint | Canvas | Reference cue | Prompt (after the prefix) |
|---|---|---|---|---|---|
| `post` | `post` (Gmail / Calendar, opens Schedule) | 2x3 | 160 x 160 | Bottom-left "POST": three-storey red brick, red blank sign board over the door, arched warm windows, grey slate roof, iron railings | `isometric three storey red brick post office, tall arched windows glowing warm, red blank neon sign board above a double door, grey slate roof, iron fence` |
| `depot` | `depot` (Deployments) | 2x3 | 160 x 180 | Right "DEPOT" x2: a brown brick multi-storey block with a pink blank sign, plus a low garage with an open bay | `isometric brown brick bus depot, low garage with open bay and a parked bus inside, taller brick office block behind with pink blank neon sign, rooftop water tank` |
| `lab` | `lab` (AI providers, default workplace) | 3x3 | 192 x 180 | Right-centre "LAB": pale grey and white modern block, blue neon blank sign, big cool-blue windows | `isometric modern research lab, white and pale grey concrete, wide cool blue windows, rooftop dishes and vents, blue blank neon sign, clean minimal` |
| `parlour` | `parlour` (Polymarket) | 2x3 | 160 x 160 | Centre "ODDS": dark narrow building, red blank neon sign, smaller yellow-orange sign below, tall thin windows | `isometric narrow betting parlour, dark facade, red blank neon sign, orange blank sign strip below it, small ticker board, tall thin lit windows` |
| `bank` | `bank` (Coinbase / Phantom, opens Crypto) | 2x3 | 160 x 160 | Not in the reference. Match the POST building's massing | `isometric stone bank with four columns and wide steps, blue blank neon sign, gold trim, tall lit windows, vault door glimpsed inside` |
| `comms` | `comms` (Telegram / Discord / Slack, opens Integrations) | 3x3 | 192 x 180 | Right "TELEGRAPH": brown timber-and-brick office with a peaked roof, tall radio mast and wires | `isometric telegraph office, brown brick and timber, steep peaked roof, tall antenna mast with blinking light and wires, blank neon sign board` |
| `library` | `library` (Notes, web research) | 3x2 | 160 x 140 | Not in the reference. Match the TOWN HALL massing | `isometric library and archive, tan stone, wide steps, tall reading room windows glowing warm, small dome skylight, blank sign board over the entrance` |
| `cinema` | `cinema` (YouTube / Spotify) | 3x2 | 160 x 160 | Centre "CINEMA" + "RECORDS": dark brick with a red neon marquee, a yellow-orange blank sign below for the record shop | `isometric cinema, dark brick, red blank neon marquee with warm bulbs, poster frames, orange blank sign for a record shop on the ground floor, rooftop billboard` |
| `power` | `power` (Analytics) | 3x2 | 160 x 180 | Not in the reference. Industrial like the DEPOT garage | `isometric small power station, grey concrete hall, tall brick chimney with a red light, pipes, transformer yard, big blank meter panel on the wall` |
| `town-hall` | new (Town level / stats popup) | 3x2 | 160 x 130 | Centre-bottom "TOWN HALL": low red brick civic hall on a raised stone platform, green blank neon sign, flag | `isometric low red brick town hall on a raised stone platform with steps, green blank neon sign, flagpole with a flag, warm lit windows, lamp posts` |

### 3.3 Integration buildings visible in the reference (P1 for level 1)

Tool: same as 3.2. Level 1 is the shopfront in the reference. Level 2 (mid-rise) and level 3 (landmark) are P2: generate them by **inpainting extra floors** onto the level-1 sprite so the ground floor stays identical.

| File | Integration | Footprint | Canvas | Reference cue | Prompt (after the prefix) |
|---|---|---|---|---|---|
| `observatory-l1` | Grok | 2x2 | 128 x 160 | Far left "OBSERVATORY": grey stone block with a domed telescope roof, cyan blank sign | `isometric grey stone observatory, round dome with telescope slit on the roof, cyan blank neon sign, small lit windows` |
| `studio-l1` | Claude | 2x2 | 128 x 130 | Left "STUDIO": tan/terracotta building, magenta blank sign, vertical hanging sign | `isometric warm terracotta writing studio, magenta blank neon sign, vertical hanging blank sign on the corner, big warm windows, rooftop plants` |
| `arcade-l1` | Discord | 2x2 | 128 x 130 | Centre-left "ARCADE": orange neon over a dark shopfront, purple glow inside | `isometric arcade and gaming lounge, dark facade, orange blank neon sign, purple light spilling from the windows, marquee bulbs` |
| `records-l1` | Spotify | 2x2 | 128 x 120 | Under CINEMA "RECORDS": yellow-orange blank sign, small shop | `isometric record store, small brick shop, yellow blank neon sign, green light inside, posters, awning` |
| `cowork-l1` | Slack | 2x2 | 128 x 140 | Centre "COWORK" x2: two-tone modern block with green blank signs and glass ground floor | `isometric colourful co-working office, glass ground floor, green blank neon sign, coloured window frames, rooftop garden` |
| `clock-tower-l1` | Google Calendar | 2x2 | 128 x 200 | Right "CLOCK": narrow tower with a lit clock face near the top, pink/cyan vertical sign | `isometric narrow clock tower, brick and stone, blank round clock face near the top, pointed roof, vertical blank neon sign, lit lantern windows` |
| `lab-l1` | OpenAI | shares `lab` from 3.2 | | | |
| `telegraph-l1` | Telegram | shares `comms` from 3.2 | | | |
| `cinema-l1` | YouTube | shares `cinema` from 3.2 | | | |
| `post-l1` | Gmail | shares `post` from 3.2 | | | |
| `odds-l1` | Polymarket | shares `parlour` from 3.2 | | | |

### 3.4 Integration buildings not in the reference (P2)

Extrapolate in the same style.

| File | Integration | Footprint | Canvas | Prompt (after the prefix) |
|---|---|---|---|---|
| `twin-towers-l1` | Gemini | 2x2 | 128 x 200 | `isometric pair of slim glass towers joined by a skybridge, blue and teal glass, purple blank neon sign` |
| `search-library-l1` | Brave | 2x2 | 128 x 140 | `isometric stone library of search, two lion statues at the door, orange blank neon sign, tall arched windows` |
| `bank-l1` | Coinbase | shares `bank` from 3.2 | | |
| `vault-l1` | Phantom | 2x2 | 128 x 130 | `isometric purple vault building, dark stone, round steel vault door, purple blank neon sign, purple glow` |

### 3.5 Filler buildings for density

Tool: same as 3.2. No signs needed (or one blank panel).

| File | Footprint | Canvas | Priority | Reference cue | Prompt (after the prefix) |
|---|---|---|---|---|---|
| `glass-tower-1` | 2x2 | 128 x 260 | P1 | Left of HQ: dark blue glass office tower, ~12 floors | `isometric dark blue glass office tower, twelve floors of lit and dark windows, flat roof with vents` |
| `apartment-1` | 2x2 | 128 x 220 | P1 | Far right: tall grey apartment block with balconies and a vertical sign | `isometric grey concrete apartment block, balconies with laundry, small warm windows, vertical blank neon sign on the corner` |
| `tudor-house-1`, `-2`, `-3` | 1x1 | 64 x 90 | P1 | Left cluster and bottom-right: cream plaster, dark timber framing, steep brown tiled roofs | `isometric small Tudor town house, cream plaster with dark timber framing, steep brown tiled roof, chimney, warm windows` |
| `brick-warehouse-1` | 2x2 | 128 x 130 | P2 | Bottom-right: long brick warehouse with a vertical pink sign | `isometric brick warehouse, loading door, high windows, vertical blank neon sign, flat roof` |
| `shophouse-row` | 3x1 | 192 x 110 | P2 | Centre: narrow shops side by side with awnings and signs | `isometric row of three narrow shophouses, different colours, awnings, blank neon signs, upstairs windows lit` |
| `pagoda-tower` | 1x1 | 64 x 140 | P2 | Centre-left: narrow dark tower with tiered roofs and a yellow sign | `isometric narrow pagoda-style tower, tiered dark roofs, yellow blank neon sign, red lanterns` |
| `kiosk-dome` | 1x1 | 64 x 60 | P2 | Bottom-left: round kiosk with a dome roof and a small sign | `isometric small round kiosk with a dome roof, blank sign disc, lit window` |

### 3.6 Ground tiles and terrain (P1)

Tool: `create_isometric_tile` (64 px, `thick tile` shape for anything with a visible edge, `thin tile` for flat ground). Where a connected set is needed, `create_tiles_pro` with shape `isometric` at 64 px. Style prompt prefix still applies; no outlines on flat ground tiles.

| File | Tool | What |
|---|---|---|
| `asphalt` | isometric tile | plain dark asphalt |
| `road-autotile` | tiles pro, **path autotile** (18 pieces) | `dark asphalt road with white lane line through light grey concrete sidewalk with kerb` (straight, corner, T, cross come out of the set) |
| `crosswalk-a`, `crosswalk-b` | isometric tile | asphalt with white zebra stripes, one per direction |
| `sidewalk` | isometric tile | light grey concrete paving with kerb line |
| `plaza` | isometric tile | decorative stone plaza paving, two tones |
| `grass` | isometric tile | park grass |
| `grass-to-plaza` | tiles pro, **terrain transition** (16 pieces) | grass edged with stone plaza |
| `park-path` | tiles pro, path autotile | `tan gravel path through grass` |
| `water-1`, `-2`, `-3` | isometric tile | deep teal bay water, three shimmer frames |
| `grass-to-water` | tiles pro, terrain transition | `grass to teal water with a stone quay edge` |
| `promenade` | isometric tile, thick | boardwalk with railing on the water side |

### 3.7 Level changes, viaduct and overpass (P1)

Tool: `generate_image`, transparent. The reference sits blocks on raised stone platforms with stairs between them and runs a train viaduct over the main road.

| File | Canvas | Prompt (after the prefix) |
|---|---|---|
| `retaining-wall-a`, `-b` | 64 x 48 | `isometric stone retaining wall segment, one tile long, top edge kerb, dark base` (both directions) |
| `stairs-a`, `-b` | 64 x 48 | `isometric stone staircase one tile wide with side walls, rising one level` (both directions) |
| `overpass-a`, `-b` | 128 x 80 | `isometric pedestrian overpass, concrete deck on two pillars, railings, lamp` |
| `rail-a`, `-b` | 64 x 80 | `isometric elevated train viaduct segment, concrete deck on a pillar, steel rails` |
| `rail-pillar` | 32 x 80 | `isometric concrete viaduct pillar` |
| `rail-station` | 160 x 100 | `isometric small elevated station platform with a roof, stairs down, lit signs` |

### 3.8 Park and props

Tool: `generate_image`, transparent. Fountain animation via `animate_with_text_v2` from frame 1.

| File | Canvas | Priority | Prompt (after the prefix) |
|---|---|---|---|
| `fountain-1` .. `-4` | 96 x 96 | P1 | `isometric round stone fountain with a glowing cyan water jet and basin, wet rim` (4 frames, water loop) |
| `tree-round-1`, `-2` | 48 x 64 | P1 | `isometric round dark green street tree, thin trunk, two-tone canopy` |
| `tree-conifer` | 40 x 72 | P1 | `isometric tall conifer tree, layered dark green` |
| `hedge-a`, `-b` | 64 x 32 | P1 | `isometric low trimmed hedge, one tile long` |
| `planter` | 32 x 28 | P1 | `isometric concrete planter box with flowers` |
| `lamp-double` | 24 x 64 | P1 | `isometric double headed street lamp, warm glowing lamps, dark iron pole` |
| `lamp-single` | 20 x 56 | P2 | `isometric single street lamp, warm glow` |
| `bench` | 32 x 24 | P1 | `isometric wooden park bench, iron ends` |
| `noticeboard` | 48 x 48 | P1 | `isometric community noticeboard, blank header panel, pinned papers, roof` (the engine writes NOVA CITY / notes on it) |
| `vending-red`, `vending-blue` | 20 x 36 | P1 | `isometric glowing vending machine, red` / `blue` |
| `traffic-light` | 16 x 56 | P2 | `isometric traffic light on a pole` |
| `bus-stop` | 64 x 56 | P2 | `isometric bus stop shelter, glass and steel, lit` |
| `sign-vertical-1` .. `-3` | 16 x 48 | P2 | `vertical hanging blank neon sign board, pink` / `cyan` / `green` |
| `food-stall` | 64 x 56 | P2 | `isometric street food stall with awning and warm lantern` |
| `mailbox`, `trash-bin`, `bicycle` | 24 x 32 | P2 | one prop each |
| `flagpole` | 12 x 64 | P2 | `isometric flagpole with waving flag` (2 frames) |

### 3.9 Vehicles

Tool: `generate_image` for the first view, then `rotate` with projection `isometric` for the other directions. The engine needs the two front-facing directions (down-left and down-right); mirroring covers the rest only when the design is symmetric, so ask for all 4 from `rotate`.

| File | Canvas | Priority | Prompt (after the prefix) |
|---|---|---|---|
| `train-head`, `train-car` | 96 x 64 each, 4 directions | P1 | `isometric white and grey elevated train car with blue window band and warm lit windows` (head car has a rounded cab) |
| `bus` | 96 x 64, 4 directions | P1 | `isometric green city bus with white roof, lit windows` |
| `car` | 80 x 56, 4 directions | P2 | `isometric small hatchback car, single colour` (the engine recolours) |
| `horse-cart` | 96 x 64, 4 directions | P2 | `isometric wooden horse drawn cart with a brown horse and lantern` (2 walk frames) |
| `van` | 96 x 64, 4 directions | P3 | `isometric delivery van` |

### 3.10 Characters

Tool: `create_character_4dir` at 32 px, then `animate_character` for `walk` and `idle`. Export each character as a ZIP (rotations + animations + keypoints) into `characters/<name>/`. Characters get the same style prefix minus "city view"; add `full body, small head, simple readable face, dark outline`.

| Character | Priority | Description |
|---|---|---|
| `person-a` | P1 | `townsperson, casual jacket and trousers, short hair` (the engine recolours skin, hair and clothes) |
| `person-b` | P2 | `townsperson, long coat and scarf, long hair` |
| `person-c` | P2 | `townsperson, hoodie and cap, backpack` |
| `agent` | P1 | `Nova agent, teal jumpsuit, glowing cyan visor, slim, clearly different from townsfolk` (the engine recolours the suit per task status) |
| `cat` | P1 | `small black cat, green eyes`; animations `sit`, `sleep`, `walk` (Nova the cat on the park bench) |

### 3.11 Sky and backdrop (P3)

The engine draws the sky gradient, stars and the far skyline itself (`renderer.ts`). Optional: `skyline-strip` 400 x 64, transparent, `row of dark distant rooftops silhouette, flat roofs and water tanks, single dark purple colour`, tileable horizontally. Generate it as a 400 px piece and we make it seamless.

---

## 4. Order of work

**First batch (the look test, ~15 images):** `post`, `town-hall`, `cinema`, `tudor-house-1`, `glass-tower-1`, `asphalt`, `sidewalk`, `crosswalk-a`, `grass`, `tree-round-1`, `lamp-double`, `fountain-1`, `person-a` (idle), `train-car`, plus `post-day`.

We drop those into a test scene at 1024x768, 1920x1080 and 3840x2160, night and day, and compare against the reference. Only when they read as the same city do we continue in this order: rest of 3.2 -> 3.6 and 3.7 -> 3.1 (HQ) -> 3.3 -> 3.8 -> 3.9 -> 3.10 -> 3.5 -> 3.4 -> level 2/3 buildings.

## 5. What we check on delivery

- Silhouette fits its footprint: the ground contact of a 2x2 building is a 128 x 64 diamond, walls rise vertically, roof edges run at 2:1 slopes.
- Two visible faces plus roof, light from the top-left, right face darker.
- Outlines are 1 px and dark, colours come from the palette above (a few extra ramps are fine).
- No baked text; sign panels are blank glowing shapes.
- `-day` variants are pixel-identical in silhouette to the night version.
- Characters are 24 px tall at rest, feet on the bottom row, 4 directions with matching proportions.
- Tiles are seamless with their neighbours (tiles-pro sets) and 64 x 32 after cropping.
- Transparent background, no halo pixels.

## 6. Drawn in code, do not generate

Sign lettering and all text, CLOSED boards, speech and work bubbles, status icons, data trails, light pools and glow, rain, snow, fog, fireworks, construction dust, hover outlines, the sky gradient, stars and the moon, the far skyline (unless 3.11 is used), LED tickers, clock hands, the N inside the HQ emblem.

## 7. Totals

| Group | P1 images | All images (incl. `-day`, frames, directions) |
|---|---|---|
| Nova HQ | 8 | 8 |
| Civic / workplace buildings | 20 | 20 |
| Integration buildings (visible) | 12 | ~36 with L2/L3 |
| Integration buildings (extrapolated) | 0 | 6 |
| Filler buildings | 10 | 18 |
| Ground tiles and terrain | ~60 (autotile and transition sets) | ~60 |
| Level changes and viaduct | 11 | 11 |
| Park and props | 18 | ~34 |
| Vehicles | 12 | ~30 |
| Characters | 3 characters (ZIPs) | 5 characters |
| **Total** | **~150** | **~230** |

Engine note for whoever wires these in: adopting this set means the District moves from 32 x 16 tiles (`HALF_W 16` / `HALF_H 8` in `district/iso.ts`) to 64 x 32, and `district/buildings.ts` bakes from PNGs instead of `drawBox`. Live overlays (windows, tickers, LEDs, signs) keep their anchors, so the anchor data in `BakedBuilding` stays.
