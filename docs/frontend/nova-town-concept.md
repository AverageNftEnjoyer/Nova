# Nova Town: a Home that grows with your work

**Status:** Concept, not built. Harbour view shipped (unreleased, V.80 work in progress). Nova Town is the proposed second view.
**Scope:** NovaAIO HUD Home (`hud/app/home/`) and the pixel-city engine (`hud/components/pixel-city/`)
**Purpose:** Describe the Nova Town idea, what it is built from, how it grows, and what must not break.

---

## 1. The idea

Home becomes a small isometric pixel-art town that grows the way a Stardew Valley farm does, except the crops are your real work in Nova:

- Connect an integration, and its building goes up on an empty lot.
- Use it more, and the building levels up from a shopfront into a landmark.
- Deploy agents, and they walk out of Nova HQ to the building of the tool they are using and work there.
- Every completed task, deployment, note, skill and conversation adds to the town's level.
- As the level rises, the town expands with new streets, shophouse rows, parks and a train line.

A new user starts with a quiet village full of empty lots. A heavy user's town is a dense, lit-up skyline. The town is a picture of how much Nova is doing for you.

Nova Town is a second view beside **Harbour** (the side-on lofi harbour already on Home). A chip in the HUD switches between them, and the choice is saved in user settings.

## 2. Look and feel

- **Projection:** true 2:1 isometric, so you see the front, side and top of every building.
- **Style:** Hi-Bit (modern high-fidelity) pixel art:
  - a colour ramp for every material
  - lit and shaded faces
  - ambient occlusion at the bases
  - dithered glow and light pools at night
  - dense props: AC units, signs, lamps, benches, planters, vending machines, bikes
  - characters with walk cycles
- **Setting:** Singapore nightlife solarpunk, not over the top:
  - glass towers with living walls
  - pastel shophouses
  - rooftop gardens
  - a Supertree grove
  - an elevated train line
  - a waterfront along the front edge
- **Time:** the app theme sets day or night (light is day, dark is night, "system" follows the OS), and the HUD can switch it. The season follows the real calendar month and is kept subtle: blossom, a rainy season, festive lights.
- **Weather:** follows the real weather for the user's city (rain, storm, snow, fog), like Harbour.
- **HUD:** the same as Harbour. The NovaAIO wordmark is top-left, user chips top-right, the Spotify player bar is the footer, and places open popups in the pixel window style.

## 3. Buildings

### 3.1 One building per integration

Each building evokes its integration through colour and theme, never by copying a logo into the art.

| Integration | Building | Clicking it opens |
|---|---|---|
| Telegram | Telegraph office with a paper-plane weathervane | Integration status and settings |
| Discord | Arcade and gaming lounge | Integration status and settings |
| Slack | Colourful co-working office | Integration status and settings |
| OpenAI | Minimalist research lab | Integration status and settings |
| Claude | Warm terracotta writing studio | Integration status and settings |
| Grok | Observatory | Integration status and settings |
| Gemini | Twin towers | Integration status and settings |
| Spotify | Record store and music hall | Player controls |
| YouTube | Cinema or TV studio | YouTube module |
| Gmail | Post office | Schedule |
| Google Calendar | Clock tower | Schedule |
| Brave | Library of search, with lion statues | Integration status and settings |
| Coinbase | Bank | Crypto prices |
| Phantom | Purple vault | Crypto prices |
| Polymarket | Trading floor or odds parlour | Polymarket module |

**States:**
- **Not connected:** an empty lot with a "coming soon" sign. Clicking it opens that integration's setup.
- **Just connected:** the building goes up with a short construction animation (scaffolding, then reveal) that plays once.
- **Connected:** the building is built, lit and staffed. Its size depends on its level (section 4.2).

### 3.2 Civic buildings

| Building | Holds |
|---|---|
| Nova HQ (the centrepiece) | Agent Tasks; home base for every agent |
| Bus Depot | Deployments and New deployment |
| Power Plant | LLM usage and cost (Analytics) |
| Archive | Notes, memory and skills |
| Town Hall | Town level, XP, stats and next unlocks |
| Park | Chat, and Nova the cat, whose pose shows Nova's presence (online / thinking / speaking / offline) |

Every Home module and popup that exists today stays reachable from the town.

## 4. Progression

**The main rule:** progression comes only from real, persisted activity. There are no invented numbers, no random growth, and nothing resets on reload.

### 4.1 Town level and XP
- The town's XP comes from total work:
  - agent tasks completed
  - deployment runs finished
  - tool calls made
  - notes, skills and workspace files
  - conversations
- The Town Hall popup is a real progress screen: current level, the XP bar, what earned XP, and what unlocks next.
- The weights and level curve are to be tuned so early levels come quickly and late levels feel earned.

