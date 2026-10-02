import { DISTRICT_PLACES, type CityPlaceId } from "@/components/pixel-city"
import { INTEGRATION_SIGN_COLORS } from "@/app/integrations/constants/buildings"
import type { IntegrationSetupKey } from "@/lib/integrations/navigation"
import { PIXEL_WINDOW_THEMES, type PixelWindowThemeId } from "../pixel/window-themes"

/**
 * Building rooms: every clickable building in Nova City opens its own room (BuildingRoom). This registry is the one
 * list of rooms: which place opens which room, the integration it connects (if any), its background picture, its
 * colours and the sections (tabs) it shows. What a "data" section draws is decided by Home (home-main-screen.tsx,
 * `renderRoomPanel`), from the live hooks it already has; a "setup" section is the integration's connect + settings
 * panel, the same one /integrations shows. Background pictures: docs/frontend/nova-city-rooms.md.
 */

/** A room's id: the building's name, kebab-case. Also its background file name (`<id>.webp`, or `<id>.png`). */
export type RoomId =
  | "nova-hq"
  | "depot"
  | "power-plant"
  | "noticeboard"
  | "town-hall"
  | "fountain-park"
  | "post-office"
  | "bank"
  | "odds-parlour"
  | "cinema"
  | "records"
  | "arcade"
  | "cowork"
  | "lab"
  | "studio"
  | "observatory"
  | "gemini-tower"
  | "telegraph"
  | "clock-tower"
  | "library"
  | "vault"

/** Data a room can show; Home draws each one from its existing module. */
export type RoomPanelId =
  | "tasks"
  | "deployments"
  | "analytics"
  | "notes"
  | "town"
  | "chats"
  | "schedule"
  | "crypto"
  | "polymarket"
  | "youtube"
  | "music"

/** One tab of a room. */
export type RoomSection =
  | { kind: "data"; panel: RoomPanelId; label: string }
  /** The room's integration: connect, test, disconnect and its settings (needs `integration`). */
  | { kind: "setup"; label: string }

export type RoomSectionId = RoomPanelId | "setup"

/** A full page the room links to from its frame. */
export type RoomPage = "deployments" | "calendar" | "analytics" | "chat" | "polymarket" | "integrations"

export interface RoomDefinition {
  id: RoomId
  /** The place in the city that opens this room. */
  place: CityPlaceId
  /** The building's painted name (from the city plan). */
  building: string
  /** What happens here, under the name on the title plaque. */
  role: string
  /** The integration this building connects, if any. */
  integration: IntegrationSetupKey | null
  /** Background picture candidates, tried in order; a themed pixel backdrop shows when none loads. */
  backgrounds: readonly string[]
  /** Sign colour (plaque rim, tabs, accents) and second colour (backdrop pattern). */
  accent: string
  accent2: string
  /** The 9x9 emblem on the plaque when the room has no integration icon. */
  emblem: PixelWindowThemeId
  /** Tabs, in order. The first one opens unless the room is opened for setup. */
  sections: readonly RoomSection[]
  page?: RoomPage
}

/** Where room pictures live (hud/public/pixel-city/rooms/). */
export const ROOM_BACKGROUND_DIR = "/pixel-city/rooms"
/** The picture size the rooms are designed for (16:9); see docs/frontend/nova-city-rooms.md. */
export const ROOM_BACKGROUND_SIZE = { width: 1600, height: 900 } as const

const SETUP: RoomSection = { kind: "setup", label: "Connect & settings" }

function placeName(place: CityPlaceId): string {
  return DISTRICT_PLACES.find((candidate) => candidate.id === place)?.name ?? place
}

interface RoomSpec {
  place: CityPlaceId
  role: string
  integration?: IntegrationSetupKey
  /** Civic rooms take their colours and emblem from the place's window theme. */
  emblem?: PixelWindowThemeId
  sections: readonly RoomSection[]
  page?: RoomPage
}

