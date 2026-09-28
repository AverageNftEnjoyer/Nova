"use client"

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { CloudSun, ExternalLink, Settings } from "lucide-react"
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
import { DISTRICT_PLACES, PixelCityScene, type CityHotspot, type CityHotspotId, type CityIntegration, type CityPlaceId } from "@/components/pixel-city"
import { SettingsModal } from "@/components/settings/settings-modal"
import { WindowControls } from "@/components/window/window-controls"
import { isRunActive, useDeploymentsData } from "@/app/deployments/hooks/use-deployments-data"
import { LazyNewDeploymentModal, preloadNewDeploymentModal } from "@/app/deployments/components/new-deployment-modal-lazy"
import { getNovaPresence } from "@/lib/chat/nova-presence"
import { usePageActive } from "@/lib/hooks/use-page-active"
import { NOVA_VERSION } from "@/lib/meta/version"
import { loadUserSettings, USER_SETTINGS_UPDATED_EVENT } from "@/lib/settings/userSettings"
import { cn } from "@/lib/shared/utils"
import { useAgentTasks } from "../hooks/use-agent-tasks"
import { useCitySceneState } from "../hooks/use-city-scene-state"
import { useHomeAnalyticsSummary } from "../hooks/use-home-analytics-summary"
import { useHomeMainScreenState } from "../hooks/use-home-main-screen-state"
import { useHomeNotes } from "../hooks/use-home-notes"
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
import { PixelSpotifyBar } from "./pixel/pixel-spotify-bar"
import { PixelWindow } from "./pixel/pixel-window"