### 4.2 Building levels
- Each integration building levels up with its own usage:
  - tool runs attributed by tool name prefix (`gmail_*`, `coinbase_*`, `phantom_*`, and so on)
  - LLM calls per provider for the AI labs
- Example tiers: level 1 is a small shopfront, level 2 a mid-rise with more lights and props, level 3 a landmark tower.

### 4.3 Expansion, population and unlocks
- **Expansion:** the town grows outward in rings or districts as the town level rises. Early game shows the core and empty lots; late game fills in streets, shophouse rows and parks.
- **Population:** townsfolk on the sidewalks come from conversations and messages.
- **Milestone unlocks** (examples):

| Milestone | Unlock |
|---|---|
| First completed agent task | Fountain in the plaza |
| First deployment | Train line starts running |
| Each skill file | A wing on the Archive |
| Workspace files | Houses |
| Each milestone tier | A Supertree in the grove |

- **Celebrations:** a level-up or new building gets a small, tasteful celebration (fireworks, a banner) that plays only once. Which celebrations have played is remembered, for example in `kv_state`.

## 5. Agents at work

- Each live agent task is a distinct character. It leaves Nova HQ and walks the streets (pathfinding on the road grid) to the building matching the tools it is using (from `AgentTask.toolCalls`).
- There it works, with an animated bubble.
- **Queued** agents wait at HQ, **paused** agents show "!", **failed** agents show a red X and walk home, and **completed** agents walk home and leave.
- Glowing **data trails** flow along the streets from HQ to wherever agents are working.
- Hovering an agent shows its task name and status; clicking opens Agent Tasks.
- Each active deployment run is a bus on the roads.

## 6. Data sources

To confirm during implementation. Candidates already persisted today:

| Source | Location | Feeds |
|---|---|---|
| `agent_tasks` | `nova.db` | Agents on the streets, completed-task XP |
| `tool_runs` | `nova.db` | Per-integration building levels |
| `llm_usage` | `nova.db` | AI lab levels, Power Plant |
| `deployments`, `deployment_runs` | `nova.db` | Buses, Bus Depot, deployment XP |
| missions | `nova.db` | XP |
| notes | `nova.db` | Archive, XP |
| chat threads and messages | `nova.db` | Population, XP |
| `kv_state` | `nova.db` | Celebrations already shown, view setting |
| Integration configs | `nova.db` | Which lots are built |
| Workspace docs (`SKILL.md`, MEMORY, SOUL, USER, AGENTS) | user-context root (`src/db/paths.js`) | Archive wings, houses |

**Likely new endpoint:** `GET /api/town`. It aggregates lifetime and recent counts for the active user in SQLite, is cheap and cached, and never returns secrets. Live state (running tasks, active runs, presence, weather) keeps coming from the hooks Home already uses.

## 7. Constraints

- **Features:** every current Home feature keeps working; only the presentation changes.
- **Honest data:** no fake data, placeholder stats or demo log streams.
- **Layout:** works from 1024x768 to 4K with no page scrollbar. The town may pan (drag, mouse wheel, arrow keys), clamped to its bounds and centred on HQ at first load. Nothing clickable sits under the HUD bar or the Spotify bar.
- **Performance:** this is an always-open Electron app:
  - bake static layers
  - pre-render building sprites per palette, level and state
  - depth-sort only moving things against nearby buildings
  - throttle frames and pause when hidden
  - cap the number of walkers
- **Accessibility:** buildings are focusable buttons with labels, and agents are reachable through Agent Tasks.
- **Rendering:** crisp pixels from fillRect at logical resolution with integer upscaling, no anti-aliased paths.

## 8. Open questions

1. **Placement:** is growth fully automatic, or can the user place or move buildings on free lots, Stardew-style? Automatic is simpler; manual placement is more game-like and needs a saved layout.
2. **Curve:** how fast should the town grow? Should it ever shrink (for example, a building dims if its integration disconnects)?
3. **Names:** do the view and setting keep the name "district" or become "town"?
4. **Other pages:** should they adopt the pixel theme next, and in what order?

## 9. Build order

1. Isometric engine: tiles, shaded boxes, props, depth sorting, camera and panning.
2. Static town: civic buildings, empty integration lots, roads, waterfront, day and night, weather.
3. Integration buildings and their states (lot, construction, built), wired to the existing popups.
4. Agents, pathfinding, data trails, buses and townsfolk from live data.
5. `GET /api/town`, then levels, expansion, unlocks and the Town Hall progress popup.
6. HUD view switch, saved setting, celebrations.
7. Verification: Playwright screenshots (early and late town, day and night, three sizes), smoke tests, type check, lint, and the V.80 version records in the version file, README and CLAUDE.md.
