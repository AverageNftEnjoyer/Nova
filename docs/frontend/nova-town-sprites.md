# Nova Town: sprite checklist

Every piece of art the Nova Town view needs. Generate each one in the style of the Tokyo reference image and drop the files in `hud/public/pixel-city/town/raw/`. Cleanup (cropping, removing backgrounds, snapping to a pixel grid, matching colours) happens after you drop them in, so raw generator output is fine.

## Rules for every sprite

- **Camera:** 2:1 isometric, the same angle as the reference.
- **Light:** from the top-left.
- **One object per image**, centred, on plain white (or transparent), with space around it so the corner watermark can be cropped off.
- **Daytime colours.** For buildings with windows or neon, also make a `-lights` version: the same view on pure black, showing only the lit windows, signs and lamps. The engine uses it for night.
- **Mirroring:** each character and vehicle needs only two facings, **front** (walking toward the viewer, down-left) and **back** (walking away, up-left). Mirroring covers the other two directions.
- **Sizes after cleanup.** Don't worry about exact pixels when generating; just keep proportions believable:
  - ground tile: 64 × 32
  - 2×2-tile building: about 128 wide
  - person: about 16 × 32
  - car: about 48 × 32
- **File names:** the names below, with `-lights` for night overlays and `-1`, `-2` … for animation frames.

Priority: **P1** is needed for the first working version, **P2** comes after the look is confirmed.

---

## 1. Integration buildings (15)

Level 1 is a small shopfront (P1). Level 2 is a mid-rise and level 3 a landmark tower (both P2). Each level also needs a `-lights` night version.

| File name | Integration | Idea | Footprint |
|---|---|---|---|
| `telegram-l1` / `-l2` / `-l3` | Telegram | Telegraph office, paper-plane weathervane, sky-blue trim | 2×2 |
| `discord-l1` / `-l2` / `-l3` | Discord | Arcade and gaming lounge, purple neon | 2×2 |
| `slack-l1` / `-l2` / `-l3` | Slack | Colourful co-working office | 2×2 |
| `openai-l1` / `-l2` / `-l3` | OpenAI | Minimal black-and-white research lab | 2×2 |
| `claude-l1` / `-l2` / `-l3` | Claude | Warm terracotta writing studio | 2×2 |
| `grok-l1` / `-l2` / `-l3` | Grok | Observatory with a dome | 2×2 |
| `gemini-l1` / `-l2` / `-l3` | Gemini | Twin towers | 2×2 |
| `spotify-l1` / `-l2` / `-l3` | Spotify | Record store and music hall, green neon | 2×2 |
| `youtube-l1` / `-l2` / `-l3` | YouTube | Cinema or TV studio, red marquee | 2×2 |
| `gmail-l1` / `-l2` / `-l3` | Gmail | Post office | 2×2 |
| `calendar-l1` / `-l2` / `-l3` | Google Calendar | Clock tower | 2×2 |
| `brave-l1` / `-l2` / `-l3` | Brave | Library of search, lion statues at the door | 2×2 |
| `coinbase-l1` / `-l2` / `-l3` | Coinbase | Bank with columns, blue sign | 2×2 |
| `phantom-l1` / `-l2` / `-l3` | Phantom | Purple vault | 2×2 |
| `polymarket-l1` / `-l2` / `-l3` | Polymarket | Trading floor, ticker boards | 2×2 |

Evoke each brand with colour and theme; don't copy logos.

## 2. Civic buildings (5), P1

| File name | Building | Idea | Footprint |
|---|---|---|---|
| `hq` | Nova HQ | Tallest tower in town, the centrepiece, a big NOVA sign on top | 3×3 |
| `bus-depot` | Bus Depot | Garage bays, bus parked inside | 2×3 |
| `power-plant` | Power Plant | Chimney, pipes, big meter panel | 2×2 |
| `archive` | Archive | Library and records hall | 2×2 |
| `town-hall` | Town Hall | Civic building with a flag and steps | 3×2 |

Each also needs a `-lights` night version.

## 3. Lot states (3), P1

| File name | What |
|---|---|
| `lot-empty` | Fenced empty 2×2 lot with a small "coming soon" board |
| `lot-construction-1` / `-2` | Scaffolding with a crane, 2 frames for the build animation |

## 4. Filler buildings for density (12)

These make it feel like a real city. P1 for the first four, P2 for the rest.

