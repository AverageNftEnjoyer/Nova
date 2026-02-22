"use client"

import { Blocks, Pin, Settings, BarChart3, Activity } from "lucide-react"
import { AnimatedOrb } from "@/components/orb/animated-orb"
import TextType from "@/components/effects/TextType"
import { ChatSidebar } from "@/components/chat/chat-sidebar"
import { BraveIcon, ClaudeIcon, CoinbaseIcon, DiscordIcon, GeminiIcon, GmailIcon, OpenAIIcon, TelegramIcon, XAIIcon } from "@/components/icons"
import { Composer } from "@/components/chat/composer"
import { cn } from "@/lib/shared/utils"
import { formatDailyTime } from "../helpers"
import { useHomeMainScreenState } from "../hooks/use-home-main-screen-state"

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
    integrationsSectionRef,
    panelStyle,
    panelClass,
    subPanelClass,
    missionHover,
    missions,
    openMissions,
    openIntegrations,
    openAnalytics,
    openDevLogs,
    handleToggleTelegramIntegration,
    handleToggleDiscordIntegration,
    handleToggleBraveIntegration,
    handleToggleCoinbaseIntegration,
    handleToggleOpenAIIntegration,
    handleToggleClaudeIntegration,
    handleToggleGrokIntegration,
    handleToggleGeminiIntegration,
    handleToggleGmailIntegration,
    integrationGuardNotice,
    integrationBadgeClass,
    telegramConnected,
    discordConnected,
    braveConnected,
    coinbaseConnected,
    openaiConnected,
    claudeConnected,
    grokConnected,
    geminiConnected,
    gmailConnected,
  } = useHomeMainScreenState()

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
          <div className="grid h-full grid-cols-[minmax(0,1fr)_360px] gap-6">
            <div className="min-h-0 flex flex-col">
              <div className="flex-1 flex flex-col items-center justify-center gap-6">
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
                      <AnimatedOrb size={280} palette={orbPalette} showStateLabel={false} />
                    </>
                  )}
                </div>
                <div className="text-center">
                  <p className={cn(`mt-2 text-5xl font-semibold ${hasAnimated ? "text-blur-intro" : ""}`, isLight ? "text-s-90" : "text-white")}>
                    Hi, I&apos;m {assistantName}
                  </p>
                  <p className={cn(`mt-3 text-lg ${hasAnimated ? "text-blur-intro-delay" : ""}`, isLight ? "text-s-50" : "text-slate-400")}>
                    <TextType
                      as="span"
                      text={[welcomeMessage]}
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

              <div className="relative w-full min-h-32">
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

            <aside className="min-h-0 flex flex-col gap-4 pt-0">
              <section ref={pipelineSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 min-h-0 flex-1 flex flex-col`}>
                <div className="flex items-center justify-between gap-2 text-s-80">
                  <div className="flex items-center gap-2">
                    <Pin className="w-4 h-4 text-accent" />
                    <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>Mission Pipeline</h2>
                  </div>
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
                className={`${panelClass} home-spotlight-shell p-4`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-s-80">
                    <Blocks className="w-4 h-4 text-accent" />
                    <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>Nova Integrations</h2>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={openAnalytics}
                      className={cn(`h-8 w-8 rounded-lg transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover`, subPanelClass)}
                      aria-label="Open analytics"
                      title="Open analytics"
                    >
                      <BarChart3 className="w-3.5 h-3.5 mx-auto text-s-50 transition-colors hover:text-accent" />
                    </button>
                    <button
                      onClick={openDevLogs}
                      className={cn(`h-8 w-8 rounded-lg transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover`, subPanelClass)}
                      aria-label="Open dev logs dashboard"
                      title="Open dev logs dashboard"
                    >
                      <Activity className="w-3.5 h-3.5 mx-auto text-s-50 transition-colors hover:text-accent" />
                    </button>
                    <button
                      onClick={openIntegrations}
                      className={cn(`h-8 w-8 rounded-lg transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover group/gear`, subPanelClass)}
                      aria-label="Open integrations settings"
                    >
                      <Settings className="w-3.5 h-3.5 mx-auto text-s-50 group-hover/gear:text-accent group-hover/gear:rotate-90 transition-transform duration-200" />
                    </button>
                  </div>
                </div>

                <div className="relative mt-1 h-5">
                  <p className={cn("text-xs", isLight ? "text-s-50" : "text-slate-400")}>Node connectivity</p>
                  {integrationGuardNotice ? (
                    <div className="pointer-events-none absolute right-0 top-1/2 z-20 -translate-y-1/2">
                      <div className={cn("rounded-xl border px-3 py-1.5 text-[12px] font-semibold whitespace-nowrap backdrop-blur-xl shadow-[0_14px_30px_-16px_rgba(0,0,0,0.7)]", isLight ? "border-rose-300 bg-rose-100 text-rose-700" : "border-rose-300/50 bg-rose-950 text-rose-100")}>
                        {integrationGuardNotice}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className={cn("mt-3 p-2 rounded-lg", subPanelClass)}>
                  <div className="grid grid-cols-6 gap-1">
                    <button
                      onClick={handleToggleTelegramIntegration}
                      className={cn(
                        "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                        integrationBadgeClass(telegramConnected),
                      )}
                      aria-label={telegramConnected ? "Disable Telegram integration" : "Enable Telegram integration"}
                      title={telegramConnected ? "Telegram connected (click to disable)" : "Telegram disconnected (click to enable)"}
                    >
                      <TelegramIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleToggleDiscordIntegration}
                      className={cn(
                        "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                        integrationBadgeClass(discordConnected),
                      )}
                      aria-label={discordConnected ? "Disable Discord integration" : "Enable Discord integration"}
                      title={discordConnected ? "Discord connected (click to disable)" : "Discord disconnected (click to enable)"}
                    >
                      <DiscordIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleToggleOpenAIIntegration}
                      className={cn(
                        "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                        integrationBadgeClass(openaiConnected),
                      )}
                      aria-label={openaiConnected ? "Disable OpenAI integration" : "Enable OpenAI integration"}
                      title={openaiConnected ? "OpenAI connected (click to disable)" : "OpenAI disconnected (click to enable)"}
                    >
                      <OpenAIIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleToggleClaudeIntegration}
                      className={cn(
                        "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                        integrationBadgeClass(claudeConnected),
                      )}
                      aria-label={claudeConnected ? "Disable Claude integration" : "Enable Claude integration"}
                      title={claudeConnected ? "Claude connected (click to disable)" : "Claude disconnected (click to enable)"}
                    >
                      <ClaudeIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleToggleGrokIntegration}
                      className={cn(
                        "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                        integrationBadgeClass(grokConnected),
                      )}
                      aria-label={grokConnected ? "Disable Grok integration" : "Enable Grok integration"}
                      title={grokConnected ? "Grok connected (click to disable)" : "Grok disconnected (click to enable)"}
                    >
                      <XAIIcon size={16} />
                    </button>
                    <button
                      onClick={handleToggleGeminiIntegration}
                      className={cn(
                        "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                        integrationBadgeClass(geminiConnected),
                      )}
                      aria-label={geminiConnected ? "Disable Gemini integration" : "Enable Gemini integration"}
                      title={geminiConnected ? "Gemini connected (click to disable)" : "Gemini disconnected (click to enable)"}
                    >
                      <GeminiIcon size={16} />
                    </button>
                    <button
                      onClick={handleToggleGmailIntegration}
                      className={cn(
                        "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                        integrationBadgeClass(gmailConnected),
                      )}
                      aria-label={gmailConnected ? "Disable Gmail integration" : "Enable Gmail integration"}
                      title={gmailConnected ? "Gmail connected (click to disable)" : "Gmail disconnected (click to enable)"}
                    >
                      <GmailIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleToggleBraveIntegration}
                      className={cn(
                        "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                        integrationBadgeClass(braveConnected),
                      )}
                      aria-label={braveConnected ? "Disable Brave integration" : "Enable Brave integration"}
                      title={braveConnected ? "Brave connected (click to disable)" : "Brave disconnected (click to enable)"}
                    >
                      <BraveIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleToggleCoinbaseIntegration}
                      className={cn(
                        "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                        integrationBadgeClass(coinbaseConnected),
                      )}
                      aria-label={coinbaseConnected ? "Disable Coinbase integration" : "Enable Coinbase integration"}
                      title={coinbaseConnected ? "Coinbase connected (click to disable)" : "Coinbase disconnected (click to enable)"}
                    >
                      <CoinbaseIcon className="w-4 h-4" />
                    </button>
                    {Array.from({ length: 15 }).map((_, index) => (
                      <div
                        key={index}
                        className={cn(
                          "h-9 rounded-sm border home-spotlight-card home-border-glow home-spotlight-card--hover",
                          isLight ? "border-[#d5dce8] bg-[#eef3fb]" : "border-white/10 bg-black/20",
                        )}
                      />
                    ))}
                  </div>
                </div>

                <div className="mt-2" />
              </section>
            </aside>
          </div>
        </div>
      </div>
    </div>
  )
}