/** Modules inside pixel windows get these instead of Home's old glass panels. */
const PIXEL_PANEL = "pixel-panel h-full"
const PIXEL_SUBPANEL = "pixel-subpanel"
const NO_PANEL_STYLE: CSSProperties | undefined = undefined
const DRAG: CSSProperties = { WebkitAppRegion: "drag" } as CSSProperties
const NO_DRAG: CSSProperties = { WebkitAppRegion: "no-drag" } as CSSProperties
const FALLBACK_CITY = "Nova City"
/** What each place is called: its painted building in Nova City (components/pixel-city/district/image-plan.ts). */
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

  const [openPlace, setOpenPlace] = useState<CityHotspotId | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [weatherPopupOpen, setWeatherPopupOpen] = useState(false)
  const [profileName, setProfileName] = useState("User")
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null)
  // Nova City is a night scene: Home and its popups use night colours whatever the app theme says.
  const isLight = false
  const assistantName = home.assistantName

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

  const sceneState = useCitySceneState({
    weatherCode: home.homeWeather?.weatherCode ?? null,
    connected: home.connected,
    novaState: home.novaState,
    tasks,
    activeRuns,
    cryptoAssets: home.cryptoAssets,
    notesCount: notesState.notes.length,
    connectedIntegrations: integrationNodes.filter((node) => node.connected).map((node) => node.setup as CityIntegration),
  })

  const presence = getNovaPresence({ agentConnected: home.connected, novaState: home.novaState })
  const btc = home.cryptoAssets.find((asset) => asset.symbol.toUpperCase() === "BTC")
  const names = PLACE_NAMES
  const hotspots: CityHotspot[] = [
    { id: "tasks", label: names.tasks, detail: runningTasks || waitingTasks ? `${runningTasks} running · ${waitingTasks} waiting` : "Agent tasks · idle" },
    { id: "deploy", label: names.deploy, detail: activeRuns ? `${activeRuns} deployment${activeRuns === 1 ? "" : "s"} on the road` : "New deployment" },
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

  const openHotspot = useCallback(
    (id: CityPlaceId) => {
      if (id === "deploy") {
        home.openTaskDeployment()
        return
      }
      if (id.startsWith("integration-")) {
        // An integration's building opens what Home offers for it, or that integration's setup.
        const setup = id.slice("integration-".length) as CityIntegration
        if (setup === "gmail-calendar") setOpenPlace("schedule")
        else if (setup === "phantom") setOpenPlace("crypto")
        else home.goToIntegrations(setup)
        return
      }
      setOpenPlace(id as CityHotspotId)
    },
    [home],
  )
  const closePlace = useCallback(() => setOpenPlace(null), [])

  const cityName = home.preferredWeatherCity?.trim() || FALLBACK_CITY
  const cityLabel = home.homeWeather?.locationLabel || cityName

  const pageAction = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className="pixel-chip h-7! px-2! text-[13px]!" title={label}>
      <ExternalLink className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )

  const windowContent = useMemo(() => {
    switch (openPlace) {
      case "tasks":
        return (
          <PixelWindow place={names.tasks} role="Agent tasks" size="lg" onClose={closePlace} actions={pageAction("Deployments", home.openMissions)}>
            <AgentTasksHomeModule
              isLight={isLight}
              panelClass={PIXEL_PANEL}
              subPanelClass={PIXEL_SUBPANEL}
              panelStyle={NO_PANEL_STYLE}
              className="h-full"
              agentTasks={agentTasks}
              onOpenMissions={home.openMissions}
              onCreateDeployment={() => {
                setOpenPlace(null)
                home.openTaskDeployment()
              }}
              onPrefetchDeployment={preloadNewDeploymentModal}
            />
          </PixelWindow>
        )
      case "schedule":
        return (
          <PixelWindow place={names.schedule} role="Schedule" size="md" onClose={closePlace} actions={pageAction("Calendar", home.openCalendar)}>
            <ScheduleBriefing isLight={isLight} panelClass={PIXEL_PANEL} subPanelClass={PIXEL_SUBPANEL} panelStyle={NO_PANEL_STYLE} onOpenCalendar={home.openCalendar} />
          </PixelWindow>
        )
      case "crypto":
        return (
          <PixelWindow place={names.crypto} role="Crypto prices" size="md" onClose={closePlace}>
            <CryptoPricesModule isLight={isLight} subPanelClass={PIXEL_SUBPANEL} assets={home.cryptoAssets} range={home.cryptoRange} onRangeChange={home.setCryptoRange} />
          </PixelWindow>
        )
      case "polymarket":
        return (
          <PixelWindow place={names.polymarket} role="Polymarket" size="md" onClose={closePlace} actions={pageAction("Polymarket", () => router.push("/polymarket"))}>
            <PolymarketLiveLinesModule
              isLight={isLight}
              panelClass={PIXEL_PANEL}
              subPanelClass={PIXEL_SUBPANEL}
              panelStyle={NO_PANEL_STYLE}
              className="h-full"
              onOpenIntegrations={home.openIntegrations}
              onOpenPolymarket={() => router.push("/polymarket")}
            />
          </PixelWindow>
        )
      case "youtube":
        return (
          <PixelWindow place={names.youtube} role="YouTube" size="lg" onClose={closePlace}>
            <YouTubeHomeModule
              isLight={isLight}
              panelClass={PIXEL_PANEL}
              subPanelClass={PIXEL_SUBPANEL}
              panelStyle={NO_PANEL_STYLE}
              className="h-full"
              connected={home.youtubeConnected}
              onOpenIntegrations={home.openIntegrations}
            />
          </PixelWindow>
        )
      case "analytics":
        return (
          <PixelWindow place={names.analytics} role="Analytics" size="sm" onClose={closePlace} actions={pageAction("Dashboard", home.openAnalytics)}>
            <AnalyticsHomeModule
              isLight={isLight}
              subPanelClass={PIXEL_SUBPANEL}
              summaryState={summaryState}
              onOpenAnalytics={home.openAnalytics}
              onOpenBudgets={() => router.push("/analytics#budgets")}
              onOpenDevLogs={home.openDevLogs}
            />
          </PixelWindow>
        )
      case "notes":
        return (
          <PixelWindow place={names.notes} role="Notes" size="md" onClose={closePlace}>
            <NotesHomeModule isLight={isLight} panelClass={PIXEL_PANEL} subPanelClass={PIXEL_SUBPANEL} panelStyle={NO_PANEL_STYLE} className="h-full" notesState={notesState} />
          </PixelWindow>
        )
      case "integrations":
        return (
          <PixelWindow place={names.integrations} role="Integrations" size="md" onClose={closePlace} actions={pageAction("Integrations", home.openIntegrations)}>
            <IntegrationsGridModule isLight={isLight} subPanelClass={PIXEL_SUBPANEL} nodes={integrationNodes} onOpen={home.goToIntegrations} />
          </PixelWindow>
        )
      case "chat":
        return (
          <PixelWindow place={assistantName} role="Chats" size="sm" onClose={closePlace} actions={pageAction("Chat", home.openChat)}>
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
          </PixelWindow>
        )
      default:
        return null
    }
    // pageAction and integrationNodes are rebuilt each render from the values listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPlace, isLight, home, agentTasks, notesState, summaryState, assistantName, names, closePlace, router])

  const weather = home.homeWeather
  return (
    <div className="pixel-night relative h-dvh overflow-hidden bg-[#0a0c24]">
      <PixelCityScene state={sceneState} hotspots={hotspots} active={pageActive} onHotspot={openHotspot} />

      {/* HUD: wordmark top-left, everything about the user top-right. The bar doubles as the window drag area. */}
      <header className="absolute inset-x-0 top-0 z-10 flex h-16 items-start justify-between gap-4 px-4 pt-3" style={DRAG}>
        <div className="min-w-0 select-none" style={NO_DRAG}>
          <button type="button" onClick={() => router.push("/home")} className="pixel-wordmark flex items-baseline gap-2" aria-label="Home">
            <span className="font-pixel-display text-[28px] leading-none text-(--px-text)">NovaAIO</span>
            <span className="font-pixel text-[13px] text-(--px-accent)">{NOVA_VERSION}</span>
          </button>
          <p className="pixel-wordmark mt-1 flex items-center gap-2 font-pixel text-[14px] text-(--px-muted)">
            <span className={cn("h-2 w-2 shrink-0", presence.dotClassName)} aria-hidden="true" />
            <span className={presence.textClassName}>{presence.label}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">
              {cityLabel} after dark
            </span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2" style={NO_DRAG}>
          <button
            type="button"
            onClick={() => setWeatherPopupOpen(true)}
            className="pixel-chip"
            title={home.homeWeatherError || (home.preferredWeatherCity ? weather?.conditionLabel || "Loading weather" : "Set your city")}
            aria-label={home.preferredWeatherCity ? `Change city from ${home.preferredWeatherCity}` : "Set your city"}
          >
            <CloudSun className="h-4 w-4 text-(--px-accent)" />
            <span className="tabular-nums">
              {weather?.temperatureF !== null && weather?.temperatureF !== undefined
                ? `${Math.round(weather.temperatureF)}°`
                : home.homeWeatherLoading
                  ? "—"
                  : "Set city"}
            </span>
          </button>
          <div className="pixel-chip pl-1.5!">
            <span className="grid h-6 w-6 place-items-center overflow-hidden border-2 border-(--px-border) bg-(--px-bg-2) text-[12px]">
              {profileAvatar ? (
                <Image src={profileAvatar} alt="Profile" width={24} height={24} className="h-full w-full object-cover [image-rendering:pixelated]" unoptimized />
              ) : (
                profileName.charAt(0).toUpperCase()
              )}
            </span>
            <span className="max-w-36 truncate">{profileName}</span>
          </div>
          <button type="button" onClick={() => setSettingsOpen(true)} className="pixel-chip pixel-chip--icon group" aria-label="Open settings" title="Settings">
            <Settings className="h-4 w-4 transition-transform duration-200 group-hover:rotate-90" />
          </button>
          <WindowControls />
        </div>
      </header>

      <footer className="absolute inset-x-0 bottom-0 z-10 px-4 pb-3">
        <PixelSpotifyBar
          connected={home.spotifyConnected}
          connecting={home.spotifyConnecting}
          nowPlaying={home.spotifyNowPlaying}
          error={home.spotifyError}
          busyAction={home.spotifyBusyAction}
          onConnectSpotify={() => {
            void home.connectSpotify()
          }}
          onOpenIntegrations={() => home.goToIntegrations("spotify")}
          onTogglePlayPause={home.toggleSpotifyPlayback}
          onNext={home.spotifyNextTrack}
          onPrevious={home.spotifyPreviousTrack}
          onPlaySmart={home.spotifyPlaySmart}
          onSeek={home.seekSpotify}
        />
      </footer>

      {windowContent}

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
        <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </div>
      {home.newDeploymentOpen ? (
        <LazyNewDeploymentModal
          className="pixel-ui"
          isLight={isLight}
          nova={home.nova}
          initialTab="describe"
          onClose={home.closeNewDeployment}
          onOpenDeployments={home.openMissions}
          onOpenGuidedBuilder={() => router.push("/missions?create=builder&returnTo=/home")}
          onViewAutomations={() => router.push("/missions?returnTo=/home")}
        />
      ) : null}
    </div>
  )
}
