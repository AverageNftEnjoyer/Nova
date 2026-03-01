"use client"

import { Blocks, Pin, Settings, Activity, Clock3, CheckCircle2, AlertTriangle, Network, Bot } from "lucide-react"
import { ScheduleBriefing } from "./schedule-briefing"
import type { CSSProperties } from "react"
import { NovaOrb3D, type OrbState } from "@/components/orb/NovaOrb3D"
import TextType from "@/components/effects/TextType"
import { ChatSidebar } from "@/components/chat/chat-sidebar"
import { BraveIcon, ClaudeIcon, CoinbaseIcon, DiscordIcon, GeminiIcon, GmailCalendarIcon, GmailIcon, OpenAIIcon, SpotifyIcon, TelegramIcon, XAIIcon } from "@/components/icons"
import { Composer } from "@/components/chat/composer"
import { cn } from "@/lib/shared/utils"
import { NOVA_DOMAIN_MANAGERS } from "@/app/agents/agent-chart-data"
import { formatDailyTime } from "../helpers"
import { useHomeMainScreenState } from "../hooks/use-home-main-screen-state"
import { SpotifyHomeModule } from "./spotify-home-module"

export function HomeMainScreen() {
  const {
    isLight,
    conversations,
    sidebarOpen,
    handleSelectConvo,
    handleNewChat,
    handleDeleteConvo,
    handleRenameConvo,
    handleArchiveConvo,
    handlePinConvo,
    goToBootup,
    novaState,
    connected,
    hasAnimated,
    assistantName,
    orbPalette,
    welcomeMessage,
    handleSend,
    isMuted,
    handleMuteToggle,
    muteHydrated,
    pipelineSectionRef,
    scheduleSectionRef,
    analyticsSectionRef,
    devToolsSectionRef,
    integrationsSectionRef,
    spotifyModuleSectionRef,
    agentModuleSectionRef,
    panelStyle,
    panelClass,
    subPanelClass,
    missionHover,
    missions,
    openMissions,
    openCalendar,
    openIntegrations,
    openAnalytics,
    openDevLogs,
    openAgents,
    liveActivity,
    devToolsMetrics,
    integrationBadgeClass,
    goToIntegrations,
    telegramConnected,
    discordConnected,
    braveConnected,
    coinbaseConnected,
    openaiConnected,
    claudeConnected,
    grokConnected,
    geminiConnected,
    spotifyConnected,
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
  } = useHomeMainScreenState()

  const formatNumber = (value: unknown) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return "0"
    return n.toLocaleString("en-US")
  }

  const analyticsLiveActivity = liveActivity
  const assistantNameGradientVars = {
    "--orb-name-a": orbPalette.circle1,
    "--orb-name-b": orbPalette.circle2,
    "--orb-name-c": orbPalette.circle4,
  } as CSSProperties
  const orbState: OrbState = (
    novaState === "idle" || novaState === "listening" || novaState === "thinking" || novaState === "speaking"
      ? novaState
      : "idle"
  )

  const iconForActivityService = (service: string) => {
    const value = service.trim().toLowerCase()
    if (value.includes("openai")) return <OpenAIIcon className="w-3.5 h-3.5" />
    if (value.includes("claude")) return <ClaudeIcon className="w-3.5 h-3.5" />
    if (value.includes("grok")) return <XAIIcon size={14} />
    if (value.includes("gemini")) return <GeminiIcon size={14} />
    if (value.includes("spotify")) return <SpotifyIcon className="w-3.5 h-3.5" />
    if (value.includes("telegram")) return <TelegramIcon className="w-3.5 h-3.5" />
    if (value.includes("discord")) return <DiscordIcon className="w-3.5 h-3.5" />
    if (value.includes("gcalendar") || value.includes("gmail-calendar")) return <GmailCalendarIcon className="w-3.5 h-3.5" />
    if (value.includes("gmail")) return <GmailIcon className="w-3.5 h-3.5" />
    if (value.includes("brave")) return <BraveIcon className="w-3.5 h-3.5" />
    if (value.includes("coinbase")) return <CoinbaseIcon className="w-3.5 h-3.5" />
    return <Activity className="w-3.5 h-3.5" />
  }

  const integrationNodes = [
    { icon: <TelegramIcon className="w-4 h-4" />, connected: telegramConnected, label: "Telegram" },
    { icon: <DiscordIcon className="w-4 h-4" />, connected: discordConnected, label: "Discord" },
    { icon: <OpenAIIcon className="w-4.5 h-4.5" />, connected: openaiConnected, label: "OpenAI" },
    { icon: <ClaudeIcon className="w-4.5 h-4.5" />, connected: claudeConnected, label: "Claude" },
    { icon: <XAIIcon size={16} />, connected: grokConnected, label: "Grok" },
    { icon: <GeminiIcon size={16} />, connected: geminiConnected, label: "Gemini" },
    { icon: <SpotifyIcon className="w-4.5 h-4.5" />, connected: spotifyConnected, label: "Spotify" },
    { icon: <GmailIcon className="w-4 h-4" />, connected: gmailConnected, label: "Gmail" },
    { icon: <GmailCalendarIcon className="w-4 h-4" />, connected: gcalendarConnected, label: "Google Calendar" },
    { icon: <BraveIcon className="w-4.5 h-4.5" />, connected: braveConnected, label: "Brave" },
    { icon: <CoinbaseIcon className="w-4.5 h-4.5" />, connected: coinbaseConnected, label: "Coinbase" },
  ] as const
  const fillerSlots = Math.max(0, 25 - integrationNodes.length)
  const previewManagers = NOVA_DOMAIN_MANAGERS.slice(0, 3)
  const previewWorkerCount = NOVA_DOMAIN_MANAGERS.reduce((sum, manager) => sum + manager.workers.length, 0)
  const previewOnlineCount = NOVA_DOMAIN_MANAGERS.reduce(
    (sum, manager) => sum + manager.workers.filter((worker) => worker.status === "online").length,
    0,
  )

  return (
    <div className={cn("relative flex h-dvh overflow-hidden", isLight ? "bg-[#f6f8fc] text-s-90" : "bg-transparent text-slate-100")}>

      <ChatSidebar
        conversations={conversations}
        activeId={null}
        isOpen={sidebarOpen}
        onSelect={handleSelectConvo}
        onNew={handleNewChat}
        onDelete={handleDeleteConvo}
        onRename={handleRenameConvo}
        onArchive={handleArchiveConvo}
        onPin={handlePinConvo}
        onReplayBoot={goToBootup}
        novaState={novaState}
        agentConnected={connected}
      />

      <div
        className="flex-1 relative overflow-hidden"
        style={{
          marginLeft: "0",
        }}
      >

        <div className="relative z-10 h-full w-full px-6 pt-4 pb-6">
          {/*
            5-col equal grid, 2 rows:
            Row 1 (flex): [Schedule col1] [Orb+Composer flex-col col2-4] [Mission Pipeline col5]
            Row 2 (auto): [Mod Slot 1] [Mod Slot 2] [Analytics] [Dev Tools] [Nova Integrations]
          */}
          <div className="grid h-full grid-cols-1 gap-4 xl:grid-cols-[repeat(5,minmax(0,1fr))] xl:grid-rows-[minmax(0,1fr)_auto]">

            {/* ── Col 1, Row 1: Schedule (full height of row 1) ── */}
            <div className="min-h-0 flex flex-col xl:col-start-1 xl:row-start-1">
              <ScheduleBriefing
                isLight={isLight}
                panelClass={`${panelClass} home-spotlight-shell`}
                subPanelClass={subPanelClass}
                panelStyle={panelStyle}
                sectionRef={scheduleSectionRef}
                onOpenCalendar={openCalendar}
              />
            </div>

            {/* ── Cols 2–4, Row 1: Orb + Text (flex-1) then Composer pinned to bottom ── */}
            <div className="min-h-0 flex flex-col xl:col-start-2 xl:col-span-3 xl:row-start-1">
              <div className="flex-1 min-h-0 overflow-hidden flex flex-col items-center justify-center gap-4 py-4">
                <div className={`relative h-70 w-70 ${hasAnimated ? "orb-intro" : ""}`}>
                  {(
                    <>
                      {isLight && (
                        <div
                          className="absolute -inset-3 rounded-full"
                          style={{
                            background: "radial-gradient(circle, rgba(15,23,42,0.14) 0%, rgba(15,23,42,0.05) 52%, transparent 76%)",
                          }}
                        />
                      )}
                      <NovaOrb3D
                        size={280}
                        palette={orbPalette}
                        orbState={orbState}
                        quality="high"
                        intensity={1}
                        theme={isLight ? "light" : "dark"}
                      />
                    </>
                  )}
                </div>
                <div className="text-center">
                  <p className={cn(`mt-2 text-5xl font-semibold ${hasAnimated ? "text-blur-intro" : ""}`, isLight ? "text-s-90" : "text-white")}>
                    Hi, I&apos;m{" "}
                    <span className="assistant-name-orb-gradient" style={assistantNameGradientVars}>
                      {assistantName}
                    </span>
                  </p>
                  <p className={cn(`mt-3 text-lg ${hasAnimated ? "text-blur-intro-delay" : ""}`, isLight ? "text-s-50" : "text-slate-400")}>
                    <TextType
                      key={welcomeMessage}
                      as="span"
                      text={welcomeMessage}
                      typingSpeed={75}
                      pauseDuration={1500}
                      showCursor
                      cursorCharacter="_"
                      deletingSpeed={50}
                      loop={false}
                      className="inline-block"
                    />
                  </p>
                </div>
              </div>
              <div className="relative w-full shrink-0">
                <Composer
                  onSend={handleSend}
                  isStreaming={false}
                  disabled={!connected}
                  isMuted={isMuted}
                  onToggleMute={handleMuteToggle}
                  muteHydrated={muteHydrated}
                />
              </div>
            </div>

            {/* ── Col 5, Row 1: Mission Pipeline ── */}
            {/* ── Col 5, Row 2: Nova Integrations ── */}
            <aside className="contents">
              <section ref={pipelineSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 min-h-0 flex flex-col xl:col-start-5 xl:row-start-1`}>
                <div className="relative flex items-center justify-between gap-2 text-s-80">
                  <div className="flex items-center gap-2">
                    <Pin className="w-4 h-4 text-accent" />
                  </div>
                  <h2 className={cn("absolute left-1/2 -translate-x-1/2 text-sm uppercase tracking-[0.22em] font-semibold whitespace-nowrap", isLight ? "text-s-90" : "text-slate-200")}>Missions Hub</h2>
                  <button
                    onClick={openMissions}
                    className={cn(`h-8 w-8 rounded-lg transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover group/mission-gear`, subPanelClass)}
                    aria-label="Open mission settings"
                  >
                    <Settings className="w-3.5 h-3.5 mx-auto text-s-50 group-hover/mission-gear:text-accent group-hover/mission-gear:rotate-90 transition-transform duration-200" />
                  </button>
                </div>
                <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>Scheduled Nova workflows</p>

                <div className="mt-2.5 min-h-0 flex-1 overflow-y-auto no-scrollbar space-y-1.5 px-1 py-1">
                  {missions.length === 0 && (
                    <p className={cn("text-xs", isLight ? "text-s-40" : "text-slate-500")}>
                      No missions yet. Add one in Mission Settings.
                    </p>
                  )}
                  {missions.map((mission) => (
                    <div key={mission.id} className={cn(`${subPanelClass} p-2 transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover mission-spotlight-card`, missionHover)}>
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn("text-[13px] leading-tight", isLight ? "text-s-90" : "text-slate-100")}>{mission.title}</p>
                        <div className="flex items-center gap-1 flex-nowrap shrink-0">
                          <span
                            className={cn(
                              "text-[9px] px-1.5 py-0 rounded-full border whitespace-nowrap",
                              mission.enabledCount > 0
                                ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-300"
                                : "border-rose-300/40 bg-rose-500/15 text-rose-300",
                            )}
                          >
                            {mission.enabledCount > 0 ? "Active" : "Paused"}
                          </span>
                        </div>
                      </div>
                      {mission.description ? (
                        <p className={cn("mt-0.5 text-[11px] leading-4 line-clamp-2", isLight ? "text-s-60" : "text-slate-400")}>{mission.description}</p>
                      ) : null}
                      <div className="mt-1.5 flex items-end justify-between gap-2">
                        <div className="flex flex-wrap gap-1">
                          {mission.times.map((time, index) => (
                            <span key={`${mission.id}-${time}-${index}`} className={cn("text-[10px] px-1.5 py-0.5 rounded-md border", isLight ? "border-[#d6deea] bg-[#edf2fb] text-s-70" : "border-white/10 bg-white/4 text-slate-300")}>
                              {formatDailyTime(time, mission.timezone)}
                            </span>
                          ))}
                        </div>
                        <span
                          title={`Priority: ${mission.priority}`}
                          aria-label={`Priority ${mission.priority}`}
                          className={cn(
                            "text-[9px] px-1.5 py-0 rounded-full border whitespace-nowrap capitalize shrink-0",
                            mission.priority === "low" && (isLight ? "border-emerald-300 bg-emerald-100 text-emerald-700" : "border-emerald-300/40 bg-emerald-500/15 text-emerald-300"),
                            mission.priority === "medium" && (isLight ? "border-amber-300 bg-amber-100 text-amber-700" : "border-amber-300/40 bg-amber-500/15 text-amber-300"),
                            mission.priority === "high" && (isLight ? "border-orange-300 bg-orange-100 text-orange-700" : "border-orange-300/40 bg-orange-500/15 text-orange-300"),
                            mission.priority === "critical" && (isLight ? "border-rose-300 bg-rose-100 text-rose-700" : "border-rose-300/40 bg-rose-500/15 text-rose-300"),
                          )}
                        >
                          {mission.priority}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section
                ref={integrationsSectionRef}
                style={panelStyle}
                className={`${panelClass} home-spotlight-shell px-3 pb-2 pt-2 flex flex-col max-h-72 xl:col-start-2 xl:row-start-2`}
              >
                <div className="relative flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 text-s-80">
                    <Blocks className="w-4 h-4 text-accent" />
                  </div>
                  <h2 className={cn("absolute left-1/2 -translate-x-1/2 text-sm uppercase tracking-[0.22em] font-semibold whitespace-nowrap", isLight ? "text-s-90" : "text-slate-200")}>Integrations</h2>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={openIntegrations}
                      className={cn(`h-7 w-7 rounded-lg transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover group/integrations-gear`, subPanelClass)}
                      aria-label="Open integrations settings"
                    >
                      <Settings className="w-3.5 h-3.5 mx-auto text-s-50 group-hover/integrations-gear:text-accent group-hover/integrations-gear:rotate-90 transition-transform duration-200" />
                    </button>
                  </div>
                </div>

                <div>
                  <p className={cn("text-[11px] mt-0.5", isLight ? "text-s-50" : "text-slate-400")}>Node connectivity</p>
                </div>

                <div className={cn("mt-1 flex-1 min-h-0 p-1.5 rounded-lg", subPanelClass)}>
                  <div className="grid h-full grid-cols-5 grid-rows-5 gap-1">
                    {integrationNodes.map(({ icon, connected, label }) => (
                      <button
                        key={label}
                        onClick={goToIntegrations}
                        className={cn(
                          "h-full min-h-0 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                          integrationBadgeClass(connected),
                        )}
                        aria-label={`${label}: ${connected ? "connected" : "not connected"} — manage in integrations`}
                        title={`${label}: ${connected ? "connected" : "not connected"}`}
                      >
                        {icon}
                      </button>
                    ))}
                    {Array.from({ length: fillerSlots }).map((_, index) => (
                      <div
                        key={index}
                        className={cn(
                          "h-full min-h-0 rounded-sm border home-spotlight-card home-border-glow",
                          isLight ? "border-[#d5dce8] bg-[#eef3fb]" : "border-white/10 bg-black/20",
                        )}
                      />
                    ))}
                  </div>
                </div>

                <div className="mt-2" />
              </section>
            </aside>

            {/* ── Row 2, Col 1: Module Slot 1 ── */}
            <SpotifyHomeModule
              isLight={isLight}
              panelClass={panelClass}
              subPanelClass={subPanelClass}
              panelStyle={panelStyle}
              sectionRef={spotifyModuleSectionRef}
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

            {/* ── Row 2, Col 2: Agent Chart ── */}
            <section
              ref={agentModuleSectionRef}
              style={panelStyle}
              className={`${panelClass} home-spotlight-shell hidden xl:flex xl:col-start-5 xl:row-start-2 px-3 pb-2 pt-2 max-h-72 flex-col`}
            >
              <div className="relative flex items-center justify-between gap-2 w-full">
                <div className="flex items-center gap-2 min-w-0 text-s-80">
                  <Network className="w-4 h-4 text-accent" />
                </div>
                <h2 className={cn("absolute left-1/2 -translate-x-1/2 text-sm uppercase tracking-[0.22em] font-semibold whitespace-nowrap", isLight ? "text-s-90" : "text-slate-200")}>Agent Chart</h2>
                <button
                  onClick={openAgents}
                  className={cn(`h-7 w-7 rounded-lg transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover group/agents-gear`, subPanelClass)}
                  aria-label="Open agent chart"
                  title="Open agent chart"
                >
                  <Settings className="w-3.5 h-3.5 mx-auto text-s-50 group-hover/agents-gear:text-accent group-hover/agents-gear:rotate-90 transition-transform duration-200" />
                </button>
              </div>
              <p className={cn("text-[11px] mt-0.5 w-full", isLight ? "text-s-50" : "text-slate-400")}>Operator + manager topology</p>
              <div className={cn("mt-1 w-full flex-1 min-h-0 rounded-lg p-2 border home-spotlight-card home-border-glow", subPanelClass)}>
                <div className={cn("rounded-md border px-2 py-1.5 home-spotlight-card home-border-glow", isLight ? "border-[#cdd9ea] bg-[#edf2fb]" : "border-white/10 bg-white/[0.03]")}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-1.5">
                      <Bot className="w-3.5 h-3.5 text-accent" />
                      <p className={cn("text-[11px] font-semibold", isLight ? "text-s-90" : "text-slate-100")}>Nova Operator</p>
                    </div>
                    <span className="rounded-full border border-emerald-300/40 bg-emerald-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-emerald-200">online</span>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {previewManagers.map((manager) => (
                    <button
                      key={manager.id}
                      onClick={openAgents}
                      className={cn(
                        "rounded-md border px-1.5 py-1 text-left transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover",
                        isLight ? "border-[#cdd9ea] bg-[#edf2fb]" : "border-white/10 bg-black/20",
                      )}
                    >
                      <p className={cn("text-[10px] font-semibold truncate", isLight ? "text-s-80" : "text-slate-200")}>{manager.label}</p>
                      <p className={cn("text-[9px] mt-0.5", isLight ? "text-s-50" : "text-slate-400")}>{manager.workers.length} workers</p>
                    </button>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  <div className={cn("rounded-md border px-1.5 py-1 home-spotlight-card home-border-glow", isLight ? "border-[#cdd9ea] bg-[#edf2fb]" : "border-white/10 bg-black/20")}>
                    <p className="text-[9px] uppercase tracking-[0.08em] opacity-70">Managers</p>
                    <p className="text-[12px] font-semibold">{NOVA_DOMAIN_MANAGERS.length}</p>
                  </div>
                  <div className={cn("rounded-md border px-1.5 py-1 home-spotlight-card home-border-glow", isLight ? "border-[#cdd9ea] bg-[#edf2fb]" : "border-white/10 bg-black/20")}>
                    <p className="text-[9px] uppercase tracking-[0.08em] opacity-70">Online</p>
                    <p className="text-[12px] font-semibold">{previewOnlineCount}/{previewWorkerCount}</p>
                  </div>
                </div>
              </div>
            </section>

            {/* ── Row 2, Col 3: Analytics ── */}
            <section
              ref={analyticsSectionRef}
              style={panelStyle}
              className={`${panelClass} home-spotlight-shell px-3 pb-2 pt-2 flex flex-col max-h-72 xl:col-start-3 xl:row-start-2`}
            >
              <div className="relative flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 text-s-80">
                  <Clock3 className="w-4 h-4 text-accent" />
                </div>
                <h2 className={cn("absolute left-1/2 -translate-x-1/2 text-sm uppercase tracking-[0.22em] font-semibold whitespace-nowrap", isLight ? "text-s-90" : "text-slate-200")}>Analytics</h2>
                <button
                  onClick={openAnalytics}
                  className={cn(`h-7 w-7 rounded-lg transition-colors home-spotlight-card home-border-glow group/analytics-gear`, subPanelClass)}
                  aria-label="Open analytics dashboard"
                  title="Open analytics dashboard"
                >
                  <Settings className="w-3.5 h-3.5 mx-auto text-s-50 group-hover/analytics-gear:text-accent group-hover/analytics-gear:rotate-90 transition-transform duration-200" />
                </button>
              </div>
              <p className={cn("text-[11px] mt-0.5", isLight ? "text-s-50" : "text-slate-400")}>API Activity</p>
              <div className="module-hover-scroll hide-scrollbar mt-1 flex-1 overflow-y-auto overflow-x-hidden pr-0.5">
                <div className="grid grid-cols-2 gap-1">
                  {analyticsLiveActivity.map((event) => (
                    <div key={event.id} className={cn("rounded-sm border px-1.5 py-1 flex items-start gap-1.5 min-w-0 home-spotlight-card home-border-glow", subPanelClass)}>
                      <div className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center">
                        {iconForActivityService(event.service)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-[10px] leading-tight truncate", isLight ? "text-s-90" : "text-slate-100")}>{event.service}</p>
                        <p className={cn("text-[9px] leading-tight truncate", isLight ? "text-s-60" : "text-slate-400")}>{event.action}</p>
                      </div>
                      <div className="inline-flex items-center gap-1 pt-0.5 shrink-0">
                        <p className={cn("text-[9px] font-mono whitespace-nowrap", isLight ? "text-s-50" : "text-slate-400")}>{event.timeAgo}</p>
                        <span className="shrink-0">
                          {event.status === "success"
                            ? <CheckCircle2 className="w-3 h-3 text-emerald-300" />
                            : <AlertTriangle className={cn("w-3 h-3", event.status === "warning" ? "text-amber-300" : "text-rose-300")} />}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ── Row 2, Col 4: Dev Tools ── */}
            <section
              ref={devToolsSectionRef}
              style={panelStyle}
              className={`${panelClass} home-spotlight-shell px-3 pb-2 pt-2 flex flex-col max-h-72 xl:col-start-4 xl:row-start-2`}
            >
              <div className="relative flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 text-s-80">
                  <Activity className="w-4 h-4 text-accent" />
                </div>
                <h2 className={cn("absolute left-1/2 -translate-x-1/2 text-sm uppercase tracking-[0.22em] font-semibold whitespace-nowrap", isLight ? "text-s-90" : "text-slate-200")}>Dev Tools</h2>
                <button
                  onClick={openDevLogs}
                  className={cn(`h-7 w-7 rounded-lg transition-colors home-spotlight-card home-border-glow group/dev-tools-gear`, subPanelClass)}
                  aria-label="Open dev logs dashboard"
                  title="Open dev logs dashboard"
                >
                  <Settings className="w-3.5 h-3.5 mx-auto text-s-50 group-hover/dev-tools-gear:text-accent group-hover/dev-tools-gear:rotate-90 transition-transform duration-200" />
                </button>
              </div>
              <p className={cn("text-[11px] mt-0.5", isLight ? "text-s-50" : "text-slate-400")}>Quality Hub</p>
              <div className="mt-1 grid grid-cols-2 gap-1 flex-1 content-start">
                <div className={cn("min-w-0 px-2 py-1 rounded-sm border home-spotlight-card home-border-glow", subPanelClass)}>
                  <p className="text-[10px] uppercase tracking-[0.1em] opacity-70 whitespace-nowrap">Total Traces</p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums whitespace-nowrap">{formatNumber(devToolsMetrics.totalTraces)}</p>
                </div>
                <div className={cn("min-w-0 px-2 py-1 rounded-sm border home-spotlight-card home-border-glow", subPanelClass)}>
                  <p className="text-[10px] uppercase tracking-[0.1em] opacity-70 whitespace-nowrap">Errors</p>
                  <p className="mt-0.5 text-sm font-semibold text-rose-400 tabular-nums whitespace-nowrap">{formatNumber(devToolsMetrics.errors)}</p>
                </div>
                <div className={cn("min-w-0 px-2 py-1 rounded-sm border home-spotlight-card home-border-glow", subPanelClass)}>
                  <p className="text-[10px] uppercase tracking-[0.1em] opacity-70 whitespace-nowrap">Warnings</p>
                  <p className="mt-0.5 text-sm font-semibold text-amber-300 tabular-nums whitespace-nowrap">{formatNumber(devToolsMetrics.warnings)}</p>
                </div>
                <div className={cn("min-w-0 px-2 py-1 rounded-sm border home-spotlight-card home-border-glow", subPanelClass)}>
                  <p className="text-[10px] uppercase tracking-[0.1em] opacity-70 whitespace-nowrap">Avg Latency</p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums whitespace-nowrap">{formatNumber(devToolsMetrics.avgLatencyMs)}ms</p>
                </div>
                <div className={cn("min-w-0 px-2 py-1 rounded-sm border home-spotlight-card home-border-glow", subPanelClass)}>
                  <p className="text-[10px] uppercase tracking-[0.1em] opacity-70 whitespace-nowrap">Total Tokens</p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums whitespace-nowrap">{formatNumber(devToolsMetrics.totalTokens)}</p>
                </div>
                <div className={cn("min-w-0 px-2 py-1 rounded-sm border home-spotlight-card home-border-glow", subPanelClass)}>
                  <p className="text-[10px] uppercase tracking-[0.1em] opacity-70 whitespace-nowrap">Avg Quality</p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums whitespace-nowrap">{devToolsMetrics.avgQuality.toFixed(1)}</p>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