const SPECS: Readonly<Record<RoomId, RoomSpec>> = {
  "nova-hq": { place: "tasks", role: "Agent tasks", emblem: "tasks", sections: [{ kind: "data", panel: "tasks", label: "Agent tasks" }], page: "deployments" },
  depot: { place: "deploy", role: "Deployments", emblem: "default", sections: [{ kind: "data", panel: "deployments", label: "Deployments" }], page: "deployments" },
  "power-plant": { place: "analytics", role: "Analytics", emblem: "analytics", sections: [{ kind: "data", panel: "analytics", label: "Usage" }], page: "analytics" },
  noticeboard: { place: "notes", role: "Notes", emblem: "notes", sections: [{ kind: "data", panel: "notes", label: "Notes" }] },
  "town-hall": { place: "integrations", role: "Town progress", emblem: "integrations", sections: [{ kind: "data", panel: "town", label: "Town" }], page: "integrations" },
  "fountain-park": { place: "chat", role: "Chats", emblem: "chat", sections: [{ kind: "data", panel: "chats", label: "Chats" }], page: "chat" },
  "post-office": {
    place: "schedule",
    role: "Schedule · Gmail",
    integration: "gmail",
    emblem: "schedule",
    sections: [{ kind: "data", panel: "schedule", label: "Schedule" }, { kind: "setup", label: "Gmail" }],
    page: "calendar",
  },
  bank: {
    place: "crypto",
    role: "Crypto · Coinbase",
    integration: "coinbase",
    emblem: "crypto",
    sections: [{ kind: "data", panel: "crypto", label: "Prices" }, { kind: "setup", label: "Coinbase" }],
  },
  "odds-parlour": {
    place: "polymarket",
    role: "Polymarket",
    integration: "polymarket",
    emblem: "polymarket",
    sections: [{ kind: "data", panel: "polymarket", label: "Live lines" }, SETUP],
    page: "polymarket",
  },
  cinema: { place: "youtube", role: "YouTube", integration: "youtube", emblem: "youtube", sections: [{ kind: "data", panel: "youtube", label: "Feed" }, SETUP] },
  records: { place: "integration-spotify", role: "Spotify", integration: "spotify", sections: [{ kind: "data", panel: "music", label: "Now playing" }, SETUP] },
  arcade: { place: "integration-discord", role: "Discord", integration: "discord", sections: [SETUP] },
  cowork: { place: "integration-slack", role: "Slack", integration: "slack", sections: [SETUP] },
  lab: { place: "integration-openai", role: "OpenAI", integration: "openai", sections: [SETUP] },
  studio: { place: "integration-claude", role: "Claude", integration: "claude", sections: [SETUP] },
  observatory: { place: "integration-grok", role: "Grok", integration: "grok", sections: [SETUP] },
  "gemini-tower": { place: "integration-gemini", role: "Gemini", integration: "gemini", sections: [SETUP] },
  telegraph: { place: "integration-telegram", role: "Telegram", integration: "telegram", sections: [SETUP] },
  "clock-tower": {
    place: "integration-gmail-calendar",
    role: "Google Calendar",
    integration: "gmail-calendar",
    sections: [{ kind: "data", panel: "schedule", label: "Schedule" }, { kind: "setup", label: "Calendar" }],
    page: "calendar",
  },
  library: { place: "integration-brave", role: "Brave search", integration: "brave", sections: [SETUP] },
  vault: { place: "integration-phantom", role: "Phantom wallet", integration: "phantom", sections: [SETUP] },
}

function buildRoom(id: RoomId, spec: RoomSpec): RoomDefinition {
  const theme = PIXEL_WINDOW_THEMES[spec.emblem ?? "default"]
  const integrationColour = spec.integration && !spec.emblem ? INTEGRATION_SIGN_COLORS[spec.integration] : null
  return {
    id,
    place: spec.place,
    building: placeName(spec.place),
    role: spec.role,
    integration: spec.integration ?? null,
    backgrounds: [`${ROOM_BACKGROUND_DIR}/${id}.webp`, `${ROOM_BACKGROUND_DIR}/${id}.png`],
    accent: integrationColour ?? theme.accent,
    accent2: integrationColour ? theme.accent : theme.accent2,
    emblem: theme.id,
    sections: spec.sections,
    page: spec.page,
  }
}

export const ROOMS: Readonly<Record<RoomId, RoomDefinition>> = Object.fromEntries(
  (Object.entries(SPECS) as [RoomId, RoomSpec][]).map(([id, spec]) => [id, buildRoom(id, spec)]),
) as Record<RoomId, RoomDefinition>

export const ROOM_IDS = Object.keys(SPECS) as RoomId[]

const ROOM_BY_PLACE = new Map<CityPlaceId, RoomDefinition>(ROOM_IDS.map((id) => [ROOMS[id].place, ROOMS[id]]))

/** The room a city place opens. Every place has one. */
export function roomForPlace(place: CityPlaceId): RoomDefinition | null {
  return ROOM_BY_PLACE.get(place) ?? null
}

/**
 * The room where an integration is connected: the building that stands for it (Gmail -> Post Office, Coinbase -> Bank).
 * Null for integrations with no building in the city (News), which keep the /integrations page.
 */
export function roomForIntegration(integration: IntegrationSetupKey): RoomDefinition | null {
  return ROOM_IDS.map((id) => ROOMS[id]).find((room) => room.integration === integration) ?? null
}

export function sectionId(section: RoomSection): RoomSectionId {
  return section.kind === "setup" ? "setup" : section.panel
}
