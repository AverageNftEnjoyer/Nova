"use client"

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { ExternalLink } from "lucide-react"
import {
  BraveIcon,
  ClaudeIcon,
  CoinbaseIcon,
  DiscordIcon,
  GeminiIcon,
  GmailCalendarIcon,
  GmailIcon,
  OpenAIIcon,
  PhantomIcon,
  PolymarketIcon,
  SlackIcon,
  SpotifyIcon,
  TelegramIcon,
  YouTubeIcon,
  XAIIcon,
} from "@/components/icons"
import { DISTRICT_PLACES, PixelCityScene, cityBootRank, type CityBootPhase, type CityHotspot, type CityHotspotId, type CityIntegration, type CityPlaceId } from "@/components/pixel-city"
import { SettingsModal } from "@/components/settings/settings-modal"
import type { SettingsSectionId } from "@/components/settings/settings-nav"
import type { ResidentId } from "@/lib/town/residents"
import type { IntegrationSetupKey } from "@/lib/integrations/navigation"
import { isRunActive, useDeploymentsData } from "@/app/deployments/hooks/use-deployments-data"
import { preloadNewDeploymentFlow } from "@/app/deployments/components/new-deployment-flow-lazy"
import { NEW_DEPLOYMENT_TABS, type NewDeploymentTab } from "@/app/deployments/components/new-deployment-tabs"
import { getNovaPresence } from "@/lib/chat/nova-presence"
import { usePageActive } from "@/lib/hooks/use-page-active"
import { loadUserSettings, USER_SETTINGS_UPDATED_EVENT } from "@/lib/settings/userSettings"
import { useAgentTasks } from "../hooks/use-agent-tasks"
import { useCitySceneState } from "../hooks/use-city-scene-state"
import { useHomeAnalyticsSummary } from "../hooks/use-home-analytics-summary"
import { useHomeMainScreenState } from "../hooks/use-home-main-screen-state"
import { useHomeNotes } from "../hooks/use-home-notes"
import { useTownProgress } from "../hooks/use-town-progress"
import { useTownResidents } from "../hooks/use-town-residents"
import { ResidentCard } from "./game/resident-card"
import { TownGameLayer } from "./game/town-game-layer"
import { TownHallBody } from "./game/town-hall-panel"
import { CityBoot } from "./game/city-boot"
import { GameHud } from "./game/game-hud"
import { MusicPlayer, MusicWindow } from "./game/music-window"
import { useQuestNews } from "./game/town-hud"
import { useQuestNavigator } from "./game/use-quest-navigator"
import { AgentTasksHomeModule } from "./agent-tasks-home-module"
import { AnalyticsHomeModule } from "./analytics-home-module"
import { ChatHistoryModule } from "./chat-history-module"
import { CryptoPricesModule, formatUsdCompact } from "./crypto-prices-module"
import { IntegrationsGridModule, type IntegrationNode } from "./integrations-grid-module"
import { NotesHomeModule } from "./notes-home-module"
import { PolymarketLiveLinesModule } from "./polymarket-live-lines-module"
import { ScheduleBriefing } from "./schedule-briefing"
import { WeatherLocationPopup } from "./weather-location-popup"
import { YouTubeHomeModule } from "./youtube-home-module"
import { BuildingRoom, type RoomPanelControls, type RoomPanelVariant } from "./rooms/building-room"
import { RoomDeploymentsPanel } from "./rooms/room-deployments-panel"
import { RoomNewDeployment } from "./rooms/room-new-deployment"
import { preloadRoomPicture, whenRoomPictureReady } from "./rooms/room-picture"
import { preloadTravelMap } from "./rooms/room-travel-map"
import { ROOMS, ROOM_IDS, roomForIntegration, roomForPlace, sectionId, type RoomDefinition, type RoomId, type RoomPanelId, type RoomSectionId } from "./rooms/room-registry"

