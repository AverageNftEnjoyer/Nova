# Nova City building rooms

Every clickable building on Home (`/home`) opens its own **room**: a large pixel window with the building's picture
along the top, its live status on plaques (connection lamp, building level and uses from `GET /api/town`, or the place's
live tag), and tabs for what the building does:

- **Data** tabs show the module that place has always shown (Bank -> crypto prices, Nova HQ -> agent tasks, ...).
- **Connect & settings** is the integration's own setup panel from `/integrations` (API keys, OAuth, enable / disable,
  test, settings), driven by the same controller the page uses
  (`hud/app/integrations/modules/hooks/use-integrations-controller.ts`), so saving and secret masking are identical.
  The `/integrations` page keeps working and is linked from each room's frame.

Quests, the tutorial, Town Hall's building list, a resident's "set up" button and the music window's "Setup" all open
the matching room's Connect tab. News has no building and keeps the `/integrations` page.

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
| `nova-hq` | `nova-hq.webp` | Nova HQ | - | Agent tasks |
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
