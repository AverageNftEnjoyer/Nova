"use client"

import Image from "next/image"
import { PanelLeftOpen, PanelLeftClose, Blocks, Pin, Settings, BarChart3 } from "lucide-react"
import { AnimatedOrb } from "@/components/animated-orb"
import TextType from "@/components/TextType"
import { ChatSidebar } from "@/components/chat-sidebar"
import { Button } from "@/components/ui/button"
import FloatingLines from "@/components/FloatingLines"
import { TelegramIcon } from "@/components/telegram-icon"
import { DiscordIcon } from "@/components/discord-icon"
import { BraveIcon } from "@/components/brave-icon"
import { OpenAIIcon } from "@/components/openai-icon"
import { ClaudeIcon } from "@/components/claude-icon"
import { XAIIcon } from "@/components/xai-icon"
import { GeminiIcon } from "@/components/gemini-icon"
import { GmailIcon } from "@/components/gmail-icon"
import { Composer } from "@/components/composer"
import { cn } from "@/lib/utils"
import {
  FLOATING_LINES_ENABLED_WAVES,
  FLOATING_LINES_LINE_COUNT,
  FLOATING_LINES_LINE_DISTANCE,
  FLOATING_LINES_TOP_WAVE_POSITION,
  FLOATING_LINES_MIDDLE_WAVE_POSITION,
  FLOATING_LINES_BOTTOM_WAVE_POSITION,
} from "../constants"
import { formatDailyTime, hexToRgba } from "../helpers"
import { useHomeMainScreenState } from "../hooks/use-home-main-screen-state"
import "@/components/FloatingLines.css"

export function HomeMainScreen() {
  const {
    isLight,
    background,
    backgroundVideoUrl,
    backgroundMediaIsImage,
    conversations,
    sidebarOpen,
    toggleSidebar,
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
    handleToggleTelegramIntegration,
    handleToggleDiscordIntegration,
    handleToggleBraveIntegration,
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
    openaiConnected,
    claudeConnected,
    grokConnected,
    geminiConnected,
    gmailConnected,
    floatingLinesGradient,
  } = useHomeMainScreenState()

  return (
    <div className={cn("relative flex h-dvh overflow-hidden", isLight ? "bg-[#f6f8fc] text-s-90" : "bg-[#05070a] text-slate-100")}>
      {background === "floatingLines" && !isLight && (
        <div className="absolute inset-0 z-0 pointer-events-none">
          <div className="absolute inset-0 opacity-30">
            <FloatingLines
              linesGradient={floatingLinesGradient}
              enabledWaves={FLOATING_LINES_ENABLED_WAVES}
              lineCount={FLOATING_LINES_LINE_COUNT}
              lineDistance={FLOATING_LINES_LINE_DISTANCE}
              topWavePosition={FLOATING_LINES_TOP_WAVE_POSITION}
              middleWavePosition={FLOATING_LINES_MIDDLE_WAVE_POSITION}
              bottomWavePosition={FLOATING_LINES_BOTTOM_WAVE_POSITION}
              bendRadius={5}
              bendStrength={-0.5}
              interactive={true}
              parallax={true}
            />
          </div>
          <div
            className="absolute inset-0"
            style={{
              background:
                `radial-gradient(circle at 48% 46%, ${hexToRgba(orbPalette.circle1, 0.22)} 0%, ${hexToRgba(orbPalette.circle2, 0.18)} 28%, transparent 58%), linear-gradient(180deg, rgba(255,255,255,0.025), transparent 35%)`,
            }}
          />
          <div className="absolute inset-0">
            <div
              className="absolute top-[12%] left-[16%] h-72 w-72 rounded-full blur-[110px]"
              style={{ backgroundColor: hexToRgba(orbPalette.circle1, 0.24) }}
            />
            <div
              className="absolute bottom-[8%] right-[18%] h-80 w-80 rounded-full blur-[130px]"
              style={{ backgroundColor: hexToRgba(orbPalette.circle2, 0.22) }}
            />
          </div>
        </div>
      )}
      {background === "customVideo" && !isLight && !!backgroundVideoUrl && (
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
          {backgroundMediaIsImage ? (
            <Image
              fill
              unoptimized
              sizes="100vw"
              className="object-cover"
              src={backgroundVideoUrl}
              alt=""
              aria-hidden="true"
            />
          ) : (
            <video
              className="absolute inset-0 h-full w-full object-cover"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              src={backgroundVideoUrl}
            />
          )}
          <div className="absolute inset-0 bg-black/45" />
        </div>
      )}

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
        <div className="pointer-events-none absolute top-0 left-0 right-0 z-20 flex items-center px-4 py-3">
          <div className="pointer-events-auto flex items-center gap-2">
            <div className="group relative">
              <Button
                onClick={toggleSidebar}
                variant="ghost"
                size="icon"
                className={cn(
                  "chat-sidebar-card home-spotlight-card home-border-glow home-spotlight-card--hover h-9 w-9 rounded-full transition-all duration-150 hover:[--glow-intensity:1]",
                  isLight
                    ? "border border-[#d9e0ea] bg-[#f4f7fd] text-s-70"
                    : "border border-white/10 bg-white/4 text-slate-300 hover:bg-[#141923] hover:border-[#2b3240]",
                )}
                aria-label={sidebarOpen ? "Collapse Sidebar" : "Expand Sidebar"}
              >
                {sidebarOpen ? (
                  <PanelLeftClose className="w-4 h-4 transition-transform duration-200 ease-out group-hover:rotate-12" />
                ) : (
                  <PanelLeftOpen className="w-4 h-4 transition-transform duration-200 ease-out group-hover:rotate-12" />
                )}
              </Button>
            </div>
          </div>
          <div className="flex-1" />
        </div>

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
                    {Array.from({ length: 16 }).map((_, index) => (
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
