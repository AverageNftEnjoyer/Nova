# U.B Agents City building rooms

Every clickable building on Home (`/home`) opens its own **room**: a large pixel window with the building's picture
along the top, its live status on plaques (connection lamp, building level and uses from `GET /api/town`, or the place's
live tag), and tabs for what the building does:

- **Data** tabs show the module that place has always shown (Bank -> crypto prices, U.B Agents HQ -> agent tasks, ...).
- **Connect & settings** is the integration's own setup panel from `/integrations` (API keys, OAuth, enable / disable,
  test, settings), driven by the same controller the page uses
  (`hud/app/integrations/modules/hooks/use-integrations-controller.ts`), so saving and secret masking are identical.
  The `/integrations` page keeps working and is linked from each room's frame.

Quests, the tutorial, Town Hall's building list, a resident's "set up" button and the music window's "Setup" all open
the matching room's Connect tab. News has no building and keeps the `/integrations` page.

## Deep links

Home reads `?room=<room id>[&section=<section id>][&tab=describe|task|automation]` once on mount, opens that room (valid ids only;
the section only when the room has it; `tab` only for the Depot's `new-deployment` section), then removes those parameters with
`history.replaceState`. The retired `/deployments` page redirects here: `/deployments` -> `/home?room=depot`, and
`/deployments?mode=simple|advanced&kind=task|automation` -> `/home?room=depot&section=new-deployment&tab=...`. U.B Agents HQ's
"Deployments" frame link opens the Depot room.

## Code

| Piece | File |
|---|---|
| Registry (every room: id, place, building, integration, backgrounds, colours, sections, page link) | `hud/app/home/components/rooms/room-registry.ts` |
| Room shell (window, vista, status plaques, tabs) | `hud/app/home/components/rooms/building-room.tsx` |
| Background picture + themed fallback | `hud/app/home/components/rooms/room-backdrop.tsx` |
| Connect & settings section | `hud/app/home/components/rooms/room-integration-setup.tsx` |
| Depot's deployments overview | `hud/app/home/components/rooms/room-deployments-panel.tsx` |
| Hotspot -> room wiring, data panels (`renderRoomPanel`) | `hud/app/home/components/home-main-screen.tsx` |
| Styles | `hud/app/styles/pixel-ui.css`, section "Building rooms" |

To add a room or a tab: add the room (or a section) to `SPECS` in the registry; a new data panel also needs a
`RoomPanelId` and a case in `renderRoomPanel`. Never invent data for a panel: draw it from an existing hook.

## Background pictures

Put pictures in **`hud/public/pixel-city/rooms/`**, named **`<room id>.webp`** (a `.png` with the same name works
too; `.webp` is tried first). A missing picture is fine: the room shows a themed pixel backdrop in the building's
colours instead, with no broken image and no layout shift.

**Size: 1600 x 900 px (16:9).** The room shows the picture as a wide vista along the top of the window (about a
quarter of the window's height, `object-fit: cover`, centred slightly above the middle), so keep the subject in a
horizontal band around the vertical centre; the top and bottom edges get cropped on most screens. Pixel art is drawn
with `image-rendering: pixelated`, so a picture at an exact multiple of its pixel size stays crisp.

| Room id | File | Building | Integration | Tabs |
|---|---|---|---|---|
| `nova-hq` | `nova-hq.webp` | U.B Agents HQ | - | Agent tasks |
| `depot` | `depot.webp` | Depot | - | Deployments |
| `power-plant` | `power-plant.webp` | Power Plant | - | Usage (analytics) |
| `noticeboard` | `noticeboard.webp` | Noticeboard | - | Notes |
| `town-hall` | `town-hall.webp` | Town Hall | - | Town (progress, all integrations) |
| `fountain-park` | `fountain-park.webp` | Fountain Park | - | Chats |
| `post-office` | `post-office.webp` | Post Office | Gmail | Schedule, Gmail |
| `bank` | `bank.webp` | Bank | Coinbase | Prices, Coinbase |
| `odds-parlour` | `odds-parlour.webp` | Odds Parlour | Polymarket | Live lines, Connect & settings |
| `cinema` | `cinema.webp` | Cinema | YouTube | Feed, Connect & settings |
| `records` | `records.webp` | Records | Spotify | Now playing, Connect & settings |
| `arcade` | `arcade.webp` | Arcade | Discord | Connect & settings |
| `cowork` | `cowork.webp` | Cowork | Slack | Connect & settings |
| `lab` | `lab.webp` | Lab | OpenAI | Connect & settings (incl. live provider) |
| `studio` | `studio.webp` | Studio | Claude | Connect & settings (incl. live provider) |
| `observatory` | `observatory.webp` | Observatory | Grok | Connect & settings (incl. live provider) |
| `gemini-tower` | `gemini-tower.webp` | Gemini Tower | Gemini | Connect & settings (incl. live provider) |
| `telegraph` | `telegraph.webp` | Telegraph | Telegram | Connect & settings |
| `clock-tower` | `clock-tower.webp` | Clock Tower | Google Calendar | Schedule, Calendar |
| `library` | `library.webp` | Library | Brave | Connect & settings |
| `vault` | `vault.webp` | Vault | Phantom | Connect & settings |

Until a picture exists, the browser console logs one 404 per missing candidate the first time a room opens in a
session (the result is remembered, so reopening does not ask again).

## Immersive rooms (`stage`)

A room whose picture has a usable painted "screen" can open as a full-viewport scene instead of the framed window.
Add a `stage` (type `RoomStageDefinition`, `room-registry.ts`) to the room's `SPECS` entry; nothing else is needed.
Rooms without `stage`, or whose picture fails to load, keep the window layout. `BuildingRoom` stays the only entry
point, so quests, Town Hall and residents open immersive rooms exactly as before.

How it works (`room-stage.tsx`): the picture is cover-fit to the viewport (never letterboxed, never altered) inside
`.stage-box`, a box with the picture's aspect ratio. Every overlay is positioned in **fractions of that box**
(0..1), so it stays locked to the artwork at any window size. The text size scales with the box (`--u` = box width /
1672), floored at 12 px.

What to measure from the PNG (sample pixels; do not eyeball):

| Field | Meaning |
|---|---|
| `aspect` | picture size in px (only the ratio is used) |
| `screen {x,y,w,h,chamfer}` | the painted screen's INNER area as fractions of the picture, safe to cover completely (inside the stone frame, clear of the chamfered corners); `chamfer` is the corner cut as a fraction of the picture width |
| `crystals {prev,next}` | optional painted buttons (`cx,cy` centre, `r` radius as a fraction of the picture WIDTH) that become previous / next tab buttons; shown only when the room has more than one section |
| `portal {cx,cy,rx,ry}` | optional painted glowing spot that becomes the room's main action; the caller passes the action (`stageAction` on `BuildingRoom`, wired in `home-main-screen.tsx`) |
| `tone` | colours sampled from the picture (`holo`, `holoMid`, `holoDeep`, `stone`, `amber`, `rug`), exposed as `--stage-*` |
| `minScreenPx` | optional; default 560 |

The depot's numbers are in `DEPOT_STAGE`: screen inner area x 428..1248, y 72..440 of 1672x941.

The menu is the room's sections drawn with `renderPanel(panel, "holo")` inside the screen (`.holo*` classes in
`pixel-ui.css`, section "Immersive rooms"): header (title, status chips, page link), tabs, scrollable body. A data
panel supports the hologram by honouring the `variant` argument (see `room-deployments-panel.tsx`). Extra painted
hotspots can be passed to `RoomStage` as `children`, positioned in % of the picture.

### The Depot's creation view (hologram "New" section)

Creating and running Nova tasks happens on the Depot's hologram screen, with the room staying open. The Depot has a third
section, **New** (`new-deployment`, `keepAlive`: it stays mounted once visited, so typed text survives switching tabs).
The painted portal ("New deployment") and every Home entry point (Agent tasks "New deployment", quests) open the Depot on it
(`setOpenRoom({ id: "depot", section: "new-deployment" })`); `BuildingRoom`'s `stageAction` names the section to switch to.

- One implementation: `NewDeploymentFlow` (`app/deployments/components/new-deployment-flow.tsx`) holds `useDeploymentManager`,
  `useDeploymentActions`, the Describe / One-off task / Automation bodies and the automation canvas (portaled to the body: it is a
  fullscreen tool). `RoomNewDeployment` (`rooms/room-new-deployment.tsx`, hologram tabs; `initialTab` picks the first tab) only draws
  its own chrome around it. The old popup and the `/deployments` page are gone.
- Skin: scoped under `.holo-new .holo-flow` in `pixel-ui.css` ("Depot creation view"); the task form's pickers get `.holo-select*`
  classes through `AdvancedTaskForm tone="holo"`. The window layout (picture failed to load) renders the same view in the window panel.
- After a launch the room switches to **Runs** with a notice; runs there carry Approve / Deny / Cancel run and the budget state. The Depot has no
  page link: the room is the runs view.
- Escape: an open picker menu or the canvas takes it first; in New it returns to Runs, a second Escape leaves the room.
- `preloadNewDeploymentFlow` (`new-deployment-flow-lazy.tsx`) runs on portal hover/focus.

Compact fallback: below 700 px wide, or when the cover-fit screen would be narrower than `minScreenPx` on screen, the
menu leaves the picture and stacks under it as a full-width themed panel (the portal action becomes a button), so
1024x768 and phones stay usable. Escape closes the room (or just the map, if it is open); the map button in the bottom-left corner opens a city map with a pin on every room (click one to fast travel there) and a "Back to the world" button; Tab is trapped inside; focus returns
to the building that opened the room. The 250 ms entry zoom is skipped for `prefers-reduced-motion`.
