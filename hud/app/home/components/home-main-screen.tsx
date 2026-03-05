"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Blocks, Pin, Settings, Activity, Network, Bot, TrendingUp, BarChart2, History } from "lucide-react"
import { ScheduleBriefing } from "./schedule-briefing"
import {
  BraveIcon,
  ClaudeIcon,
  CoinbaseIcon,
  DiscordIcon,
  GeminiIcon,
  GmailCalendarIcon,
  GmailIcon,
  NewsIcon,
  OpenAIIcon,
  SlackIcon,
  SpotifyIcon,
  TelegramIcon,
  YouTubeIcon,
  XAIIcon,
} from "@/components/icons"
import { NovaOrbIndicator } from "@/components/chat/nova-orb-indicator"
import { SettingsModal } from "@/components/settings/settings-modal"
import { cn } from "@/lib/shared/utils"
import { NOVA_DOMAIN_MANAGERS } from "@/app/agents/agent-chart-data"
import { NOVA_VERSION } from "@/lib/meta/version"
import { loadUserSettings, USER_SETTINGS_UPDATED_EVENT } from "@/lib/settings/userSettings"
import { usePageActive } from "@/lib/hooks/use-page-active"
import { getNovaPresence } from "@/lib/chat/nova-presence"
import { formatDailyTime, hexToRgba } from "../helpers"
import { useHomeMainScreenState } from "../hooks/use-home-main-screen-state"
import { SpotifyHomeModule } from "./spotify-home-module"
import { NewsFeedModule } from "./news-feed-module"
import { YouTubeHomeModule } from "./youtube-home-module"
import { PolymarketLiveLinesModule } from "./polymarket-live-lines-module"

const FALLBACK_CRYPTO_ASSETS = [
  { symbol: "BTC", price: 0, changePct: 0, chart: [1, 1, 1, 1, 1, 1] },
  { symbol: "ETH", price: 0, changePct: 0, chart: [1, 1, 1, 1, 1, 1] },
  { symbol: "SOL", price: 0, changePct: 0, chart: [1, 1, 1, 1, 1, 1] },
  { symbol: "SUI", price: 0, changePct: 0, chart: [1, 1, 1, 1, 1, 1] },
  { symbol: "XRP", price: 0, changePct: 0, chart: [1, 1, 1, 1, 1, 1] },
  { symbol: "DOGE", price: 0, changePct: 0, chart: [1, 1, 1, 1, 1, 1] },
] as const

const COMMODITIES = [
  { name: "Gold", price: "$2,184", change: "+0.6%", up: true },
  { name: "WTI", price: "$77.30", change: "-0.3%", up: false },
  { name: "Nat Gas", price: "$2.11", change: "+1.8%", up: true },
] as const

