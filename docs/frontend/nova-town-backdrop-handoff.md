# Nova Town backdrop: generation handoff

Paste this to the session that has the image model and the PixelLab MCP. Another session is building the engine side (`hud/components/pixel-city/backdrop/`, the Home view switch, hotspots, live actors) at the same time.

**Do not edit anything under `hud/components/pixel-city/`, `hud/app/home/` or `hud/lib/settings/` in this session.** Your job is producing image files only. Drop them at the paths below and stop; the engine session picks them up. Never commit.

Reference image: `C:\Nova\.claude\image_845cef19.jpeg` (1024 x 572). Style, palette and layout details are in `docs/frontend/nova-town-pixellab-brief.md` sections 1-2; read that first.

---

## Part A: the master backdrop (image model)

The Home view will show one painted city image, scaled by an integer factor, with buttons and live sprites on top. We need the reference scene again, bigger and in variants. Same composition, same buildings in the same places, same style.

### Output

Folder: `hud/public/pixel-city/town/backdrop/`

| File | What |
|---|---|
| `town-night.png` | The reference scene as-is, larger. Night/dusk, all lights on, people and vehicles present. This is the fallback if the clean renders fail |
| `town-night-clean.png` | Same scene, night, **no people, no horse cart, no train, no vehicles**. Streets and platforms empty. This is the one the engine uses |
| `town-day-clean.png` | Same scene as `town-night-clean`, midday: blue sky, sunlight from the upper left, windows are dark glass, neon off, street lamps off, fountain still running |
| `town-night-clean-nosigns.png` (optional) | `town-night-clean` with every sign board blank (glowing panel, no letters). Only if the model can do it without redrawing the scene |

Rules:

- **PNG**, never JPEG. Largest size the tool allows, 16:9, at least 2048 wide (2048 x 1152 ideal). If the tool only does 1024 wide, still deliver it; note the size.
- Use the reference image as the **image input / reference** on every render so the composition stays the same. Edit or inpaint from `town-night-clean` to make `town-day-clean`; do not prompt the day version from scratch.
- Keep the **NOVA** arch sign and the round N emblem on the central tower. All other sign text may stay as in the reference; the engine overlays its own labels.
- No new watermark, no border, no vignette.

### Prompts

Night, clean (start here):

> Hi-bit pixel art isometric city at dusk, exactly this composition and these buildings: a central glass skyscraper with a glowing round N emblem and a huge arched NOVA sign held between two steel lattice pylons; to its left a dark blue glass office tower; far left a grey stone observatory with a dome, a tan studio with a magenta neon sign, a cluster of brown Tudor houses; bottom left a red brick post office with a red POST sign and a small domed kiosk; centre a dark arcade with orange neon, a cinema with a red neon marquee and a record shop below, a narrow betting parlour with red ODDS neon, two co-working blocks with green COWORK neon, a low red brick town hall with green neon on a raised stone platform; right a brown telegraph office with a tall mast, a white lab with blue LAB neon, a brown brick depot, a clock tower, a grey apartment block; a park with a glowing cyan fountain, benches, round trees, conifers and warm lamp posts; an elevated train viaduct crossing the main road; dark asphalt streets with white crossings, stone stairs and retaining walls, pedestrian overpass. Violet to purple sky with a silhouetted skyline across the top. Warm lit windows, neon in pink, cyan, green, red, orange and yellow, dark 1px outlines, crisp pixels, no anti-aliasing. **Empty streets: no people, no vehicles, no horse cart, no train.**

Day, clean (edit of the night render):

> Same image, same pixels, converted to midday: clear blue sky with a few pixel clouds, sunlight from the upper left with soft shadows to the lower right, all windows dark reflective glass, all neon signs switched off (dark panels), street lamps off, fountain still running, trees and grass brighter, streets light grey. Nothing moved, nothing added, still no people or vehicles.

Night, as reference (fallback):

> The same prompt as night-clean without the last sentence; people, horse cart and train allowed.

### Report back

For each file: exact pixel size, and whether the model preserved the composition (which buildings moved or changed). Do not retouch by hand.

---

## Part B: moving sprites (PixelLab MCP)

Only the things that move or change on top of the backdrop. Buildings, roads, trees and props are **not** needed; they are in the backdrop.

Folder: `hud/public/pixel-city/town/sprites/`. Transparent background on everything. Palette and style prefix: `nova-town-pixellab-brief.md` sections 1-2. Match the reference's pixel density: a person is about 22-24 px tall, a train car about 90 x 50 px, at the reference's 1024 px width. If the master render comes back at 2048 wide, everything doubles: generate at the sizes below and we scale x2 in code, so do **not** double them yourself.

### B1. Characters (`create_character_4dir`, then `animate_character`)

Size 32 px. Animations: `walk`, `idle`. Export each as a ZIP into `sprites/characters/<name>/` (PixelLab's export keeps rotations, animations and keypoints).

| Name | Description |
|---|---|
| `person-a` | townsperson, casual jacket and trousers, short hair, dark outline, small head, readable face |
| `person-b` | townsperson, long coat and scarf, long hair |
| `agent` | Nova agent, teal jumpsuit, glowing cyan visor, slim, clearly not a townsperson |
| `cat` | small black cat, green eyes; animations `sit`, `sleep`, `walk` |

### B2. Vehicles (`generate_image` for the first view, then `rotate` to 4 directions, projection isometric)

| Name | Canvas | Prompt (after the style prefix) |
|---|---|---|
| `train-head` | 96 x 64 | isometric white and grey elevated train head car, rounded cab, blue window band, warm lit windows |
| `train-car` | 96 x 64 | isometric white and grey elevated train middle car, blue window band, warm lit windows |
| `bus` | 96 x 64 | isometric green city bus with white roof, lit windows |
| `horse-cart` | 96 x 64 | isometric wooden horse-drawn cart with brown horse and a lantern (2 walk frames) |

Files: `sprites/vehicles/<name>-<dir>.png` with `dir` = `ne`, `nw`, `se`, `sw` as PixelLab names them, plus `-1`/`-2` for the cart frames.

### B3. Effects (`generate_image`, then `animate_with_text_v2` for frames)

| Name | Canvas | Frames | Prompt (after the style prefix) |
|---|---|---|---|
| `fountain-jet` | 64 x 64 | 4 | glowing cyan water jet and splash only, no basin, transparent, for layering on a stone fountain |
| `neon-flicker-pink`, `-cyan`, `-green`, `-red`, `-orange`, `-yellow` | 48 x 16 | 2 | blank glowing neon sign panel, colour as named, frame 2 slightly dimmer |
| `window-glow` | 16 x 16 | 1 | warm lit window pane, soft pixel glow |
| `lamp-glow` | 32 x 32 | 1 | warm lamp light pool, dithered, transparent |
| `bubble-work`, `bubble-wait`, `bubble-paused`, `bubble-failed`, `bubble-done` | 16 x 16 | 2 | tiny pixel speech bubble with a symbol: gear / hourglass / exclamation / cross / check |

Files: `sprites/effects/<name>-<frame>.png`.

### B4. Order

B1 `person-a` and `agent` first, then B2 `train-car`, `train-head`, then B3 `fountain-jet`, then the rest. Post the folder listing when each group lands.

---

## What not to do

- No buildings, tiles, trees or props (they live in the backdrop).
- No text baked into sprites.
- No code edits, no commits, no changes to `docs/` beyond adding a `REPORT.md` next to the images with sizes and notes.
