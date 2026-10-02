"use client"

import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Image from "next/image"
import { Blocks, Settings, User } from "lucide-react"

import {
  buildIntegrationsHref,
  readIntegrationSetupParam,
  type IntegrationSetupKey,
} from "@/lib/integrations/navigation"
import { cn } from "@/lib/shared/utils"
import { USER_SETTINGS_UPDATED_EVENT, loadUserSettings, type OrbColor, type UserProfile } from "@/lib/settings/userSettings"
import type { LlmProvider } from "@/lib/integrations/store/client-store"
import { FluidSelect } from "@/components/ui/fluid-select"
import { SettingsModal } from "@/components/settings/settings-modal"
import { useNovaState } from "@/lib/chat/hooks/useNovaState"
import { getNovaPresence } from "@/lib/chat/nova-presence"
import { useTownProgress } from "@/app/home/hooks/use-town-progress"
import { BraveIcon, ClaudeIcon, CoinbaseIcon, DiscordIcon, GeminiIcon, GmailCalendarIcon, GmailIcon, NewsIcon, OpenAIIcon, PhantomIcon, PolymarketIcon, SlackIcon, SpotifyIcon, TelegramIcon, XAIIcon, YouTubeIcon } from "@/components/icons"
import { NOVA_VERSION } from "@/lib/meta/version"
import { writeShellUiCache } from "@/lib/settings/shell-ui-cache"
import { formatCompactModelLabelFromIntegrations } from "@/lib/integrations/llm/model-label"

import { useSpotlightEffect } from "./hooks"
import { SaveStatusToast, ConnectivityGrid } from "./components"
import { useIntegrationsController } from "./modules/hooks/use-integrations-controller"
import { IntegrationsMainPanel } from "./modules/components/integrations-main-panel"

function IntegrationsPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedSetup = readIntegrationSetupParam(searchParams.get("setup"))
  // The setup modules are dark-surface components: they sit on the Day theme's indigo inset (--px-bg), so they always
  // get their on-dark classes. (Day tokens do the colouring; this is not a light/dark page switch.)
  const onDarkSurface = false
  const { progress: townProgress } = useTownProgress()
  const { state: novaState, connected: agentConnected } = useNovaState()

  const [, setOrbColor] = useState<OrbColor>("white")
  const [profile, setProfile] = useState<UserProfile>({
    name: "User",
    avatar: null,
    accessTier: "Model Unset",
  })
  const [spotlightEnabled, setSpotlightEnabled] = useState(true)
  const [selectedSetup, setSelectedSetup] = useState<IntegrationSetupKey>(requestedSetup ?? "telegram")
  const activeSetup = requestedSetup ?? selectedSetup
  const [settingsOpen, setSettingsOpen] = useState(false)
  const topHeaderRef = useRef<HTMLDivElement | null>(null)
  const connectivitySectionRef = useRef<HTMLElement | null>(null)
  const activeStatusSectionRef = useRef<HTMLElement | null>(null)

  const handleSelectSetup = (setup: IntegrationSetupKey) => {
    setSelectedSetup(setup)
    if (requestedSetup === setup) return
    router.replace(buildIntegrationsHref(setup), { scroll: false })
  }

  // Connect / settings state for every integration, shared with the Home building rooms.
  const {
    settings,
    integrationsHydrated,
    saveStatus,
    isSavingTarget,
    activeLlmProvider,
    saveActiveProvider,
    setupSectionRefs,
    panelProps,
  } = useIntegrationsController(activeSetup)

  useEffect(() => {
    const refresh = () => {
      const userSettings = loadUserSettings()
      setProfile(userSettings.profile)
      setOrbColor(userSettings.app.orbColor)
      setSpotlightEnabled(userSettings.app.spotlightEnabled ?? true)
      writeShellUiCache({
        orbColor: userSettings.app.orbColor,
        spotlightEnabled: userSettings.app.spotlightEnabled ?? true,
      })
    }
    refresh()
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
  }, [])

  // Spotlight effect for all sections
  useSpotlightEffect(
    spotlightEnabled,
    [
      { ref: connectivitySectionRef, showSpotlightCore: false, enableParticles: false, directHoverOnly: true },
      ...setupSectionRefs.map((ref) => ({ ref, showSpotlightCore: false, enableParticles: false, directHoverOnly: true })),
      { ref: activeStatusSectionRef, showSpotlightCore: false, enableParticles: false, directHoverOnly: true },
    ],
    [activeSetup]
  )

  const panelClass = "ig-panel"
  const subPanelClass = "ig-sub"
  const panelStyle: CSSProperties | undefined = undefined
  const moduleHeightClass = "ig-module"
  const presence = getNovaPresence({ agentConnected, novaState })
  const integrationDotClass = (connected: boolean) =>
    !integrationsHydrated ? "bg-slate-400" : connected ? "bg-emerald-400" : "bg-rose-400"
  const compactModelLabel = useMemo(() => formatCompactModelLabelFromIntegrations(settings), [settings])
  const integrationTextClass = (connected: boolean) =>
    !integrationsHydrated ? "text-slate-400" : connected ? "text-emerald-400" : "text-rose-400"
  const connectivityItems = [
    { key: "telegram" as const, connected: settings.telegram.connected, icon: <TelegramIcon className="w-3.5 h-3.5" />, ariaLabel: "Open Telegram setup" },
    { key: "discord" as const, connected: settings.discord.connected, icon: <DiscordIcon className="w-3.5 h-3.5" />, ariaLabel: "Open Discord setup" },
    { key: "slack" as const, connected: settings.slack.connected, icon: <SlackIcon className="w-3.5 h-3.5" />, ariaLabel: "Open Slack setup" },
    { key: "openai" as const, connected: settings.openai.connected, icon: <OpenAIIcon className="w-4.5[18px]" />, ariaLabel: "Open OpenAI setup" },
    { key: "claude" as const, connected: settings.claude.connected, icon: <ClaudeIcon className="w-4 h-4" />, ariaLabel: "Open Claude setup" },
    { key: "grok" as const, connected: settings.grok.connected, icon: <XAIIcon size={16} />, ariaLabel: "Open Grok setup" },
    { key: "gemini" as const, connected: settings.gemini.connected, icon: <GeminiIcon size={16} />, ariaLabel: "Open Gemini setup" },
    { key: "spotify" as const, connected: settings.spotify.connected, icon: <SpotifyIcon className="w-4 h-4" />, ariaLabel: "Open Spotify setup" },
    { key: "youtube" as const, connected: settings.youtube.connected, icon: <YouTubeIcon className="w-4 h-4" />, ariaLabel: "Open YouTube setup" },
    { key: "gmail" as const, connected: settings.gmail.connected, icon: <GmailIcon className="w-3.5 h-3.5" />, ariaLabel: "Open Gmail setup" },
    { key: "gmail-calendar" as const, connected: settings.gcalendar.connected, icon: <GmailCalendarIcon className="w-3.5 h-3.5" />, ariaLabel: "Open Google Calendar setup" },
    { key: "brave" as const, connected: settings.brave.connected, icon: <BraveIcon className="w-4 h-4" />, ariaLabel: "Open Brave setup" },
    { key: "news" as const, connected: settings.news.connected, icon: <NewsIcon className="w-3.5 h-3.5" />, ariaLabel: "Open News setup" },
    { key: "coinbase" as const, connected: settings.coinbase.connected, icon: <CoinbaseIcon className="w-4 h-4" />, ariaLabel: "Open Coinbase setup" },
    { key: "phantom" as const, connected: settings.phantom.connected, icon: <PhantomIcon className="w-4 h-4" />, ariaLabel: "Open Phantom setup" },
    { key: "polymarket" as const, connected: settings.polymarket.connected, icon: <PolymarketIcon className="w-6 h-6" />, ariaLabel: "Open Polymarket setup" },
  ]
  return (
    <div className="ig-root">
      <div className="ig-scroll">
        <div className="ig-page">
          <SaveStatusToast status={saveStatus} isLight={onDarkSurface} />

          <section className="ig-frame pixel-frame" aria-labelledby="ig-title">
            <header ref={topHeaderRef} className="ig-head">
              <div className="ig-head-side">
                <span className="pixel-plaque pixel-plaque--frame" title={presence.label}>
                  <span className={cn("h-2.5 w-2.5 shrink-0", presence.dotClassName)} aria-hidden="true" />
                  {presence.label}
                </span>
                <span className="pixel-plaque pixel-plaque--frame ig-version">NovaAIO {NOVA_VERSION}</span>
              </div>
              <div className="ig-head-title">
                <h1 id="ig-title" className="pixel-title ig-title">Integrations</h1>
                <p className="pixel-label pixel-label--off ig-title-sub">Town Hall</p>
              </div>
              <div className="ig-head-end">
                <button
                  type="button"
                  onClick={() => router.push("/home")}
                  className="pixel-close"
                  aria-label="Go to home"
                  title="Back to the city"
                />
              </div>
            </header>

            <p className="ig-caption">
              <span className="pixel-plaque">{connectivityItems.length} buildings</span>
              <span className="pixel-plaque">{connectivityItems.filter((item) => item.connected).length} connected</span>
              <span className="ig-caption-hint">One building per integration. Pick one to set it up.</span>
            </p>

          <div className="ig-grid">
          <div className="space-y-4">
          <section ref={connectivitySectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}>
            <div className="flex items-center gap-2 text-s-80">
              <Blocks className="w-4 h-4 text-accent" />
              <h2 className="text-sm uppercase tracking-[0.22em] font-semibold">Nova City Buildings</h2>
            </div>

            <div className="ig-buildings-scroll mt-3 min-h-0 flex-1 overflow-y-auto no-scrollbar">
              <ConnectivityGrid
                activeSetup={activeSetup}
                onSelect={handleSelectSetup}
                townBuildings={townProgress ? townProgress.buildings : null}
                items={connectivityItems}
              />
            </div>
            <div className="mt-3 ig-sub p-3 home-spotlight-card home-border-glow">
              <p className="text-xs mb-2 uppercase tracking-[0.14em] text-slate-400">Profile & Settings</p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 flex items-center justify-center shrink-0 overflow-hidden border border-white/15 bg-white/5">
                  {profile.avatar ? (
                    <Image src={profile.avatar} alt="Profile" width={40} height={40} className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-4 h-4 text-s-80" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate text-slate-100">{profile.name || "User"}</p>
                  <p className="text-[11px] text-accent font-mono truncate">{compactModelLabel}</p>
                </div>
                <button
                  onClick={() => setSettingsOpen(true)}
                  className="h-8 w-8 border inline-flex items-center justify-center transition-colors group/gear ig-sub text-slate-300"
                  aria-label="Open settings"
                  title="Settings"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>
            </div>
          </section>
          </div>

          <IntegrationsMainPanel
            {...panelProps}
            activeSetup={activeSetup}
            panelStyle={panelStyle}
            panelClass={panelClass}
            moduleHeightClass={moduleHeightClass}
            isLight={onDarkSurface}
            subPanelClass={subPanelClass}
          />

          <section ref={activeStatusSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}>
            <div>
              <h2 className="text-sm uppercase tracking-[0.22em] font-semibold text-slate-200">
                Active
              </h2>
              <p className="text-xs mt-1 text-slate-400">
                Live provider and building status.
              </p>
            </div>

            <div className="mt-4 ig-sub p-3 home-spotlight-card home-border-glow">
              <p className="text-xs mb-2 uppercase tracking-[0.14em] text-slate-400">Active LLM Provider</p>
              <div className="grid grid-cols-1 gap-2">
                <FluidSelect
                  value={activeLlmProvider}
                  onChange={(v) => saveActiveProvider(v as LlmProvider)}
                  options={[
                    { value: "openai", label: "OpenAI" },
                    { value: "claude", label: "Claude" },
                    { value: "grok", label: "Grok" },
                    { value: "gemini", label: "Gemini" },
                  ]}
                  isLight={onDarkSurface}
                />
                <span className="text-[11px] text-slate-400">
                  {isSavingTarget === "provider" ? "Switching..." : "One provider live at a time"}
                </span>
              </div>
            </div>

            <ul className="ig-active-list mt-3 min-h-0 flex-1 overflow-y-auto no-scrollbar">
              {[
                { name: "Telegram", active: settings.telegram.connected },
                { name: "Discord", active: settings.discord.connected },
                { name: "Slack", active: settings.slack.connected },
                { name: "OpenAI", active: settings.openai.connected },
                { name: "Claude", active: settings.claude.connected },
                { name: "Grok", active: settings.grok.connected },
                { name: "Gemini", active: settings.gemini.connected },
                { name: "Spotify", active: settings.spotify.connected },
                { name: "YouTube", active: settings.youtube.connected },
                { name: "Gmail", active: settings.gmail.connected },
                { name: "Google Calendar", active: settings.gcalendar.connected },
                { name: "Brave", active: settings.brave.connected },
                { name: "News", active: settings.news.connected },
                { name: "Coinbase", active: settings.coinbase.connected },
                { name: "Phantom", active: settings.phantom.connected },
                { name: "Polymarket", active: settings.polymarket.connected },
              ].map((item) => (
                <li
                  key={item.name}
                  className="ig-active-row home-spotlight-card home-border-glow grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2 text-xs"
                >
                  <span className="font-medium text-slate-100">{item.name}</span>
                  <span
                    className={cn("h-2 w-2", integrationDotClass(item.active))}
                    aria-hidden="true"
                  />
                  <span className={cn(integrationTextClass(item.active))}>
                    {item.active ? "Active" : "Inactive"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
          </section>
        </div>
      </div>
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}


export default function IntegrationsPage() {
  return (
    <Suspense fallback={<div />}>
      <IntegrationsPageContent />
    </Suspense>
  )
}