export function HomeMainScreen() {
  const router = useRouter()
  const pageActive = usePageActive()
  const {
    isLight: rawIsLight,
    novaState,
    connected,
    muteHydrated,
    homeShellRef,
    pipelineSectionRef,
    scheduleSectionRef,
    integrationsSectionRef,
    spotifyModuleSectionRef,
    newsModuleSectionRef,
    agentModuleSectionRef,
    devToolsSectionRef,
    panelStyle,
    panelClass,
    subPanelClass,
    missions,
    cryptoAssets,
    cryptoRange,
    setCryptoRange,
    openMissions,
    openCalendar,
    openIntegrations,
    openDevLogs,
    openAgents,
    devToolsMetrics,
    integrationBadgeClass,
    goToIntegrations,
    telegramConnected,
    discordConnected,
    slackConnected,
    braveConnected,
    newsConnected,
    coinbaseConnected,
    openaiConnected,
    claudeConnected,
    grokConnected,
    geminiConnected,
    spotifyConnected,
    youtubeConnected,
    spotifyNowPlaying,
    spotifyError,
    spotifyBusyAction,
    toggleSpotifyPlayback,
    spotifyNextTrack,
    spotifyPreviousTrack,
    spotifyPlaySmart,
    seekSpotify,
    gmailConnected,
    gcalendarConnected,
    newsArticles,
    newsLoading,
    newsError,
    newsStale,
    newsFetchedAt,
    refreshNewsFeed,
    orbPalette,
    dayInHistoryEvents,
    dayInHistoryLoading,
    dayInHistoryError,
  } = useHomeMainScreenState()
  const isLight = muteHydrated && rawIsLight

  const fmt = (value: unknown) => {
    const n = Number(value)
    return Number.isFinite(n) ? n.toLocaleString("en-US") : "0"
  }
  const fmtUsd = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return "-"
    const abs = Math.abs(value)
    const decimals = abs >= 1000 ? 0 : abs >= 1 ? 2 : 4
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: decimals,
    }).format(value)
  }
  const fmtPct = (value: number) => {
    if (!Number.isFinite(value)) return "-"
    const sign = value > 0 ? "+" : ""
    return `${sign}${value.toFixed(2)}%`
  }
  const devMetricTiles = [
    { label: "Total Traces", value: fmt(devToolsMetrics.totalTraces), color: "" },
    { label: "Errors", value: fmt(devToolsMetrics.errors), color: "text-rose-400" },
    { label: "Warnings", value: fmt(devToolsMetrics.warnings), color: "text-amber-300" },
    { label: "Avg Latency", value: `${fmt(devToolsMetrics.avgLatencyMs)}ms`, color: "" },
    { label: "Total Tokens", value: fmt(devToolsMetrics.totalTokens), color: "" },
    { label: "Avg Quality", value: devToolsMetrics.avgQuality.toFixed(1), color: "" },
  ] as const
  const sparklinePoints = (values: readonly number[], width = 56, height = 12): string => {
    const points = Array.isArray(values) ? values.filter((v) => Number.isFinite(v)) : []
    if (points.length === 0) return `0,${height / 2} ${width},${height / 2}`
    if (points.length === 1) return `0,${height / 2} ${width},${height / 2}`

    const min = Math.min(...points)
    const max = Math.max(...points)
    const span = Math.max(max - min, 1e-9)
    return points
      .map((point, idx) => {
        const x = (idx / (points.length - 1)) * width
        const y = height - ((point - min) / span) * height
        return `${x.toFixed(2)},${y.toFixed(2)}`
      })
      .join(" ")
  }
  const symbolOrder = ["BTC", "ETH", "SOL", "SUI", "XRP", "DOGE"] as const
  const bySymbol = new Map(cryptoAssets.map((asset) => [asset.symbol.toUpperCase(), asset]))
  const fallbackBySymbol = new Map(FALLBACK_CRYPTO_ASSETS.map((asset) => [asset.symbol, asset]))
  const cryptoRows = symbolOrder.map((symbol) => bySymbol.get(symbol) ?? fallbackBySymbol.get(symbol)!)
  const cryptoRangeOptions = [
    { id: "1h", label: "1H" },
    { id: "1d", label: "1D" },
    { id: "7d", label: "7D" },
  ] as const

  const integrationNodes = [
    { icon: <TelegramIcon className="w-4 h-4" />, connected: telegramConnected, label: "Telegram" },
    { icon: <DiscordIcon className="w-4 h-4" />, connected: discordConnected, label: "Discord" },
    { icon: <SlackIcon className="w-4 h-4" />, connected: slackConnected, label: "Slack" },
    { icon: <OpenAIIcon className="w-4.5 h-4.5" />, connected: openaiConnected, label: "OpenAI" },
    { icon: <ClaudeIcon className="w-4.5 h-4.5" />, connected: claudeConnected, label: "Claude" },
    { icon: <XAIIcon size={16} />, connected: grokConnected, label: "Grok" },
    { icon: <GeminiIcon size={16} />, connected: geminiConnected, label: "Gemini" },
    { icon: <SpotifyIcon className="w-4.5 h-4.5" />, connected: spotifyConnected, label: "Spotify" },
    { icon: <YouTubeIcon className="w-4 h-4" />, connected: youtubeConnected, label: "YouTube" },
    { icon: <GmailIcon className="w-4 h-4" />, connected: gmailConnected, label: "Gmail" },
    { icon: <GmailCalendarIcon className="w-4 h-4" />, connected: gcalendarConnected, label: "Google Calendar" },
    { icon: <BraveIcon className="w-4.5 h-4.5" />, connected: braveConnected, label: "Brave" },
    { icon: <NewsIcon className="w-4 h-4" />, connected: newsConnected, label: "News" },
    { icon: <CoinbaseIcon className="w-4.5 h-4.5" />, connected: coinbaseConnected, label: "Coinbase" },
  ] as const

  const previewManagers = NOVA_DOMAIN_MANAGERS.slice(0, 3)
  const previewWorkerCount = NOVA_DOMAIN_MANAGERS.reduce((sum, m) => sum + m.workers.length, 0)
  const previewOnlineCount = NOVA_DOMAIN_MANAGERS.reduce(
    (sum, m) => sum + m.workers.filter((w) => w.status === "online").length,
    0,
  )
  const presence = getNovaPresence({ agentConnected: connected, novaState })
  const [orbHovered, setOrbHovered] = useState(false)
  const orbHoverFilter = `drop-shadow(0 0 8px ${hexToRgba(orbPalette.circle1, 0.55)}) drop-shadow(0 0 14px ${hexToRgba(orbPalette.circle2, 0.35)})`
  // ── Panel header helper ──────────────────────────────────────────────────
  const renderPanelHeader = ({
    icon,
    title,
    action,
  }: {
    icon: React.ReactNode
    title: string
    action?: React.ReactNode
  }) => (
    <div className="relative flex items-center justify-between gap-2 shrink-0">
      <div className="flex items-center gap-2 text-s-80">{icon}</div>
      <h2
        className={cn(
          "absolute left-1/2 -translate-x-1/2 text-sm uppercase tracking-[0.22em] font-semibold whitespace-nowrap",
          isLight ? "text-s-90" : "text-slate-200",
        )}
      >
        {title}
      </h2>
      <div className="flex items-center gap-1.5">{action}</div>
    </div>
  )

  const renderGearButton = ({
    onClick,
    label,
    groupName,
    hoverGlow = true,
  }: {
    onClick: () => void
    label: string
    groupName: string
    hoverGlow?: boolean
  }) => (
    <button
      onClick={onClick}
      className={cn(
        `h-7 w-7 rounded-md transition-colors home-spotlight-card home-border-glow ${hoverGlow ? "home-spotlight-card--hover" : ""} group group/${groupName}`,
        subPanelClass,
      )}
      aria-label={label}
      title={label}
    >
      <Settings
        className={`w-3.5 h-3.5 mx-auto text-s-50 group-hover:text-accent group-hover:rotate-90 group-hover/${groupName}:text-accent group-hover/${groupName}:rotate-90 transition-transform duration-200`}
      />
    </button>
  )

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [profileName, setProfileName] = useState("User")
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null)

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

  return (
    <div
      className={cn(
        "relative flex h-dvh overflow-hidden",
        isLight ? "bg-[#f6f8fc] text-s-90" : "bg-transparent text-slate-100",
      )}
    >
      <div ref={homeShellRef} className="flex-1 relative overflow-hidden home-spotlight-shell">
        {/* ── 3-zone flex layout ─────────────────────────────────────────── */}
        <div className="relative z-10 h-full w-full px-4 pt-3 pb-4 flex flex-col gap-1.5">
          <header className="shrink-0 grid grid-cols-[auto_1fr_auto] items-center gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={() => router.push("/home")}
                  onMouseEnter={() => setOrbHovered(true)}
                  onMouseLeave={() => setOrbHovered(false)}
                  className="group relative h-11 w-11 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-110"
                  aria-label="Go to home"
                >
                  <NovaOrbIndicator
                    palette={orbPalette}
                    size={30}
                    animated={pageActive}
                    className="transition-all duration-200"
                    style={{ filter: orbHovered ? orbHoverFilter : "none" }}
                  />
                </button>
                <div className="min-w-0">
                  <div className="flex flex-col leading-tight">
                    <div className="flex items-baseline gap-3">
                      <h1 className={cn("text-[30px] leading-none font-semibold tracking-tight", isLight ? "text-s-90" : "text-white")}>NovaOS</h1>
                      <p className="text-[11px] text-accent font-mono">{NOVA_VERSION}</p>
                    </div>
                    <div className="mt-0.5 flex items-center gap-3">
                      <div className="inline-flex items-center gap-1.5">
                        <span className={cn("h-2.5 w-2.5 rounded-full animate-pulse", presence.dotClassName)} aria-hidden="true" />
                        <span className={cn("text-[11px] font-semibold uppercase tracking-[0.14em]", presence.textClassName)}>
                          {presence.label}
                        </span>
                      </div>
                      <p className={cn("text-[13px] whitespace-nowrap", isLight ? "text-s-50" : "text-slate-400")}>Home Control Surface</p>
                    </div>
                  </div>
                </div>
              </div>
              <div />
              <div className="flex items-center gap-2">
                <div className={cn("flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg home-spotlight-card home-border-glow", subPanelClass)}>
                    <div className={cn("w-8 h-8 rounded-lg overflow-hidden border grid place-items-center text-xs font-semibold", isLight ? "border-[#cdd9ea] bg-[#edf2fb]" : "home-subpanel-surface")}>
                      {profileAvatar ? (
                        <Image
                          src={profileAvatar}
                          alt="Profile"
                          width={32}
                          height={32}
                          className="w-full h-full object-cover"
                          unoptimized
                        />
                      ) : (
                        <span>{profileName.charAt(0).toUpperCase()}</span>
                      )}
                  </div>
                  <p className={cn("text-sm font-medium truncate max-w-36", isLight ? "text-s-90" : "text-slate-100")}>
                    {profileName}
                  </p>
                </div>
                <button
                  onClick={() => setSettingsOpen(true)}
                  className={cn("h-11 w-11 rounded-lg transition-colors group/home-gear home-spotlight-card home-border-glow", subPanelClass)}
                  aria-label="Open settings"
                  title="Settings"
                >
                  <Settings className="w-5 h-5 mx-auto text-s-50 group-hover/home-gear:text-accent group-hover/home-gear:rotate-90 transition-transform duration-200" />
                </button>
              </div>
          </header>

          <div className="flex-1 min-h-0 flex gap-1.5">

            {/* ── ZONE 1: Schedule (left column) ─────────────────────────── */}
            <div className="w-[15.5rem] shrink-0 min-h-0 grid grid-rows-2 gap-1.5">
              <div className="min-h-0">
                <ScheduleBriefing
                  isLight={isLight}
                  panelClass={`${panelClass} home-spotlight-shell`}
                  subPanelClass={subPanelClass}
                  panelStyle={panelStyle}
                  sectionRef={scheduleSectionRef}
                  onOpenCalendar={openCalendar}
                />
              </div>

              <section
                ref={pipelineSectionRef}
                style={panelStyle}
                className={`${panelClass} home-spotlight-shell p-4 min-h-0 h-full flex flex-col`}
              >
                {renderPanelHeader({
                  icon: <Pin className="w-4 h-4 text-accent" />,
                  title: "Missions Hub",
                  action: renderGearButton({
                    onClick: openMissions,
                    label: "Open mission settings",
                    groupName: "mission-gear",
                    hoverGlow: false,
                  }),
                })}
                <div className="mt-1 min-h-0 flex-1 overflow-y-auto no-scrollbar space-y-1.5 px-1 py-1">
                  {missions.length === 0 && (
                    <p className={cn("text-xs", isLight ? "text-s-40" : "text-slate-500")}>
                      No missions yet. Add one in Mission Settings.
                    </p>
                  )}
                  {missions.map((mission) => (
                    <div
                      key={mission.id}
                      className={cn(
                        `${subPanelClass} p-2 home-spotlight-card home-border-glow`,
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn("text-[13px] leading-tight", isLight ? "text-s-90" : "text-slate-100")}>
                          {mission.title}
                        </p>
                        <span
                          className={cn(
                            "text-[9px] px-1.5 py-0 rounded-full border whitespace-nowrap shrink-0",
                            mission.enabledCount > 0
                              ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-300"
                              : "border-rose-300/40 bg-rose-500/15 text-rose-300",
                          )}
                        >
                          {mission.enabledCount > 0 ? "Active" : "Paused"}
                        </span>
                      </div>
                      {mission.description ? (
                        <p className={cn("mt-0.5 text-[11px] leading-4 line-clamp-2", isLight ? "text-s-60" : "text-slate-400")}>
                          {mission.description}
                        </p>
                      ) : null}
                      <div className="mt-1.5 flex items-end justify-between gap-2">
                        <div className="flex flex-wrap gap-1">
                          {mission.times.map((time, index) => (
                            <span
                              key={`${mission.id}-${time}-${index}`}
                              className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded-md border",
                                isLight ? "border-[#d6deea] bg-[#edf2fb] text-s-70" : "home-subpanel-surface text-slate-300",
                              )}
                            >
                              {formatDailyTime(time, mission.timezone)}
                            </span>
                          ))}
                        </div>
                        <span
                          className={cn(
                            "text-[9px] px-1.5 py-0 rounded-full border whitespace-nowrap capitalize shrink-0",
                            mission.priority === "low" &&
                              (isLight
                                ? "border-emerald-300 bg-emerald-100 text-emerald-700"
                                : "border-emerald-300/40 bg-emerald-500/15 text-emerald-300"),
                            mission.priority === "medium" &&
                              (isLight
                                ? "border-amber-300 bg-amber-100 text-amber-700"
                                : "border-amber-300/40 bg-amber-500/15 text-amber-300"),
                            mission.priority === "high" &&
                              (isLight
                                ? "border-orange-300 bg-orange-100 text-orange-700"
                                : "border-orange-300/40 bg-orange-500/15 text-orange-300"),
                            mission.priority === "critical" &&
                              (isLight
                                ? "border-rose-300 bg-rose-100 text-rose-700"
                                : "border-rose-300/40 bg-rose-500/15 text-rose-300"),
                          )}
                        >
                          {mission.priority}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* ── ZONE 2: Center column ──────────────────────────────────── */}
            <div className="flex-1 flex flex-col gap-1.5 min-w-0 min-h-0">
            {/* ── Top row: YouTube + Spotify + Polymarket (left of Integrations) ── */}
            <div className="shrink-0 min-h-0 flex flex-col xl:flex-row xl:items-stretch gap-1.5 xl:h-[clamp(15rem,30vh,18.5rem)]">
              <YouTubeHomeModule
                isLight={isLight}
                panelClass={panelClass}
                subPanelClass={subPanelClass}
                panelStyle={panelStyle}
                className="w-full xl:w-[24rem] 2xl:w-[26rem] min-w-0 h-[clamp(15rem,30vh,18.5rem)] xl:h-full shrink-0"
                connected={youtubeConnected}
                onOpenIntegrations={openIntegrations}
              />
              <SpotifyHomeModule
                isLight={isLight}
                panelClass={panelClass}
                subPanelClass={subPanelClass}
                panelStyle={panelStyle}
                sectionRef={spotifyModuleSectionRef}
                className="w-full xl:w-67 min-w-0 h-[clamp(15rem,30vh,18.5rem)] xl:h-full shrink-0"
                connected={spotifyConnected}
                nowPlaying={spotifyNowPlaying}
                error={spotifyError}
                busyAction={spotifyBusyAction}
                onOpenIntegrations={openIntegrations}
                onTogglePlayPause={toggleSpotifyPlayback}
                onNext={spotifyNextTrack}
                onPrevious={spotifyPreviousTrack}
                onPlaySmart={spotifyPlaySmart}
                onSeek={seekSpotify}
              />
              <PolymarketLiveLinesModule
                isLight={isLight}
                panelClass={panelClass}
                subPanelClass={subPanelClass}
                panelStyle={panelStyle}
                className="w-full xl:flex-1 min-w-0 h-[clamp(15rem,30vh,18.5rem)] xl:h-full"
                onOpenIntegrations={openIntegrations}
              />
            </div>

            <div className="flex-1 min-h-0" aria-hidden="true" />

            {/* ── Bottom row: market + dev + history panels ── */}
            <div className="grid grid-cols-4 gap-1.5 shrink-0 h-47">

              {/* Crypto Prices */}
              <section
                style={panelStyle}
                className={`${panelClass} home-spotlight-shell px-3 py-2.5 flex flex-col`}
              >
                {renderPanelHeader({
                  icon: <TrendingUp className="w-4 h-4 text-accent" />,
                  title: "Crypto Prices",
                  action: (
                    <button
                      onClick={() => {
                        const order = cryptoRangeOptions.map((o) => o.id)
                        const idx = order.indexOf(cryptoRange)
                        setCryptoRange(order[(idx + 1) % order.length])
                      }}
                      className={cn(
                        "h-5 min-w-7 px-1 text-[9px] font-semibold uppercase tracking-[0.12em] transition-colors",
                        isLight ? "text-accent" : "text-slate-100",
                      )}
                      aria-label={`Crypto range: ${cryptoRange}. Click to cycle.`}
                    >
                      {cryptoRangeOptions.find((o) => o.id === cryptoRange)?.label ?? "1D"}
                    </button>
                  ),
                })}
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {cryptoRows.map((asset) => {
                    const up = asset.changePct >= 0
                    const trendStroke = up ? "#34d399" : "#fb7185"
                    return (
                    <div
                      key={asset.symbol}
                      className={cn(
                        "flex items-center justify-between px-2 py-1 rounded-sm home-spotlight-card home-border-glow",
                        subPanelClass,
                      )}
                    >
                      <span className={cn("text-[11px] font-semibold", isLight ? "text-s-60" : "text-slate-400")}>
                          {asset.symbol}
                        </span>
                      <div className="mx-2 flex-1 min-w-0">
                        <svg
                          viewBox="0 0 56 12"
                          className="h-3 w-full"
                          preserveAspectRatio="none"
                          aria-hidden="true"
                        >
                          <polyline
                            points={sparklinePoints(asset.chart)}
                            fill="none"
                            stroke={trendStroke}
                            strokeWidth="1.25"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                      <div className="text-right">
                        <p
                          className={cn(
                            "text-[13px] font-semibold tabular-nums leading-tight",
                            isLight ? "text-s-90" : "text-slate-100",
                          )}
                        >
                          {fmtUsd(asset.price)}
                        </p>
                        <p className={cn("text-[10px] tabular-nums", up ? "text-emerald-400" : "text-rose-400")}>
                          {fmtPct(asset.changePct)}
                        </p>
                      </div>
                    </div>
                    )
                  })}
                </div>
              </section>

              {/* Commodities */}
              <section
                style={panelStyle}
                className={`${panelClass} home-spotlight-shell px-3 py-2.5 flex flex-col`}
              >
                {renderPanelHeader({
                  icon: <BarChart2 className="w-4 h-4 text-accent" />,
                  title: "Commodities",
                })}
                <p className={cn("text-[11px] mt-0.5", isLight ? "text-s-50" : "text-slate-400")}>
                  Placeholder pricing tiles
                </p>
                <div className="mt-2 flex-1 flex flex-col justify-around gap-1">
                  {COMMODITIES.map((c) => (
                    <div
                      key={c.name}
                      className={cn(
                        "flex items-center justify-between px-2 py-1.5 rounded-sm home-spotlight-card home-border-glow",
                        subPanelClass,
                      )}
                    >
                      <span className={cn("text-[12px]", isLight ? "text-s-80" : "text-slate-200")}>{c.name}</span>
                      <div className="flex items-baseline gap-2">
                        <span
                          className={cn(
                            "text-[13px] font-semibold tabular-nums",
                            isLight ? "text-s-90" : "text-slate-100",
                          )}
                        >
                          {c.price}
                        </span>
                        <span className={cn("text-[10px] tabular-nums", c.up ? "text-emerald-400" : "text-rose-400")}>
                          {c.change}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Dev Tools */}
              <section
                ref={devToolsSectionRef}
                style={panelStyle}
                className={`${panelClass} home-spotlight-shell px-3 py-2.5 flex flex-col`}
              >
                {renderPanelHeader({
                  icon: <Activity className="w-4 h-4 text-accent" />,
                  title: "Dev Tools",
                  action: renderGearButton({
                    onClick: openDevLogs,
                    label: "Open dev logs",
                    groupName: "macro-dev-gear",
                    hoverGlow: false,
                  }),
                })}
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {devMetricTiles.map(({ label, value, color }) => (
                    <div
                      key={label}
                      className={cn(
                        "px-2 py-1.5 rounded-sm border text-center home-spotlight-card home-border-glow",
                        subPanelClass,
                      )}
                    >
                      <p className="text-[9px] uppercase tracking-widest opacity-60 whitespace-nowrap">{label}</p>
                      <p className={cn("text-[15px] font-semibold tabular-nums leading-tight mt-0.5", color)}>
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Day in History */}
              <section
                style={panelStyle}
                className={`${panelClass} home-spotlight-shell px-3 py-2 flex flex-col`}
              >
                {renderPanelHeader({
                  icon: <History className="w-4 h-4 text-accent" />,
                  title: "On This Day",
                })}
                {dayInHistoryLoading && (
                  <p className={cn("text-[11px] mt-2 text-center", isLight ? "text-s-50" : "text-slate-400")}>Loading...</p>
                )}
                {dayInHistoryError && !dayInHistoryLoading && (
                  <p className="text-[11px] mt-2 text-center text-rose-400">{dayInHistoryError}</p>
                )}
                {!dayInHistoryLoading && !dayInHistoryError && dayInHistoryEvents.length > 0 && (
                  <div className="mt-1.5 flex flex-col gap-1.5">
                    {dayInHistoryEvents.map((evt, i) => {
                      const monthIndex = Number.isFinite(Number(evt.month))
                        ? Math.min(12, Math.max(1, Math.floor(Number(evt.month))))
                        : 1
                      const day = Number.isFinite(Number(evt.day))
                        ? Math.min(31, Math.max(1, Math.floor(Number(evt.day))))
                        : 1
                      const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
                      const eventLabel = `${monthNames[monthIndex - 1]} ${day}`
                      return (
                          <div
                          key={i}
                          className={cn(
                            "px-2.5 py-2 rounded-md border home-spotlight-card home-border-glow",
                            subPanelClass,
                          )}
                        >
                          <p className={cn("text-[12px] font-semibold tabular-nums", isLight ? "text-s-90" : "text-slate-100")}>
                            {eventLabel}, {evt.year}
                          </p>
                          <p className={cn(
                            "text-[11px] mt-0.5 leading-normal",
                            isLight ? "text-s-80" : "text-slate-300",
                          )}>
                            {evt.event}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                )}
                {!dayInHistoryLoading && !dayInHistoryError && dayInHistoryEvents.length === 0 && (
                  <p className={cn("text-[11px] mt-2 text-center", isLight ? "text-s-50" : "text-slate-400")}>
                    No events found for today.
                  </p>
                )}
              </section>

            </div>
            </div>

          {/* ── ZONE 3: Right column (Integrations / News / Agent Chart) ── */}
          <div className="w-67 shrink-0 flex flex-col gap-1.5 min-h-0">

            {/* Integrations */}
            <section
              ref={integrationsSectionRef}
              style={panelStyle}
              className={`${panelClass} home-spotlight-shell h-[clamp(15rem,30vh,18.5rem)] px-3 pb-2 pt-2.5 flex flex-col shrink-0`}
            >
              {renderPanelHeader({
                icon: <Blocks className="w-4 h-4 text-accent" />,
                title: "Integrations",
                action: renderGearButton({ onClick: openIntegrations, label: "Open integrations", groupName: "integrations-gear" }),
              })}
              <div className={cn("mt-4.5 p-1.5 rounded-lg", subPanelClass)}>
                <div className="grid grid-cols-5 gap-1" style={{ gridTemplateRows: "repeat(5, 2rem)" }}>
                  {integrationNodes.map(({ icon, connected, label }) => (
                    <button
                      key={label}
                      onClick={goToIntegrations}
                      className={cn(
                        "h-8 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                        integrationBadgeClass(connected),
                      )}
                      aria-label={`${label}: ${connected ? "connected" : "not connected"}`}
                      title={label}
                    >
                      {icon}
                    </button>
                  ))}
                  {Array.from({ length: Math.max(0, 25 - integrationNodes.length) }).map((_, i) => (
                    <div
                      key={i}
                      className={cn(
                        "h-8 rounded-sm border home-spotlight-card home-border-glow",
                        isLight ? "border-[#d5dce8] bg-[#eef3fb]" : "home-subpanel-surface",
                      )}
                    />
                  ))}
                </div>
              </div>
            </section>

            {/* Live News — fills space between Integrations and Agent Chart */}
            <NewsFeedModule
              isLight={isLight}
              panelClass={panelClass}
              subPanelClass={subPanelClass}
              panelStyle={panelStyle}
              sectionRef={newsModuleSectionRef}
              className="flex-1 min-h-0"
              connected={newsConnected}
              articles={newsArticles}
              loading={newsLoading}
              error={newsError}
              stale={newsStale}
              fetchedAt={newsFetchedAt}
              onOpenIntegrations={openIntegrations}
              onRefresh={refreshNewsFeed}
            />

            {/* Agent Chart */}
            <section
              ref={agentModuleSectionRef}
              style={panelStyle}
              className={`${panelClass} home-spotlight-shell h-47 px-3 py-2 shrink-0 flex flex-col`}
            >
              {renderPanelHeader({
                icon: <Network className="w-4 h-4 text-accent" />,
                title: "Agent Chart",
                action: renderGearButton({
                  onClick: openAgents,
                  label: "Open agent chart",
                  groupName: "agents-gear",
                  hoverGlow: false,
                }),
              })}
              <div className="mt-2.5">
                <div
                  className={cn(
                    "rounded-md border px-2 py-1.5 home-spotlight-card home-border-glow",
                    isLight ? "border-[#cdd9ea] bg-[#edf2fb]" : "home-subpanel-surface",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-1.5">
                      <Bot className="w-3.5 h-3.5 text-accent" />
                      <p className={cn("text-[11px] font-semibold", isLight ? "text-s-90" : "text-slate-100")}>
                        Nova Operator
                      </p>
                    </div>
                    <span className="rounded-full border border-emerald-300/40 bg-emerald-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-emerald-200">
                      online
                    </span>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {previewManagers.map((manager) => (
                    <button
                      key={manager.id}
                      onClick={openAgents}
                      className={cn(
                        "rounded-md border px-1.5 py-1 text-left transition-colors home-spotlight-card home-border-glow",
                        isLight ? "border-[#cdd9ea] bg-[#edf2fb]" : "home-subpanel-surface",
                      )}
                    >
                      <p className={cn("text-[10px] font-semibold truncate", isLight ? "text-s-80" : "text-slate-200")}>
                        {manager.label}
                      </p>
                      <p className={cn("text-[9px] mt-0.5", isLight ? "text-s-50" : "text-slate-400")}>
                        {manager.workers.length} workers
                      </p>
                    </button>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  <div
                    className={cn(
                      "rounded-md border px-1.5 py-1 home-spotlight-card home-border-glow",
                      isLight ? "border-[#cdd9ea] bg-[#edf2fb]" : "home-subpanel-surface",
                    )}
                  >
                    <p className="text-[9px] uppercase tracking-[0.08em] opacity-70">Managers</p>
                    <p className="text-[12px] font-semibold">{NOVA_DOMAIN_MANAGERS.length}</p>
                  </div>
                  <div
                    className={cn(
                      "rounded-md border px-1.5 py-1 home-spotlight-card home-border-glow",
                      isLight ? "border-[#cdd9ea] bg-[#edf2fb]" : "home-subpanel-surface",
                    )}
                  >
                    <p className="text-[9px] uppercase tracking-[0.08em] opacity-70">Online</p>
                    <p className="text-[12px] font-semibold">
                      {previewOnlineCount}/{previewWorkerCount}
                    </p>
                  </div>
                </div>
              </div>
            </section>

          </div>
        </div>
      </div>
    </div>
    <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
  </div>
  )
}