/** Modules inside pixel windows get these instead of Home's old glass panels. */
const PIXEL_PANEL = "pixel-panel h-full"
const PIXEL_SUBPANEL = "pixel-subpanel"
const NO_PANEL_STYLE: CSSProperties | undefined = undefined
/**
 * The camera's insets. The HUD is four small corner clusters (game/game-hud.tsx), not a band, so the city may run
 * nearly edge to edge: a thin margin keeps the framed map off the top strip and the Settings / recenter row.
 */
const SAFE_TOP = 16
const SAFE_BOTTOM = 16
/** What each place is called: its painted building in U.B Agents City (components/pixel-city/district/image-plan.ts). */
const PLACE_NAMES = Object.fromEntries(
  DISTRICT_PLACES.filter((place) => !place.id.startsWith("integration-")).map((place) => [place.id, place.name]),
) as Record<CityHotspotId, string>

function formatCost(usd: number): string {
  if (usd <= 0) return "$0.00"
  if (usd < 0.01) return "<$0.01"
  return `$${usd.toFixed(2)}`
}

export function HomeMainScreen() {
  const router = useRouter()
  const pageActive = usePageActive()
  const home = useHomeMainScreenState()
  const agentTasks = useAgentTasks()
  const deployments = useDeploymentsData()
  const notesState = useHomeNotes()
  const summaryState = useHomeAnalyticsSummary()

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [bootPhase, setBootPhase] = useState<CityBootPhase>("charts")
  const [booting, setBooting] = useState(true)
  const onBoot = useCallback((phase: CityBootPhase) => {
    setBootPhase((current) => (cityBootRank(phase) > cityBootRank(current) ? phase : current))
  }, [])
  const [weatherPopupOpen, setWeatherPopupOpen] = useState(false)
  const [musicOpen, setMusicOpen] = useState(false)
  const [profileName, setProfileName] = useState("User")
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null)
  // U.B Agents City is one daytime pixel theme: Home and its popups never follow the app's light / dark setting.
  const isLight = false
  const assistantName = home.assistantName

  // Immersive rooms open instantly: their pictures are fetched in the background right after Home shows.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const room of Object.values(ROOMS)) if (room.stage) preloadRoomPicture(room.backgrounds)
      preloadTravelMap()
    }, 600)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const syncProfile = () => {
      const settings = loadUserSettings()
      setProfileName(settings.profile?.name?.trim() || "User")
      setProfileAvatar(settings.profile?.avatar || null)
    }
    syncProfile()
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, syncProfile as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, syncProfile as EventListener)
  }, [])

  const integrationNodes: IntegrationNode[] = [
    { icon: <TelegramIcon className="w-4 h-4" />, connected: home.telegramConnected, label: "Telegram", setup: "telegram" },
    { icon: <DiscordIcon className="w-4 h-4" />, connected: home.discordConnected, label: "Discord", setup: "discord" },
    { icon: <SlackIcon className="w-4 h-4" />, connected: home.slackConnected, label: "Slack", setup: "slack" },
    { icon: <OpenAIIcon className="w-4.5 h-4.5" />, connected: home.openaiConnected, label: "OpenAI", setup: "openai" },
    { icon: <ClaudeIcon className="w-4.5 h-4.5" />, connected: home.claudeConnected, label: "Claude", setup: "claude" },
    { icon: <XAIIcon size={16} />, connected: home.grokConnected, label: "Grok", setup: "grok" },
    { icon: <GeminiIcon size={16} />, connected: home.geminiConnected, label: "Gemini", setup: "gemini" },
    { icon: <SpotifyIcon className="w-4.5 h-4.5" />, connected: home.spotifyConnected, label: "Spotify", setup: "spotify" },
    { icon: <YouTubeIcon className="w-4 h-4" />, connected: home.youtubeConnected, label: "YouTube", setup: "youtube" },
    { icon: <GmailIcon className="w-4 h-4" />, connected: home.gmailConnected, label: "Gmail", setup: "gmail" },
    { icon: <GmailCalendarIcon className="w-4 h-4" />, connected: home.gcalendarConnected, label: "Google Calendar", setup: "gmail-calendar" },
    { icon: <BraveIcon className="w-4.5 h-4.5" />, connected: home.braveConnected, label: "Brave", setup: "brave" },
    { icon: <CoinbaseIcon className="w-4.5 h-4.5" />, connected: home.coinbaseConnected, label: "Coinbase", setup: "coinbase" },
    { icon: <PhantomIcon className="w-4 h-4" />, connected: home.phantomConnected, label: "Phantom", setup: "phantom" },
    { icon: <PolymarketIcon className="w-6 h-6" />, connected: home.polymarketConnected, label: "Polymarket", setup: "polymarket" },
  ]

  const activeRuns = deployments.runs.filter(isRunActive).length
  const summary = summaryState.summary
  const tasks = agentTasks.tasks
  const runningTasks = tasks.filter((task) => task.status === "running").length
  const waitingTasks = tasks.filter((task) => task.status === "queued" || task.status === "paused").length
  const connectedCount = integrationNodes.filter((node) => node.connected).length
  const activeConversations = home.conversations.filter((conversation) => !conversation.archived).length

  // U.B Agents City progression: level, quests, tutorial and celebrations (components/game). The streets hold only real residents:
  // one per agent task and one per connected integration, named by the user.
  const town = useTownProgress()
  const residents = useTownResidents()

  const connectedSet = new Set<CityIntegration>(integrationNodes.filter((node) => node.connected).map((node) => node.setup as CityIntegration))

  const sceneState = useCitySceneState({
    residentNames: residents.names,
    weatherCode: home.homeWeather?.weatherCode ?? null,
    connected: home.connected,
    novaState: home.novaState,
    tasks,
    activeRuns,
    notesCount: notesState.notes.length,
    connectedIntegrations: integrationNodes.filter((node) => node.connected).map((node) => node.setup as CityIntegration),
  })

  const presence = getNovaPresence({ agentConnected: home.connected, novaState: home.novaState })
  const btc = home.cryptoAssets.find((asset) => asset.symbol.toUpperCase() === "BTC")
  const names = PLACE_NAMES
  const hotspots: CityHotspot[] = [
    { id: "tasks", label: names.tasks, detail: runningTasks || waitingTasks ? `${runningTasks} running · ${waitingTasks} waiting` : "Agent tasks · idle" },
    { id: "deploy", label: names.deploy, detail: activeRuns ? `${activeRuns} deployment${activeRuns === 1 ? "" : "s"} at sea` : "New deployment" },
    { id: "schedule", label: names.schedule, detail: "Schedule" },
    { id: "crypto", label: names.crypto, detail: btc && btc.price > 0 ? `BTC ${formatUsdCompact(btc.price)}` : "Crypto prices" },
    { id: "polymarket", label: names.polymarket, detail: home.polymarketConnected ? "Polymarket live lines" : "Polymarket · not connected" },
    { id: "youtube", label: names.youtube, detail: home.youtubeConnected ? "YouTube" : "YouTube · not connected" },
    { id: "analytics", label: names.analytics, detail: summary ? `${formatCost(summary.costUsd)} today` : "Analytics" },
    { id: "notes", label: names.notes, detail: `${notesState.notes.length} note${notesState.notes.length === 1 ? "" : "s"}` },
    { id: "integrations", label: names.integrations, detail: `${connectedCount}/${integrationNodes.length} connected` },
    { id: "chat", label: `${assistantName} · Park`, detail: `${presence.label.toLowerCase()} · ${activeConversations} chat${activeConversations === 1 ? "" : "s"}` },
  ]

  // Every integration also has its own building. Its label says whether it is connected.
  for (const place of DISTRICT_PLACES) {
    if (!place.id.startsWith("integration-") || !place.integration) continue
    const node = integrationNodes.find((candidate) => candidate.setup === place.integration)
    if (!node) continue
    hotspots.push({ id: place.id, label: `${place.name} · ${node.label}`, detail: node.connected ? "Connected" : "Not connected · click to set up" })
  }

  // Every building opens its own room (rooms/room-registry.ts). An integration's setup opens in its building's room;
  // an integration with no building (News) keeps the /integrations page.
  // `seq` remounts the room on every open, so asking for a section of the room already open switches to it.
  // `tab` picks the Depot creation view's first tab (Describe / One-off task / Automation).
  const [openRoom, setOpenRoomState] = useState<{ id: RoomId; section?: RoomSectionId; tab?: NewDeploymentTab; seq: number } | null>(null)
  const setOpenRoom = useCallback((next: { id: RoomId; section?: RoomSectionId; tab?: NewDeploymentTab } | null) => {
    const open = () => setOpenRoomState((previous) => (next ? { ...next, seq: (previous?.seq ?? 0) + 1 } : null))
    // An immersive room opens once its picture is in (normally already preloaded), never onto an empty screen.
    const stageRoom = next ? ROOMS[next.id] : null
    if (stageRoom?.stage) void whenRoomPictureReady(stageRoom.backgrounds).then(open)
    else open()
  }, [])
  const openHotspot = useCallback(
    (id: CityPlaceId) => {
      const room = roomForPlace(id)
      if (room) setOpenRoom({ id: room.id })
    },
    [setOpenRoom],
  )
  // Deep links land here: `/home?room=<id>[&section=<id>][&tab=describe|task|automation]` (the retired /deployments page redirects
  // to the Depot this way). Read once on mount, unknown values are ignored, then the URL is cleaned without navigating.
  // The room opens once the city's boot screen is gone: until then everything under it is inert, so it could not take focus.
  const [pendingRoom, setPendingRoom] = useState<{ id: RoomId; section?: RoomSectionId; tab?: NewDeploymentTab } | null>(null)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const roomParam = params.get("room")
    const sectionParam = params.get("section")
    const tabParam = params.get("tab")
    if (roomParam === null && sectionParam === null && tabParam === null) return
    const id = ROOM_IDS.find((candidate) => candidate === roomParam)
    if (id) {
      const section = ROOMS[id].sections.map(sectionId).find((candidate) => candidate === sectionParam)
      const tab = NEW_DEPLOYMENT_TABS.find((candidate) => candidate.id === tabParam)?.id
      setPendingRoom({ id, section, tab: section === "new-deployment" ? tab : undefined })
    }
    for (const key of ["room", "section", "tab", "mode", "kind"]) params.delete(key)
    const query = params.toString()
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`)
  }, [])
  useEffect(() => {
    if (booting || !pendingRoom) return
    setOpenRoom(pendingRoom)
    setPendingRoom(null)
  }, [booting, pendingRoom, setOpenRoom])
  const goToIntegrations = home.goToIntegrations
  const openSetup = useCallback(
    (setup: IntegrationSetupKey) => {
      const room = roomForIntegration(setup)
      if (room) setOpenRoom({ id: room.id, section: "setup" })
      else goToIntegrations(setup)
    },
    [goToIntegrations, setOpenRoom],
  )
  // Creating and running U.B Agents tasks happens on the Depot's hologram screen (its "New" section), never in a popup over the city.
  const [launchNote, setLaunchNote] = useState("")
  const openNewDeployment = useCallback(() => setOpenRoom({ id: "depot", section: "new-deployment" }), [setOpenRoom])
  const openDepot = useCallback(() => setOpenRoom({ id: "depot" }), [setOpenRoom])
  const closeRoom = useCallback(() => {
    setLaunchNote("")
    setOpenRoom(null)
  }, [setOpenRoom])

  // Clicking a resident in the city (an agent, or an integration's worker) opens its card (game/resident-card.tsx), built from live data.
  const [residentCardId, setResidentCardId] = useState<ResidentId | null>(null)
  const closeResidentCard = useCallback(() => setResidentCardId(null), [])
  const openAgentTasks = useCallback(() => {
    setResidentCardId(null)
    setOpenRoom({ id: "nova-hq" })
  }, [setOpenRoom])
  const openResidentSetup = useCallback(
    (setup: IntegrationSetupKey) => {
      setResidentCardId(null)
      openSetup(setup)
    },
    [openSetup],
  )

  const [questLogOpen, setQuestLogOpen] = useState(false)
  const closeQuestLog = useCallback(() => setQuestLogOpen(false), [])
  const questNews = useQuestNews(town.progress, questLogOpen)
  // Quests only open Settings for skills ("Teach U.B Agents a skill"); the HUD gear opens it on Profile.
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("profile")
  const openSettings = useCallback(() => {
    setSettingsSection("skills")
    setSettingsOpen(true)
  }, [])
  const goToQuest = useQuestNavigator({ openPlace: openHotspot, goToIntegrations: openSetup, openSettings })

  const pageAction = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className="pixel-chip h-7! px-2! text-[13px]!" title={label}>
      <ExternalLink className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )

  /** A room's link to its full page (room-registry.ts `page`); integration rooms without one link to their setup page. */
  const roomPageAction = (room: RoomDefinition) => {
    switch (room.page) {
      case "deployments":
        return pageAction("Deployments", openDepot)
      case "calendar":
        return pageAction("Calendar", home.openCalendar)
      case "analytics":
        return pageAction("Dashboard", home.openAnalytics)
      case "chat":
        return pageAction("Chat", home.openChat)
      case "polymarket":
        return pageAction("Polymarket", () => router.push("/polymarket"))
      case "integrations":
        return pageAction("Integrations", home.openIntegrations)
      default: {
        const integration = room.integration
        return integration ? pageAction("Integrations", () => home.goToIntegrations(integration)) : undefined
      }
    }
  }

  /** A room's data section: the module this place has always shown, unchanged. */
  const renderRoomPanel = (panel: RoomPanelId, variant: RoomPanelVariant = "window", controls?: RoomPanelControls): ReactNode => {
    switch (panel) {
      case "tasks":
        return (
          <AgentTasksHomeModule
            isLight={isLight}
            panelClass={PIXEL_PANEL}
            subPanelClass={PIXEL_SUBPANEL}
            panelStyle={NO_PANEL_STYLE}
            className="h-full"
            agentTasks={agentTasks}
            onOpenMissions={openDepot}
            onCreateDeployment={openNewDeployment}
            onPrefetchDeployment={preloadNewDeploymentFlow}
          />
        )
      case "deployments":
      case "deployment-list":
        return (
          <RoomDeploymentsPanel
            view={panel === "deployment-list" ? "deployments" : "runs"}
            variant={variant}
            deployments={deployments}
            notice={launchNote}
            onNewDeployment={() => (controls ? controls.showSection("new-deployment") : openNewDeployment())}
            onPrefetchDeployment={preloadNewDeploymentFlow}
          />
        )
      case "new-deployment": {
        const creation = (
          <RoomNewDeployment
            isLight={isLight}
            nova={home.nova}
            initialTab={openRoom?.id === "depot" ? openRoom.tab : undefined}
            onLaunched={(message) => {
              setLaunchNote(message)
              void deployments.refresh()
              controls?.showSection("deployments")
            }}
            onOpenGuidedBuilder={() => router.push("/missions?create=builder&returnTo=/home")}
            onViewAutomations={() => router.push("/missions?returnTo=/home")}
          />
        )
        return variant === "holo" ? creation : <div className="holo holo--panel holo--inline">{creation}</div>
      }
      case "schedule":
        return <ScheduleBriefing isLight={isLight} panelClass={PIXEL_PANEL} subPanelClass={PIXEL_SUBPANEL} panelStyle={NO_PANEL_STYLE} onOpenCalendar={home.openCalendar} />
      case "crypto":
        return <CryptoPricesModule isLight={isLight} subPanelClass={PIXEL_SUBPANEL} assets={home.cryptoAssets} range={home.cryptoRange} onRangeChange={home.setCryptoRange} />
      case "polymarket":
        return (
          <PolymarketLiveLinesModule
            isLight={isLight}
            panelClass={PIXEL_PANEL}
            subPanelClass={PIXEL_SUBPANEL}
            panelStyle={NO_PANEL_STYLE}
            className="h-full"
            onOpenIntegrations={() => openSetup("polymarket")}
            onOpenPolymarket={() => router.push("/polymarket")}
          />
        )
      case "youtube":
        return (
          <YouTubeHomeModule
            isLight={isLight}
            panelClass={PIXEL_PANEL}
            subPanelClass={PIXEL_SUBPANEL}
            panelStyle={NO_PANEL_STYLE}
            className="h-full"
            connected={home.youtubeConnected}
            onOpenIntegrations={() => openSetup("youtube")}
          />
        )
      case "analytics":
        return (
          <AnalyticsHomeModule
            isLight={isLight}
            subPanelClass={PIXEL_SUBPANEL}
            summaryState={summaryState}
            onOpenAnalytics={home.openAnalytics}
            onOpenBudgets={() => router.push("/analytics#budgets")}
            onOpenDevLogs={home.openDevLogs}
          />
        )
      case "notes":
        return <NotesHomeModule isLight={isLight} panelClass={PIXEL_PANEL} subPanelClass={PIXEL_SUBPANEL} panelStyle={NO_PANEL_STYLE} className="h-full" notesState={notesState} />
      case "town":
        return (
          <TownHallBody
            town={town}
            integrations={integrationNodes}
            onSetup={openSetup}
            integrationsGrid={<IntegrationsGridModule isLight={isLight} subPanelClass={PIXEL_SUBPANEL} nodes={integrationNodes} onOpen={openSetup} />}
          />
        )
      case "chats":
        return (
          <ChatHistoryModule
            isLight={isLight}
            subPanelClass={PIXEL_SUBPANEL}
            conversations={home.conversations}
            onSelect={(id) => {
              void home.handleSelectConvo(id)
            }}
            onNewChat={() => {
              void home.handleNewChat()
            }}
            onRename={home.handleRenameConvo}
            onArchive={home.handleArchiveConvo}
            onDelete={home.handleDeleteConvo}
          />
        )
      case "music":
        return (
          <MusicPlayer
            connected={home.spotifyConnected}
            connecting={home.spotifyConnecting}
            nowPlaying={home.spotifyNowPlaying}
            error={home.spotifyError}
            busyAction={home.spotifyBusyAction}
            onConnectSpotify={() => {
              void home.connectSpotify()
            }}
            onOpenIntegrations={() => openSetup("spotify")}
            onTogglePlayPause={home.toggleSpotifyPlayback}
            onNext={home.spotifyNextTrack}
            onPrevious={home.spotifyPreviousTrack}
            onPlaySmart={home.spotifyPlaySmart}
            onSeek={home.seekSpotify}
          />
        )
    }
  }

  const activeRoom = openRoom ? ROOMS[openRoom.id] : null
  const activeRoomNode = activeRoom?.integration ? integrationNodes.find((node) => node.setup === activeRoom.integration) : undefined
  const activeRoomOwnLot = Boolean(activeRoom?.place.startsWith("integration-"))
  const roomWindow = activeRoom ? (
    <BuildingRoom
      key={`${activeRoom.id}:${openRoom?.seq ?? 0}`}
      room={activeRoom}
      initialSection={openRoom?.section}
      // An integration's own building says "Connected" on its lamp plaque; civic places also show their live tag.
      detail={activeRoomOwnLot ? "" : activeRoom.place === "deploy" && !activeRuns ? "No runs" : (hotspots.find((spot) => spot.id === activeRoom.place)?.detail ?? "")}
      connected={activeRoomNode ? activeRoomNode.connected : null}
      building={activeRoom.integration ? (town.progress?.buildings.find((candidate) => candidate.integration === activeRoom.integration) ?? null) : null}
      icon={activeRoomOwnLot ? activeRoomNode?.icon : undefined}
      renderPanel={renderRoomPanel}
      stageAction={
        activeRoom.id === "depot"
          ? {
              label: "New deployment",
              section: "new-deployment",
              onPrefetch: preloadNewDeploymentFlow,
            }
          : undefined
      }
      actions={roomPageAction(activeRoom)}
      onClose={closeRoom}
      onTravel={(id) => setOpenRoom({ id })}
    />
  ) : null

  const weather = home.homeWeather
  return (
    <div className="game-hud-root" data-city-boot={booting ? "on" : undefined}>
      <div className="city-boot-play" inert={booting ? true : undefined} aria-hidden={booting ? true : undefined}>
        <PixelCityScene state={sceneState} safeTop={SAFE_TOP} safeBottom={SAFE_BOTTOM} hotspots={hotspots} active={pageActive} onHotspot={openHotspot} onResident={setResidentCardId} onBoot={onBoot} />

        <GameHud
          town={town}
          profileName={profileName}
          profileAvatar={profileAvatar}
          presence={presence}
          questLogOpen={questLogOpen}
          questNews={questNews}
          musicOpen={musicOpen}
          musicPlaying={Boolean(home.spotifyConnected && home.spotifyNowPlaying?.playing)}
          weatherValue={
            weather?.temperatureF !== null && weather?.temperatureF !== undefined
              ? `${Math.round(weather.temperatureF)}°`
              : home.homeWeatherLoading
                ? "—"
                : "Set city"
          }
          weatherTitle={home.homeWeatherError || (home.preferredWeatherCity ? weather?.conditionLabel || "Loading weather" : "Set your city")}
          weatherAriaLabel={home.preferredWeatherCity ? `Change city from ${home.preferredWeatherCity}` : "Set your city"}
          onHome={() => router.push("/home")}
          onOpenTownHall={() => setOpenRoom({ id: "town-hall" })}
          onOpenQuests={() => setQuestLogOpen(true)}
          onOpenMusic={() => setMusicOpen(true)}
          onOpenWeather={() => setWeatherPopupOpen(true)}
          onOpenProfile={() => {
            setSettingsSection("profile")
            setSettingsOpen(true)
          }}
          onOpenSettings={() => {
            setSettingsSection("appearance")
            setSettingsOpen(true)
          }}
        />

        {musicOpen ? (
          <MusicWindow
            connected={home.spotifyConnected}
            connecting={home.spotifyConnecting}
            nowPlaying={home.spotifyNowPlaying}
            error={home.spotifyError}
            busyAction={home.spotifyBusyAction}
            onConnectSpotify={() => {
              void home.connectSpotify()
            }}
            onOpenIntegrations={() => {
              setMusicOpen(false)
              openSetup("spotify")
            }}
            onTogglePlayPause={home.toggleSpotifyPlayback}
            onNext={home.spotifyNextTrack}
            onPrevious={home.spotifyPreviousTrack}
            onPlaySmart={home.spotifyPlaySmart}
            onSeek={home.seekSpotify}
            onClose={() => setMusicOpen(false)}
          />
        ) : null}

        {roomWindow}
        {residentCardId ? (
          <ResidentCard
            residentId={residentCardId}
            tasks={tasks}
            buildings={town.progress?.buildings ?? []}
            connected={connectedSet}
            residents={residents}
            onClose={closeResidentCard}
            onAction={agentTasks.runAction}
            onRaiseBudget={agentTasks.raiseBudget}
            onOpenTasks={openAgentTasks}
            onSetup={openResidentSetup}
          />
        ) : null}
        <TownGameLayer town={town} assistantName={assistantName} hotspots={hotspots} questLogOpen={questLogOpen} onCloseQuestLog={closeQuestLog} onGo={goToQuest} />

        {weatherPopupOpen ? (
          <div className="pixel-ui">
            <WeatherLocationPopup
              isLight={isLight}
              subPanelClass={PIXEL_SUBPANEL}
              currentCity={home.preferredWeatherCity}
              weatherLoading={home.homeWeatherLoading}
              weatherError={home.homeWeatherError}
              onRetry={home.refreshHomeWeather}
              onClose={() => setWeatherPopupOpen(false)}
            />
          </div>
        ) : null}
        <div className="pixel-ui">
          <SettingsModal isOpen={settingsOpen} initialSection={settingsSection} onClose={() => setSettingsOpen(false)} />
        </div>
        </div>
      {booting ? <CityBoot phase={bootPhase} onDone={() => setBooting(false)} /> : null}
    </div>
  )
}