| File name | What | Footprint |
|---|---|---|
| `midrise-concrete-1` / `-2` / `-3` | Tokyo concrete mid-rises: balconies, AC units, fire stairs, shops at street level | 2×2 |
| `apartment-1` / `-2` | Tall apartment blocks with laundry and balconies | 2×2 |
| `glass-tower-1` / `-2` | Glass office towers, rooftop garden | 2×2 |
| `brick-1` | Brick building | 2×2 |
| `shop-ramen`, `shop-izakaya`, `shop-konbini` | Small single-storey shops with awnings and signs | 1×1 |
| `shophouse-row` | Row of narrow pastel shophouses | 3×1 |

Each also needs a `-lights` night version.

## 5. Ground tiles (14), P1

All 64 × 32, flat, seamless at the edges.

| File name | What |
|---|---|
| `road-a`, `road-b` | Straight road, one per direction |
| `road-cross` | Intersection |
| `crosswalk-a`, `crosswalk-b` | Road with zebra crossing, both directions |
| `sidewalk` | Paved sidewalk |
| `plaza` | Decorative plaza paving |
| `grass` | Grass |
| `park-path` | Path through grass |
| `water-1` / `-2` / `-3` | Water, 3 frames for a shimmer loop |
| `promenade` | Waterfront edge with railing |

## 6. Elevated train line (4), P1

| File name | What |
|---|---|
| `rail-a`, `rail-b` | Viaduct track segment, both directions |
| `rail-pillar` | Support pillar |
| `rail-station` | Small elevated station platform |

## 7. Props (20)

P1 for the first ten, P2 for the rest.

| File name | What |
|---|---|
| `lamp` (+ `lamp-lights`) | Street lamp |
| `tree-1`, `tree-2` | Street trees |
| `bench` | Bench |
| `vending-red`, `vending-blue` (+ `-lights`) | Vending machines |
| `traffic-light` | Traffic light |
| `power-pole` | Utility pole with wires |
| `bus-stop` | Bus stop shelter |
| `sign-vertical-1` / `-2` / `-3` (+ `-lights`) | Hanging vertical shop signs |
| `food-stall` | Street food stall |
| `planter` | Planter box |
| `bicycle` | Parked bicycle |
| `noticeboard` | Community noticeboard (Notes) |
| `fountain-1` / `-2` / `-3` | Fountain, 3 frames (for the park) |
| `mailbox` | Mailbox |
| `trash-bin` | Bin |
| `drone` | Small delivery drone (like the reference) |

## 8. Vehicles (5)

Two facings each (front and back), so 2 images per vehicle.

| File name | What | Priority |
|---|---|---|
| `car-front`, `car-back` | Car (the code recolours it into variants) | P1 |
| `taxi-front`, `taxi-back` | Taxi | P2 |
| `bus-front`, `bus-back` | City bus (deployments ride these) | P1 |
| `train-head`, `train-car` | Train head car and middle car, side-on along the track | P1 |
| `van-front`, `van-back` | Delivery van | P2 |

## 9. Characters (4 sets)

Walk cycle: 4 frames per facing, 2 facings (front and back), plus 1 standing frame, so 9 images per set. Keep the same character identical across frames; a pixel-art tool (PixelLab or Retro Diffusion) is much better at this than Gemini.

| File name | What | Priority |
|---|---|---|
| `person-a-*` | Townsperson A (the code recolours clothes and hair into variety) | P1 |
| `person-b-*` | Townsperson B, different build or outfit | P2 |
| `agent-*` | A Nova agent: teal jumpsuit with a glowing visor, clearly different from townsfolk | P1 |
| `cat-sit`, `cat-sleep`, `cat-walk-1` / `-2` | Nova the cat | P1 |

Frame names: `person-a-front-1` … `-4`, `person-a-back-1` … `-4`, `person-a-idle`.

## 10. Not needed: drawn in code

Speech and work bubbles, status icons (!, X, check), data trails, glow and light pools, rain, snow and fog, fireworks, construction dust, hover outlines, labels and all text on signs showing live data (prices, counts, cost).

---

## Totals

| Group | P1 images | All images |
|---|---|---|
| Integration buildings | 30 (L1 + lights) | 90 |
| Civic buildings | 10 | 10 |
| Lot states | 3 | 3 |
| Filler buildings | 8 | 24 |
| Ground tiles | 14 | 14 |
| Train line | 4 | 4 |
| Props | 12 | ~26 |
| Vehicles | 6 | 10 |
| Characters | ~22 | ~31 |
| **Total** | **~109** | **~212** |

The fastest test of the look is: `hq`, 3 integration L1 buildings, 2 filler buildings, `road-a`, `road-cross`, `sidewalk`, `grass`, `lamp`, `tree-1`, `person-a` and `car` (front and back). Send those first; if they fit together, do the rest.
