import { Eye, EyeOff, Save } from "lucide-react"

import { cn } from "@/lib/shared/utils"
import { FluidSelect } from "@/components/ui/fluid-select"
import { NovaSwitch } from "@/components/ui/nova-switch"

import { LlmSetupPanel, GmailSetupPanel, GmailCalendarSetupPanel, SecretInput } from "../../components"
import { COINBASE_TIMEZONE_OPTIONS, COINBASE_CURRENCY_OPTIONS, COINBASE_CADENCE_OPTIONS } from "../coinbase/meta"
import type { IntegrationsMainPanelProps } from "../types"

export function IntegrationsMainPanel(props: IntegrationsMainPanelProps) {
  const {
    activeSetup, panelStyle, panelClass, moduleHeightClass, isLight, subPanelClass, settings, isSavingTarget,
    telegramNeedsKeyWarning, braveApiKeyConfigured, braveApiKeyMasked, newsNeedsKeyWarning, newsApiKey, setNewsApiKey, newsApiKeyConfigured, newsApiKeyMasked,
    newsDefaultTopics, setNewsDefaultTopics, newsPreferredSources, setNewsPreferredSources,
    coinbaseNeedsKeyWarning, coinbasePendingAction, coinbaseSyncBadgeClass, coinbaseSyncLabel,
    coinbaseLastSyncText, coinbaseFreshnessText, coinbaseErrorText, coinbaseHasKeys, coinbaseScopeSummary, coinbasePrivacy, coinbasePrivacyHydrated, coinbasePrivacySaving, coinbasePrivacyError,
	    coinbaseApiKey, setCoinbaseApiKey, coinbaseApiKeyConfigured,
	    coinbaseApiKeyMasked, coinbaseApiSecret, setCoinbaseApiSecret, showCoinbaseApiSecret, setShowCoinbaseApiSecret,
	    coinbaseApiSecretConfigured, coinbaseApiSecretMasked, providerDefinition, gmailSetup, gmailCalendarSetup,
	    phantomSetup, phantomSetupSectionRef,
	    spotifySetup, youtubeSetup,
	    telegramSetupSectionRef,
    discordSetupSectionRef, slackSetupSectionRef, braveSetupSectionRef, newsSetupSectionRef, coinbaseSetupSectionRef, gmailSetupSectionRef,
    spotifySetupSectionRef, youtubeSetupSectionRef, gmailCalendarSetupSectionRef, setBotToken,
    botToken, botTokenConfigured, botTokenMasked, setChatIds, chatIds, setDiscordWebhookUrls, discordWebhookUrls,
    setSlackWebhookUrl, slackWebhookUrl, slackWebhookUrlConfigured, slackWebhookUrlMasked,
    setBraveApiKey, braveApiKey, toggleTelegram, saveTelegramConfig, toggleDiscord, saveDiscordConfig, toggleSlack, saveSlackConfig, toggleBrave,
    saveBraveConfig, toggleNews, saveNewsConfig, probeCoinbaseConnection, toggleCoinbase, saveCoinbaseConfig, updateCoinbasePrivacy,
    updateCoinbaseDefaults,
  } = props
  const youtubeMergedScopes = new Set(
    [
      ...(typeof settings.youtube.scopes === "string" ? settings.youtube.scopes.split(/\s+/).map((scope) => scope.trim()).filter(Boolean) : []),
      ...(typeof youtubeSetup.youtubeScopes === "string" ? youtubeSetup.youtubeScopes.split(/\s+/).map((scope) => scope.trim()).filter(Boolean) : []),
    ].map((scope) => scope.toLowerCase()),
  )
  const youtubeHasReadonlyScope =
    youtubeMergedScopes.has("https://www.googleapis.com/auth/youtube.readonly") ||
    youtubeMergedScopes.has("https://www.googleapis.com/auth/youtube")
  const gmailHasCredentials =
    Boolean(settings.gmail.oauthClientId?.trim()) &&
    (Boolean(settings.gmail.oauthClientSecretConfigured) || Boolean(settings.gmail.oauthClientSecret?.trim()))
  const phantomCanConnectHere = phantomSetup.providerSupportedContext && phantomSetup.providerInstalled
  const phantomRuntimeStatus = [
    settings.phantom.preferences.allowAgentWalletContext
      ? `Runtime wallet context is enabled${phantomSetup.walletLabel ? ` for ${phantomSetup.walletLabel}` : ""}.`
      : "Runtime wallet address exposure is disabled.",
    settings.phantom.preferences.allowAgentEvmContext
      ? (phantomSetup.evmAddress
          ? `EVM readiness context is enabled for ${phantomSetup.evmLabel || phantomSetup.evmAddress}.`
          : "EVM readiness context is enabled, but no Phantom EVM address is detected yet.")
      : "EVM readiness context is disabled.",
    settings.phantom.preferences.allowApprovalGatedPolymarket
      ? (settings.phantom.capabilities.approvalGatedPolymarketReady
          ? "Approval-gated Polymarket preparation is enabled and ready."
          : "Approval-gated Polymarket preparation is enabled but waiting on Phantom EVM readiness.")
      : "Approval-gated Polymarket preparation is disabled.",
  ]
  const phantomHardLimits = [
    !phantomSetup.providerSupportedContext ? "Phantom cannot connect inside this embedded Nova desktop/webview context. Open Nova in a real browser first." : "",
    phantomSetup.providerSupportedContext && !phantomSetup.providerInstalled ? "Phantom cannot connect until the extension is installed in that browser profile." : "",
    phantomCanConnectHere && !phantomSetup.providerReady && !settings.phantom.connected ? "Phantom cannot sign until the wallet is unlocked and a Solana account is selected." : "",
    "Phantom cannot trade autonomously, export private keys, or bypass your explicit approval.",
  ].filter(Boolean)

  return (
    <div className="space-y-4">
            {activeSetup === "telegram" && (
            <section ref={telegramSetupSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
                    Telegram Setup
                  </h2>
                  <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
                    Save Telegram credentials and destination IDs for workflows.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleTelegram}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                      settings.telegram.connected
                        ? "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20"
                        : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20",
                    )}
                  >
                    {settings.telegram.connected ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={saveTelegramConfig}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border border-accent-30 bg-accent-10 text-accent transition-colors hover:bg-accent-20 home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                    )}
                  >
                    <Save className="w-3.5 h-3.5" />
                    {isSavingTarget === "telegram" ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>

              <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto no-scrollbar pr-1">
                <SecretInput
                  value={botToken}
                  onChange={setBotToken}
                  label="Bot Token"
                  placeholder="1234567890:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  placeholderWhenConfigured="Enter new bot token to replace current token"
                  maskedValue={botTokenMasked}
                  isConfigured={botTokenConfigured}
                  serverLabel="Token on server"
                  name="telegram_token_input"
                  isLight={isLight}
                  subPanelClass={subPanelClass}
                />

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Chat IDs</p>
                  <input
                    value={chatIds}
                    onChange={(e) => setChatIds(e.target.value)}
                    placeholder="123456789,-100987654321"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="none"
                    data-gramm="false"
                    data-gramm_editor="false"
                    data-enable-grammarly="false"
                    className={cn(
                      "w-full h-9 px-3 rounded-md border bg-transparent text-sm outline-none",
                      isLight
                        ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
                        : "border-white/10 text-slate-100 placeholder:text-slate-500",
                    )}
                  />
                  <p className={cn("mt-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                    Use comma-separated IDs for multi-device delivery targets.
                  </p>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className={cn("text-xs uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Setup Instructions</p>
                    {telegramNeedsKeyWarning && (
                      <p className={cn("text-[11px]", isLight ? "text-amber-700" : "text-amber-300")}>
                        Key missing
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div
                      className={cn(
                        "rounded-md border p-2.5 home-spotlight-card home-border-glow",
                        isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20",
                      )}
                    >
                      <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Telegram Bot Token</p>
                      <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                        <li>1. Open Telegram and message <span className="font-mono">@BotFather</span>.</li>
                        <li>2. Run <span className="font-mono">/newbot</span> (or <span className="font-mono">/token</span> for existing bot).</li>
                        <li>3. Copy the token and paste it into <span className="font-mono">Bot Token</span> above.</li>
                      </ol>
                    </div>

                    <div
                      className={cn(
                        "rounded-md border p-2.5 home-spotlight-card home-border-glow",
                        isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20",
                      )}
                    >
                      <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Telegram Chat ID</p>
                      <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                        <li>1. Open your bot chat, press <span className="font-mono">Start</span>, send <span className="font-mono">hello</span>.</li>
                        <li>2. Open <span className="font-mono">/getUpdates</span> with your bot token.</li>
                        <li>3. Copy <span className="font-mono">message.chat.id</span> into <span className="font-mono">Chat IDs</span>.</li>
                      </ol>
                    </div>
                  </div>
                </div>
              </div>
            </section>
            )}

            {activeSetup === "discord" && (
            <section ref={discordSetupSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
                    Discord Setup
                  </h2>
                  <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
                    Save Discord webhooks for mission and notification delivery.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleDiscord}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                      settings.discord.connected
                        ? "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20"
                        : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20",
                    )}
                  >
                    {settings.discord.connected ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={saveDiscordConfig}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border border-accent-30 bg-accent-10 text-accent transition-colors hover:bg-accent-20 home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                    )}
                  >
                    <Save className="w-3.5 h-3.5" />
                    {isSavingTarget === "discord" ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>

              <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto no-scrollbar pr-1">
                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Webhook URLs</p>
                  <input
                    value={discordWebhookUrls}
                    onChange={(e) => setDiscordWebhookUrls(e.target.value)}
                    placeholder="https://discord.com/api/webhooks/... , https://discord.com/api/webhooks/..."
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="none"
                    data-gramm="false"
                    data-gramm_editor="false"
                    data-enable-grammarly="false"
                    className={cn(
                      "w-full h-9 px-3 rounded-md border bg-transparent text-sm outline-none",
                      isLight
                        ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
                        : "border-white/10 text-slate-100 placeholder:text-slate-500",
                    )}
                  />
                  <p className={cn("mt-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                    Use comma-separated webhook URLs for multi-channel delivery.
                  </p>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Setup Instructions</p>
                  <div
                    className={cn(
                      "rounded-md border p-2.5 home-spotlight-card home-border-glow",
                      isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20",
                    )}
                  >
                    <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Discord Webhook URL</p>
                    <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                      <li>1. Open Discord server settings and go to <span className="font-mono">Integrations</span> then <span className="font-mono">Webhooks</span>.</li>
                      <li>2. Create or select a webhook and copy its webhook URL.</li>
                      <li>3. Paste one or more URLs into <span className="font-mono">Webhook URLs</span>, then Save.</li>
                    </ol>
                  </div>
                </div>
              </div>
            </section>
            )}

            {activeSetup === "slack" && (
            <section ref={slackSetupSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
                    Slack Setup
                  </h2>
                  <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
                    Save a Slack webhook for mission and notification delivery.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleSlack}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                      settings.slack.connected
                        ? "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20"
                        : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20",
                    )}
                  >
                    {settings.slack.connected ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={saveSlackConfig}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border border-accent-30 bg-accent-10 text-accent transition-colors hover:bg-accent-20 home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                    )}
                  >
                    <Save className="w-3.5 h-3.5" />
                    {isSavingTarget === "slack" ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>

              <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto no-scrollbar pr-1">
                <SecretInput
                  value={slackWebhookUrl}
                  onChange={setSlackWebhookUrl}
                  label="Webhook URL"
                  placeholder="https://hooks.slack.com/services/T.../B.../xxxx"
                  placeholderWhenConfigured="Enter new webhook URL to replace current"
                  maskedValue={slackWebhookUrlMasked}
                  isConfigured={slackWebhookUrlConfigured}
                  serverLabel="Webhook on server"
                  name="slack_webhook_input"
                  isLight={isLight}
                  subPanelClass={subPanelClass}
                />

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Setup Instructions</p>
                  <div className="space-y-2">
                    <div
                      className={cn(
                        "rounded-md border p-2.5 home-spotlight-card home-border-glow",
                        isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20",
                      )}
                    >
                      <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Slack Incoming Webhook</p>
                      <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                        <li>1. Go to <span className="font-mono">api.slack.com/apps</span> and create or select an app.</li>
                        <li>2. Under <span className="font-mono">Incoming Webhooks</span>, activate and add a new webhook to a channel.</li>
                        <li>3. Copy the webhook URL and paste it into <span className="font-mono">Webhook URL</span> above.</li>
                        <li>4. Click <span className="font-mono">Save</span> — Nova will send a test message to verify the connection.</li>
                      </ol>
                    </div>
                  </div>
                </div>
              </div>
            </section>
            )}

            {activeSetup === "brave" && (
            <section ref={braveSetupSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
                    Brave Search API
                  </h2>
                  <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
                    Save a per-user Brave API key for secure web search access.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleBrave}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                      settings.brave.connected
                        ? "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20"
                        : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20",
                    )}
                  >
                    {settings.brave.connected ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={saveBraveConfig}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border border-accent-30 bg-accent-10 text-accent transition-colors hover:bg-accent-20 home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                    )}
                  >
                    <Save className="w-3.5 h-3.5" />
                    {isSavingTarget === "brave" ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>

              <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto no-scrollbar pr-1">
                <SecretInput
                  value={braveApiKey}
                  onChange={setBraveApiKey}
                  label="API Key"
                  placeholder="BSAI-xxxxxxxxxxxxxxxx"
                  placeholderWhenConfigured="Enter new key to replace current key"
                  maskedValue={braveApiKeyMasked}
                  isConfigured={braveApiKeyConfigured}
                  name="brave_api_key_input"
                  isLight={isLight}
                  subPanelClass={subPanelClass}
                />

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Setup Instructions</p>
                  <div className="space-y-2">
                    <div
                      className={cn(
                        "rounded-md border p-2.5 home-spotlight-card home-border-glow",
                        isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20",
                      )}
                    >
                      <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Create Brave API Key</p>
                      <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                        <li>1. Open <span className="font-mono">api.search.brave.com</span> and sign in to your Brave Search API account.</li>
                        <li>2. Create a new key for this Nova workspace and give it a clear label (for example: <span className="font-mono">Nova Desktop - Personal</span>).</li>
                        <li>3. Copy the key immediately and keep it private. Treat it like a password.</li>
                      </ol>
                    </div>

                    <div
                      className={cn(
                        "rounded-md border p-2.5 home-spotlight-card home-border-glow",
                        isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20",
                      )}
                    >
                      <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Save and Enable in Nova</p>
                      <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                        <li>1. Paste the key into <span className="font-mono">API Key</span> and click <span className="font-mono">Save</span>.</li>
                        <li>2. Confirm you see a masked server value (for example: <span className="font-mono">BSAI****ABCD</span>).</li>
                        <li>3. Click <span className="font-mono">Enable</span> so mission web-search and scraping can use Brave.</li>
                      </ol>
                    </div>

                    <div
                      className={cn(
                        "rounded-md border p-2.5 home-spotlight-card home-border-glow",
                        isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20",
                      )}
                    >
                      <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Verification and Security</p>
                      <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                        <li>1. Run a mission that includes web fetch/search and check run trace for successful web sources.</li>
                        <li>2. If you still see low-source or key-missing warnings, disable then re-enable Brave after saving a fresh key.</li>
                        <li>3. Rotate the key in Brave dashboard immediately if it is ever exposed in logs, screenshots, or shared text.</li>
                      </ol>
                    </div>
                  </div>
                </div>
              </div>
            </section>
            )}

            {activeSetup === "news" && (
            <section ref={newsSetupSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
                    News API
                  </h2>
                  <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
                    Configure live news for Home feed topic filtering.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleNews}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                      settings.news.connected
                        ? "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20"
                        : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20",
                    )}
                  >
                    {settings.news.connected ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={saveNewsConfig}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border border-accent-30 bg-accent-10 text-accent transition-colors hover:bg-accent-20 home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                    )}
                  >
                    <Save className="w-3.5 h-3.5" />
                    {isSavingTarget === "news" ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>

              <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto no-scrollbar pr-1">
                <SecretInput
                  value={newsApiKey}
                  onChange={setNewsApiKey}
                  label="API Key"
                  placeholder="news_live_xxxxxxxxx"
                  placeholderWhenConfigured="Enter new key to replace current key"
                  maskedValue={newsApiKeyMasked}
                  isConfigured={newsApiKeyConfigured}
                  name="news_api_key_input"
                  isLight={isLight}
                  subPanelClass={subPanelClass}
                />

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Feed Defaults</p>
                  <input
                    value={newsDefaultTopics}
                    onChange={(e) => setNewsDefaultTopics(e.target.value)}
                    placeholder="Default topics (comma separated)"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="none"
                    data-gramm="false"
                    data-gramm_editor="false"
                    data-enable-grammarly="false"
                    className={cn(
                      "w-full h-9 px-3 rounded-md border bg-transparent text-sm outline-none",
                      isLight
                        ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
                        : "border-white/10 text-slate-100 placeholder:text-slate-500",
                      )}
                  />
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Preferred Sources</p>
                  <input
                    value={newsPreferredSources}
                    onChange={(e) => setNewsPreferredSources(e.target.value)}
                    placeholder="Bloomberg, ABC News, Reuters"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="none"
                    data-gramm="false"
                    data-gramm_editor="false"
                    data-enable-grammarly="false"
                    className={cn(
                      "w-full h-9 px-3 rounded-md border bg-transparent text-sm outline-none",
                      isLight
                        ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
                        : "border-white/10 text-slate-100 placeholder:text-slate-500",
                    )}
                  />
                  <p className={cn("mt-2 text-[11px] leading-4", isLight ? "text-s-50" : "text-slate-400")}>
                    Used by the YouTube module for source-first news video ranking when `mode=sources`.
                  </p>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className={cn("text-xs uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Setup Instructions</p>
                    {newsNeedsKeyWarning && (
                      <p className={cn("text-[11px]", isLight ? "text-amber-700" : "text-amber-300")}>
                        Key missing
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div
                      className={cn(
                        "rounded-md border p-2.5 home-spotlight-card home-border-glow",
                        isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20",
                      )}
                    >
                      <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Create and Save Credentials</p>
                      <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                        <li>1. Create an API key in your news provider dashboard.</li>
                        <li>2. Paste the key above and set your default topics list.</li>
                        <li>3. Click <span className="font-mono">Save</span>, then <span className="font-mono">Enable</span>.</li>
                      </ol>
                    </div>

                    <div
                      className={cn(
                        "rounded-md border p-2.5 home-spotlight-card home-border-glow",
                        isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20",
                      )}
                    >
                      <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Home Feed Behavior</p>
                      <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                        <li>1. Home feed polls every <span className="font-mono">10 minutes</span> only while the page is visible.</li>
                        <li>2. Topic buttons switch between general, market, and crypto sources without spamming calls.</li>
                        <li>3. Use default topics to seed initial chips for your account.</li>
                        <li>4. Preferred Sources are shared with YouTube feed ranking for per-user source tuning.</li>
                      </ol>
                    </div>
                  </div>
                </div>
              </div>
            </section>
            )}

            {activeSetup === "coinbase" && (
            <section ref={coinbaseSetupSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
                    Coinbase API
                  </h2>
                  <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
                    Save per-user Coinbase credentials for crypto prices, portfolio reports, and automations.
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className={cn("rounded-full border px-2 py-0.5", settings.coinbase.connected ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-200" : "border-rose-300/40 bg-rose-500/15 text-rose-200")}>
                      {settings.coinbase.connected ? "Connected" : "Disconnected"}
                    </span>
                    <span className={cn("rounded-full border px-2 py-0.5", coinbaseSyncBadgeClass)}>
                      {coinbaseSyncLabel}
                    </span>
                    <span className={cn("rounded-full border px-2 py-0.5", isLight ? "border-[#d5dce8] text-s-60 bg-white" : "border-white/10 text-slate-300 bg-black/20")}>
                      Mode: {settings.coinbase.connectionMode === "oauth" ? "OAuth" : "API Key Pair"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void probeCoinbaseConnection("Coinbase sync probe passed.")}
                    disabled={isSavingTarget !== null || coinbasePendingAction !== null || !coinbaseHasKeys}
                    className={cn(
                      "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                      isLight
                        ? "border-[#d5dce8] bg-white text-s-80 hover:bg-[#f4f7fd]"
                        : "border-white/15 bg-white/5 text-slate-200 hover:bg-white/10",
                    )}
                  >
                    {coinbasePendingAction === "sync" ? "Syncing..." : "Sync"}
                  </button>
                  <button
                    onClick={toggleCoinbase}
                    disabled={isSavingTarget !== null || coinbasePendingAction !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                      settings.coinbase.connected
                        ? "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20"
                        : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20",
                    )}
                  >
                    {coinbasePendingAction === "toggle"
                      ? settings.coinbase.connected ? "Disconnecting..." : "Connecting..."
                      : settings.coinbase.connected ? "Disconnect" : "Connect"}
                  </button>
                  <button
                    onClick={saveCoinbaseConfig}
                    disabled={isSavingTarget !== null || coinbasePendingAction !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border border-accent-30 bg-accent-10 text-accent transition-colors hover:bg-accent-20 home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                    )}
                  >
                    <Save className="w-3.5 h-3.5" />
                    {coinbasePendingAction === "save" ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>

              <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto no-scrollbar pr-1">
                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className={cn("text-xs uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Sync Health</p>
                    <span className={cn("text-[11px] rounded-full border px-2 py-0.5", coinbaseSyncBadgeClass)}>
                      {coinbaseSyncLabel}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div className={cn("rounded-md border px-2 py-1.5", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}>
                      <p className={cn("text-[11px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}>Last Sync</p>
                      <p className={cn("mt-1 text-sm font-medium", isLight ? "text-s-80" : "text-slate-200")}>{coinbaseLastSyncText}</p>
                    </div>
                    <div className={cn("rounded-md border px-2 py-1.5", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}>
                      <p className={cn("text-[11px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}>Freshness</p>
                      <p className={cn("mt-1 text-sm font-medium", isLight ? "text-s-80" : "text-slate-200")}>{coinbaseFreshnessText}</p>
                    </div>
                    <div className={cn("rounded-md border px-2 py-1.5", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}>
                      <p className={cn("text-[11px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}>Scopes</p>
                      <p className={cn("mt-1 text-sm font-medium truncate", isLight ? "text-s-80" : "text-slate-200")} title={coinbaseScopeSummary}>
                        {settings.coinbase.requiredScopes.length || 0}
                      </p>
                    </div>
                  </div>
                  {settings.coinbase.lastSyncStatus === "error" && coinbaseErrorText && (
                    <p className={cn("mt-2 rounded-md border px-2.5 py-2 text-[11px] leading-4", isLight ? "border-rose-200 bg-rose-50 text-rose-700" : "border-rose-300/30 bg-rose-500/10 text-rose-200")}>
                      {coinbaseErrorText}
                    </p>
                  )}
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className={cn("text-xs uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Privacy Controls</p>
                    <span className={cn("text-[11px]", isLight ? "text-s-50" : "text-slate-500")}>
                      {!coinbasePrivacyHydrated ? "Loading..." : coinbasePrivacySaving ? "Saving..." : "Live"}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div className={cn("rounded-md border px-2.5 py-2 flex items-start justify-between gap-3", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}>
                      <div>
                        <p className={cn("text-sm font-medium", isLight ? "text-s-80" : "text-slate-200")}>Require Consent</p>
                        <p className={cn("text-[11px] mt-1 leading-4", isLight ? "text-s-50" : "text-slate-400")}>
                          Block transaction-history access until explicit user consent is granted.
                        </p>
                      </div>
                      <NovaSwitch
                        checked={coinbasePrivacy.requireTransactionConsent}
                        onChange={(checked) => void updateCoinbasePrivacy({ requireTransactionConsent: checked })}
                        disabled={!coinbasePrivacyHydrated || coinbasePrivacySaving}
                      />
                    </div>
                    <div className={cn("rounded-md border px-2.5 py-2 flex items-start justify-between gap-3", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}>
                      <div>
                        <p className={cn("text-sm font-medium", isLight ? "text-s-80" : "text-slate-200")}>Transaction Consent Granted</p>
                        <p className={cn("text-[11px] mt-1 leading-4", isLight ? "text-s-50" : "text-slate-400")}>
                          Controls whether Nova can read transaction-level history for reports like weekly PnL.
                        </p>
                      </div>
                      <NovaSwitch
                        checked={coinbasePrivacy.transactionHistoryConsentGranted}
                        onChange={(checked) => void updateCoinbasePrivacy({ transactionHistoryConsentGranted: checked })}
                        disabled={!coinbasePrivacyHydrated || coinbasePrivacySaving}
                      />
                    </div>
                    <div className={cn("rounded-md border px-2.5 py-2 flex items-start justify-between gap-3", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}>
                      <div>
                        <p className={cn("text-sm font-medium", isLight ? "text-s-80" : "text-slate-200")}>Show Balances</p>
                        <p className={cn("text-[11px] mt-1 leading-4", isLight ? "text-s-50" : "text-slate-400")}>
                          Redacts portfolio amounts in generated outputs when disabled.
                        </p>
                      </div>
                      <NovaSwitch
                        checked={coinbasePrivacy.showBalances}
                        onChange={(checked) => void updateCoinbasePrivacy({ showBalances: checked })}
                        disabled={!coinbasePrivacyHydrated || coinbasePrivacySaving}
                      />
                    </div>
                    <div className={cn("rounded-md border px-2.5 py-2 flex items-start justify-between gap-3", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}>
                      <div>
                        <p className={cn("text-sm font-medium", isLight ? "text-s-80" : "text-slate-200")}>Show Transactions</p>
                        <p className={cn("text-[11px] mt-1 leading-4", isLight ? "text-s-50" : "text-slate-400")}>
                          Redacts transaction amount/price fields in generated outputs when disabled.
                        </p>
                      </div>
                      <NovaSwitch
                        checked={coinbasePrivacy.showTransactions}
                        onChange={(checked) => void updateCoinbasePrivacy({ showTransactions: checked })}
                        disabled={!coinbasePrivacyHydrated || coinbasePrivacySaving}
                      />
                    </div>
                  </div>
                  {coinbasePrivacy.requireTransactionConsent && !coinbasePrivacy.transactionHistoryConsentGranted && (
                    <p className={cn("mt-2 rounded-md border px-2.5 py-2 text-[11px] leading-4", isLight ? "border-amber-200 bg-amber-50 text-amber-700" : "border-amber-300/30 bg-amber-500/10 text-amber-200")}>
                      Weekly PnL and transaction-history retrieval remain blocked until consent is granted.
                    </p>
                  )}
                  {coinbasePrivacyError && (
                    <p className={cn("mt-2 rounded-md border px-2.5 py-2 text-[11px] leading-4", isLight ? "border-rose-200 bg-rose-50 text-rose-700" : "border-rose-300/30 bg-rose-500/10 text-rose-200")}>
                      {coinbasePrivacyError}
                    </p>
                  )}
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className={cn("text-xs uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Report Defaults</p>
                    <span className={cn("text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>Saved with Coinbase config</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div className="space-y-1">
                      <p className={cn("text-[10px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}>Timezone</p>
                      <FluidSelect
                        value={settings.coinbase.reportTimezone}
                        onChange={(value) => updateCoinbaseDefaults({ reportTimezone: String(value || "UTC") })}
                        options={COINBASE_TIMEZONE_OPTIONS}
                        isLight={isLight}
                      />
                    </div>
                    <div className="space-y-1">
                      <p className={cn("text-[10px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}>Currency</p>
                      <FluidSelect
                        value={settings.coinbase.reportCurrency}
                        onChange={(value) => updateCoinbaseDefaults({ reportCurrency: String(value || "USD").toUpperCase() })}
                        options={COINBASE_CURRENCY_OPTIONS}
                        isLight={isLight}
                      />
                    </div>
                    <div className="space-y-1">
                      <p className={cn("text-[10px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}>Cadence</p>
                      <FluidSelect
                        value={settings.coinbase.reportCadence}
                        onChange={(value) => updateCoinbaseDefaults({ reportCadence: String(value) === "weekly" ? "weekly" : "daily" })}
                        options={COINBASE_CADENCE_OPTIONS}
                        isLight={isLight}
                      />
                    </div>
                  </div>
                  <p className={cn("mt-2 text-[11px] leading-4", isLight ? "text-s-50" : "text-slate-400")}>
                    Required scopes: <span className="font-mono">{coinbaseScopeSummary}</span>
                  </p>
                </div>

                <SecretInput
                  value={coinbaseApiKey}
                  onChange={setCoinbaseApiKey}
                  label="Secret API Key"
                  placeholder="organizations/{org_id}/apiKeys/{key_id}"
                  placeholderWhenConfigured="Enter new key to replace current key"
                  maskedValue={coinbaseApiKeyMasked}
                  isConfigured={coinbaseApiKeyConfigured}
                  name="coinbase_api_key_input"
                  isLight={isLight}
                  subPanelClass={subPanelClass}
                  hint={
                    <>
                      Paste the Coinbase secret API key value (usually <span className="font-mono">organizations/.../apiKeys/...</span>). Do not paste the nickname.
                    </>
                  }
                />

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className={cn("text-xs uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Secret</p>
                    {coinbaseApiSecretConfigured && coinbaseApiSecretMasked && (
                      <p className={cn("text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                        Secret on server: <span className="font-mono">{coinbaseApiSecretMasked}</span>
                      </p>
                    )}
                  </div>
                  <div className="relative">
                    <textarea
                      value={coinbaseApiSecret}
                      onChange={(e) => setCoinbaseApiSecret(e.target.value)}
                      placeholder={coinbaseApiSecretConfigured ? "Enter new secret to replace current secret" : "-----BEGIN EC PRIVATE KEY-----\\n...\\n-----END EC PRIVATE KEY-----"}
                      name="coinbase_api_secret_input"
                      autoComplete="off"
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-form-type="other"
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="none"
                      data-gramm="false"
                      data-gramm_editor="false"
                      data-enable-grammarly="false"
                      rows={showCoinbaseApiSecret ? 6 : 2}
                      className={cn(
                        "w-full min-h-14 pr-10 pl-3 py-2 rounded-md border bg-transparent text-sm font-mono outline-none resize-y",
                        isLight
                          ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
                          : "border-white/10 text-slate-100 placeholder:text-slate-500",
                        )}
                    />
                    <button
                      type="button"
                      onClick={() => setShowCoinbaseApiSecret((v: boolean) => !v)}
                      className={cn(
                        "absolute right-2 top-1/2 z-10 -translate-y-1/2 h-7 w-7 rounded-md flex items-center justify-center transition-all duration-150",
                        isLight ? "text-s-50 hover:bg-black/5" : "text-slate-400 hover:bg-white/10",
                      )}
                      aria-label={showCoinbaseApiSecret ? "Hide API secret" : "Show API secret"}
                      title={showCoinbaseApiSecret ? "Hide API secret" : "Show API secret"}
                    >
                      {showCoinbaseApiSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className={cn("mt-2 text-[11px] leading-4", isLight ? "text-s-50" : "text-slate-400")}>
                    Paste the private key secret exactly as downloaded from Coinbase. Keep line breaks if present. If Coinbase also shows an extra passphrase/secret string, Nova does not use that field in this panel.
                  </p>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className={cn("text-xs uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Setup Instructions</p>
                    {coinbaseNeedsKeyWarning && (
                      <p className={cn("text-[11px]", isLight ? "text-amber-700" : "text-amber-300")}>
                        Keys missing
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div
                      className={cn(
                        "rounded-md border p-2.5 home-spotlight-card home-border-glow",
                        isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20",
                      )}
                    >
                      <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Create Coinbase API Credentials</p>
                      <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                        <li>
                          1. In{" "}
                          <a
                            href="https://portal.cdp.coinbase.com/access/api"
                            target="_blank"
                            rel="noreferrer noopener"
                            className={cn(
                              "underline underline-offset-2 transition-colors",
                              isLight ? "text-s-80 hover:text-s-100" : "text-slate-200 hover:text-white",
                            )}
                          >
                            Link
                          </a>
                          , create a new API key (Advanced Trade / Coinbase App).
                        </li>
                        <li>2. In Advanced Settings, choose <span className="font-mono">ECDSA</span> for SDK compatibility; direct API supports ECDSA and Ed25519.</li>
                        <li>3. For Nova v1, set permissions to read-only (Portfolio View). Leave Trade/Transfer off unless you explicitly need execution flows.</li>
                        <li>4. If you enable IP allowlist, include the real client/server IPs (and IPv6 if your network uses it), or calls will fail.</li>
                        <li>5. Copy the API key value and private key immediately, then store them securely.</li>
                        <li>6. If you see three values in Coinbase, use only the secret API key + secret (private key) here; ignore extra passphrase/secret-string fields for now.</li>
                      </ol>
                    </div>

                    <div
                      className={cn(
                        "rounded-md border p-2.5 home-spotlight-card home-border-glow",
                        isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20",
                      )}
                    >
                      <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Save and Enable in Nova</p>
                      <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                        <li>1. Paste Coinbase value into <span className="font-mono">Secret API Key</span>.</li>
                        <li>2. Paste Coinbase private key into <span className="font-mono">Secret</span> and click <span className="font-mono">Save</span>.</li>
                        <li>3. Confirm both values show masked on server, then click <span className="font-mono">Connect</span>.</li>
                        <li>4. Nova only needs this key + secret pair here. OAuth client ID/secret are not required in this Coinbase panel.</li>
                        <li>5. Do not paste nickname labels or extra passphrase/secret-string values into these fields.</li>
                        <li>6. Click <span className="font-mono">Sync</span> to run the live probe and update sync/freshness status.</li>
                      </ol>
                    </div>
                  </div>
                </div>
              </div>
	            </section>
	            )}

            {activeSetup === "phantom" && (
            <section ref={phantomSetupSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
                    Phantom Setup
                  </h2>
                  <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
                    Launch Nova in your external desktop browser, verify wallet ownership with a signed message, and control exactly what verified Phantom context Nova can use.
                  </p>
                </div>
	                <div className="flex flex-wrap items-center gap-2">
	                  {!settings.phantom.connected && (
	                    <button
	                      onClick={phantomSetup.openBrowserConnect}
                      disabled={isSavingTarget !== null}
                      className={cn(
                        "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                        isLight ? "border-[#d5dce8] bg-[#f4f7fd] text-s-80 hover:bg-white" : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10",
                      )}
                    >
                      Open in Browser
                    </button>
                  )}
                  {!settings.phantom.connected && (
                    <button
                      onClick={phantomSetup.openPhantomInstall}
                      disabled={isSavingTarget !== null}
                      className={cn(
                        "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                        isLight ? "border-[#d5dce8] bg-[#f4f7fd] text-s-80 hover:bg-white" : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10",
                      )}
	                    >
	                      Install Phantom
	                    </button>
	                  )}
	                  {!settings.phantom.connected && (
	                    <button
	                      onClick={() => void phantomSetup.refreshProviderState()}
	                      disabled={isSavingTarget !== null}
	                      className={cn(
	                        "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
	                        isLight ? "border-[#d5dce8] bg-[#f4f7fd] text-s-80 hover:bg-white" : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10",
	                      )}
	                    >
	                      Refresh Detection
	                    </button>
	                  )}
	                  <button
	                    onClick={settings.phantom.connected ? (() => void phantomSetup.disconnectPhantom()) : (() => void phantomSetup.connectPhantom())}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                      settings.phantom.connected
                        ? "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20"
                        : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20",
                    )}
                  >
                    {settings.phantom.connected ? "Disconnect" : "Connect"}
                  </button>
                </div>
              </div>

              <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto no-scrollbar pr-1">
                <div className={cn("rounded-lg border p-3 home-spotlight-card home-border-glow", isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/20")}>
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn("text-xs uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Wallet and Runtime Status</p>
                    <span className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]",
                      settings.phantom.connected
                        ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-200"
                        : "border-amber-300/40 bg-amber-500/15 text-amber-200",
                    )}>
                      {settings.phantom.connected ? "Verified" : "Not Verified"}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr,1fr]">
                    <div className="space-y-1 text-[11px] leading-4">
                      <p className={cn(isLight ? "text-s-60" : "text-slate-400")}>
                        Browser context: <span className="font-mono">{phantomSetup.providerSupportedContext ? "supported" : "open in browser required"}</span>
                      </p>
                      <p className={cn(isLight ? "text-s-60" : "text-slate-400")}>
                        Phantom extension: <span className="font-mono">{phantomSetup.providerInstalled ? "detected" : "not installed in this browser"}</span>
                      </p>
                      <p className={cn(isLight ? "text-s-60" : "text-slate-400")}>
                        Solana wallet: <span className="font-mono">{phantomSetup.walletLabel || "not connected"}</span>
                      </p>
                      <p className={cn(isLight ? "text-s-60" : "text-slate-400")}>
                        Solana signer state: <span className="font-mono">{phantomSetup.providerReady ? "ready" : "locked or disconnected"}</span>
                      </p>
                      <p className={cn(isLight ? "text-s-60" : "text-slate-400")}>
                        Verified at: <span className="font-mono">{phantomSetup.verifiedAt || "n/a"}</span>
                      </p>
                      <p className={cn(isLight ? "text-s-60" : "text-slate-400")}>
                        Connected at: <span className="font-mono">{phantomSetup.connectedAt || "n/a"}</span>
                      </p>
                      <p className={cn(isLight ? "text-s-60" : "text-slate-400")}>
                        EVM wallet: <span className="font-mono">{phantomSetup.evmLabel || "not detected"}</span>
                      </p>
                      <p className={cn(isLight ? "text-s-60" : "text-slate-400")}>
                        EVM chain: <span className="font-mono">{phantomSetup.evmChainId || "n/a"}</span>
                      </p>
                      <p className={cn(isLight ? "text-s-60" : "text-slate-400")}>
                        Trusted reconnect: <span className="font-mono">{phantomSetup.trustedReconnectReady ? "ready" : "waiting"}</span>
                      </p>
                      <p className={cn(isLight ? "text-s-60" : "text-slate-400")}>
                        Last disconnected: <span className="font-mono">{phantomSetup.lastDisconnectedAt || "n/a"}</span>
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      <div className={cn("rounded-lg border p-3", isLight ? "border-[#d5dce8] bg-white/80" : "border-white/10 bg-black/20")}>
                        <p className={cn("text-[11px] font-medium uppercase tracking-[0.14em]", isLight ? "text-s-80" : "text-slate-200")}>Saved Phantom Settings</p>
                        <div className="mt-2 space-y-2">
                          <div className={cn("flex items-center justify-between gap-3 rounded-lg border px-3 py-2", isLight ? "border-[#d5dce8] bg-[#f7f9fe]" : "border-white/10 bg-white/5")}>
                            <div>
                              <p className={cn("text-xs font-medium", isLight ? "text-s-90" : "text-slate-100")}>Agent Wallet Context</p>
                              <p className={cn("text-[11px]", isLight ? "text-s-60" : "text-slate-400")}>Let Nova runtime and tools read the verified Solana wallet label and address.</p>
                            </div>
                            <NovaSwitch
                              size="sm"
                              checked={Boolean(settings.phantom.preferences.allowAgentWalletContext)}
                              disabled={isSavingTarget !== null}
                              onChange={(checked) => void phantomSetup.savePhantomPreferences({ allowAgentWalletContext: checked })}
                            />
                          </div>
                          <div className={cn("flex items-center justify-between gap-3 rounded-lg border px-3 py-2", isLight ? "border-[#d5dce8] bg-[#f7f9fe]" : "border-white/10 bg-white/5")}>
                            <div>
                              <p className={cn("text-xs font-medium", isLight ? "text-s-90" : "text-slate-100")}>EVM Readiness Context</p>
                              <p className={cn("text-[11px]", isLight ? "text-s-60" : "text-slate-400")}>Let Nova read Phantom&apos;s EVM address and chain as safe readiness metadata.</p>
                            </div>
                            <NovaSwitch
                              size="sm"
                              checked={Boolean(settings.phantom.preferences.allowAgentEvmContext)}
                              disabled={isSavingTarget !== null}
                              onChange={(checked) => void phantomSetup.savePhantomPreferences({ allowAgentEvmContext: checked })}
                            />
                          </div>
                          <div className={cn("flex items-center justify-between gap-3 rounded-lg border px-3 py-2", isLight ? "border-[#d5dce8] bg-[#f7f9fe]" : "border-white/10 bg-white/5")}>
                            <div>
                              <p className={cn("text-xs font-medium", isLight ? "text-s-90" : "text-slate-100")}>Approval-Gated Polymarket Prep</p>
                              <p className={cn("text-[11px]", isLight ? "text-s-60" : "text-slate-400")}>Allow Nova to prepare future Polymarket actions that still require your explicit approval.</p>
                            </div>
                            <NovaSwitch
                              size="sm"
                              checked={Boolean(settings.phantom.preferences.allowApprovalGatedPolymarket)}
                              disabled={isSavingTarget !== null}
                              onChange={(checked) => void phantomSetup.savePhantomPreferences({ allowApprovalGatedPolymarket: checked })}
                            />
                          </div>
                        </div>
                      </div>
                      <div className={cn("rounded-lg border p-3", isLight ? "border-emerald-200 bg-emerald-50" : "border-emerald-500/20 bg-emerald-500/10")}>
                        <p className={cn("text-[11px] font-medium uppercase tracking-[0.14em]", isLight ? "text-emerald-800" : "text-emerald-200")}>Current Runtime Status</p>
                        <ul className={cn("mt-2 space-y-1 text-[11px] leading-4", isLight ? "text-emerald-900" : "text-emerald-100")}>
                          {phantomRuntimeStatus.map((item) => (
                            <li key={item}>- {item}</li>
                          ))}
                        </ul>
                        <p className={cn("mt-2 text-[10px] uppercase tracking-[0.14em]", isLight ? "text-emerald-700" : "text-emerald-300")}>
                          Saved toggles apply to the user-scoped runtime snapshot immediately.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {!phantomSetup.providerSupportedContext && (
                  <div className={cn(
                    "rounded-lg border p-3 text-xs",
                    isLight ? "border-amber-200 bg-amber-50 text-amber-800" : "border-amber-500/30 bg-amber-500/10 text-amber-200",
                  )}>
                    {phantomSetup.providerContextReason || "Phantom wallet connect requires a top-level https or localhost page."} Click <span className="font-mono">Open in Browser</span> to continue in a standard browser window.
                  </div>
                )}

	                {phantomSetup.providerSupportedContext && !phantomSetup.providerInstalled && (
	                  <div className={cn(
	                    "rounded-lg border p-3 text-xs",
	                    isLight ? "border-amber-200 bg-amber-50 text-amber-800" : "border-amber-500/30 bg-amber-500/10 text-amber-200",
	                  )}>
	                    Phantom is not detected in this browser profile. If it is already installed in Chrome, open the Phantom extension menu and allow site access on <span className="font-mono">localhost</span> or <span className="font-mono">all sites</span>, then click <span className="font-mono">Refresh Detection</span>. If it is not installed yet, click <span className="font-mono">Install Phantom</span>.
	                  </div>
	                )}

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Desktop Connect Path</p>
                  <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                    <li>1. If you are in the Nova desktop HUD or another embedded view, click <span className="font-mono">Open in Browser</span>. Nova now asks the local machine to open your external browser directly and prefers Chrome on Windows when available.</li>
                    <li>2. In that browser, click <span className="font-mono">Install Phantom</span> if the extension is missing, then unlock Phantom and select the wallet you want Nova to use.</li>
                    <li>3. Back in the browser tab running Nova, click <span className="font-mono">Connect</span> and approve account access.</li>
                    <li>4. Approve the signed wallet verification message. Nova stores only wallet metadata and your saved Phantom settings, never a seed phrase or private key.</li>
                  </ol>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Hard Limits</p>
                  <ul className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                    {phantomHardLimits.map((item) => (
                      <li key={item}>- {item}</li>
                    ))}
                    <li>- This is wallet connect plus signed-message authentication, not OAuth.</li>
                  </ul>
                </div>
              </div>
            </section>
            )}

	            {activeSetup === "spotify" && (
	            <section ref={spotifySetupSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
                    Spotify Setup
                  </h2>
                  <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
                    Connect your Spotify account so Nova can use Spotify tools in chat and workflows.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={settings.spotify.connected ? (() => void spotifySetup.disconnectSpotify()) : spotifySetup.connectSpotify}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                      settings.spotify.connected
                        ? "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20"
                        : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20",
                    )}
                  >
                    {settings.spotify.connected ? "Disconnect" : "Connect"}
                  </button>
                </div>
              </div>

              <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto no-scrollbar pr-1">
                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Create Spotify App Credentials</p>
                  <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                    <li>
                      1. Open{" "}
                      <a
                        href="https://developer.spotify.com/dashboard"
                        target="_blank"
                        rel="noreferrer noopener"
                        className={cn(
                          "underline underline-offset-2 transition-colors",
                          isLight ? "text-s-80 hover:text-s-100" : "text-slate-200 hover:text-white",
                        )}
                      >
                        Spotify Developer Dashboard
                      </a>{" "}
                      and create an app.
                    </li>
                    <li>2. Copy the app <span className="font-mono">Client ID</span> into Nova.</li>
                    <li>3. In Spotify app settings, add Nova callback URL as a redirect URI.</li>
                    <li>4. Save app settings in Spotify before running OAuth connect from Nova.</li>
                  </ol>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>OAuth Settings</p>
                  <div className="space-y-2">
                    <input
                      value={spotifySetup.spotifyClientId}
                      onChange={(e) => spotifySetup.setSpotifyClientId(e.target.value)}
                      placeholder="Spotify Client ID"
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="none"
                      data-gramm="false"
                      data-gramm_editor="false"
                      data-enable-grammarly="false"
                      className={cn(
                        "w-full h-9 px-3 rounded-md border bg-transparent text-sm outline-none",
                        isLight
                          ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
                          : "border-white/10 text-slate-100 placeholder:text-slate-500",
                      )}
                    />
                    <input
                      value={spotifySetup.spotifyRedirectUri}
                      onChange={(e) => spotifySetup.setSpotifyRedirectUri(e.target.value)}
                      placeholder="http://localhost:3000/api/integrations/spotify/callback"
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="none"
                      data-gramm="false"
                      data-gramm_editor="false"
                      data-enable-grammarly="false"
                      className={cn(
                        "w-full h-9 px-3 rounded-md border bg-transparent text-sm outline-none",
                        isLight
                          ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
                          : "border-white/10 text-slate-100 placeholder:text-slate-500",
                      )}
                    />
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => void spotifySetup.saveSpotifyConfig()}
                      disabled={isSavingTarget !== null}
                      className={cn(
                        "h-8 px-3 rounded-lg border border-accent-30 bg-accent-10 text-accent transition-colors hover:bg-accent-20 home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                      )}
                    >
                      <Save className="w-3.5 h-3.5" />
                      {isSavingTarget === "spotify-save" ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={() => void spotifySetup.testSpotifyConnection()}
                      disabled={isSavingTarget !== null}
                      className={cn(
                        "h-8 px-3 rounded-lg border border-emerald-300/40 bg-emerald-500/15 text-emerald-200 transition-colors hover:bg-emerald-500/20 home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                      )}
                    >
                      {isSavingTarget === "spotify-test" ? "Testing..." : "Test"}
                    </button>
                  </div>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Connect Flow</p>
                  <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                    <li>1. Enter Client ID and Redirect URI, then click <span className="font-mono">Save</span>.</li>
                    <li>2. Click <span className="font-mono">Connect</span> and complete Spotify OAuth in the popup.</li>
                    <li>3. After redirect back to Nova, click <span className="font-mono">Test</span> to verify token and scope.</li>
                    <li>4. Use the same top button to <span className="font-mono">Disconnect</span> when you want to revoke Nova access.</li>
                  </ol>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Connection Status</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <p className={cn("text-[12px]", isLight ? "text-s-70" : "text-slate-300")}>
                      Connected: <span className={cn("font-mono", settings.spotify.connected ? "text-emerald-300" : "text-rose-300")}>{settings.spotify.connected ? "yes" : "no"}</span>
                    </p>
                    <p className={cn("text-[12px]", isLight ? "text-s-70" : "text-slate-300")}>
                      Token: <span className={cn("font-mono", settings.spotify.tokenConfigured ? "text-emerald-300" : "text-rose-300")}>{settings.spotify.tokenConfigured ? "configured" : "missing"}</span>
                    </p>
                    <p className={cn("text-[12px] truncate", isLight ? "text-s-70" : "text-slate-300")}>
                      User ID: <span className="font-mono">{spotifySetup.spotifyUserId || "n/a"}</span>
                    </p>
                    <p className={cn("text-[12px] truncate", isLight ? "text-s-70" : "text-slate-300")}>
                      Name: <span className="font-mono">{spotifySetup.spotifyDisplayName || "n/a"}</span>
                    </p>
                  </div>
                  <p className={cn("mt-2 text-[11px] leading-4", isLight ? "text-s-50" : "text-slate-400")}>
                    Scopes: <span className="font-mono">{spotifySetup.spotifyScopes || "none"}</span>
                  </p>
                </div>
              </div>
            </section>
            )}

            {activeSetup === "youtube" && (
            <section ref={youtubeSetupSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
                    YouTube Setup
                  </h2>
                  <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
                    Connect YouTube with your Google OAuth account. Nova keeps Home playback muted and respects your per-user permissions.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={settings.youtube.connected ? (() => void youtubeSetup.disconnectYouTube()) : youtubeSetup.connectYouTube}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                      settings.youtube.connected
                        ? "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20"
                        : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20",
                    )}
                  >
                    {settings.youtube.connected ? "Disconnect" : "Connect"}
                  </button>
                  <button
                    onClick={() => void youtubeSetup.testYouTubeConnection()}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border border-emerald-300/40 bg-emerald-500/15 text-emerald-200 transition-colors hover:bg-emerald-500/20 home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                    )}
                  >
                    {isSavingTarget === "youtube-test" ? "Testing..." : "Test"}
                  </button>
                </div>
              </div>

              <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto no-scrollbar pr-1">
                {!gmailHasCredentials && (
                  <div className={cn(
                    "rounded-lg border p-3 text-xs",
                    isLight ? "border-amber-200 bg-amber-50 text-amber-800" : "border-amber-500/30 bg-amber-500/10 text-amber-200",
                  )}>
                    YouTube uses your Gmail OAuth app credentials. Configure Gmail Client ID and Secret in Gmail Setup first.
                  </div>
                )}

                <div className={cn("rounded-lg border p-3 home-spotlight-card home-border-glow", isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/20")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>
                    Connection
                  </p>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full shrink-0",
                        settings.youtube.connected ? "bg-emerald-400" : "bg-rose-400",
                      )}
                      aria-hidden="true"
                    />
                    <span className={cn("text-xs font-medium", isLight ? "text-s-90" : "text-slate-100")}>
                      {settings.youtube.connected ? `Connected as ${youtubeSetup.youtubeChannelTitle || "YouTube channel"}` : "Not connected"}
                    </span>
                  </div>
                </div>

                {settings.youtube.connected && (
                  <div className={cn("rounded-lg border p-3", isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/20")}>
                    <p className={cn("text-[11px] mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>
                      YouTube Permissions
                    </p>
                    <div className="space-y-2">
                      <div className={cn("flex items-center justify-between gap-3 rounded-lg border px-3 py-2", isLight ? "border-[#d5dce8] bg-white/70" : "border-white/10 bg-black/20")}>
                        <div>
                          <p className={cn("text-xs font-medium", isLight ? "text-s-90" : "text-slate-100")}>Home Feed</p>
                          <p className={cn("text-[11px]", isLight ? "text-s-60" : "text-slate-400")}>Allow Nova to load personalized or source-weighted YouTube feed results.</p>
                        </div>
                        <NovaSwitch
                          size="sm"
                          checked={Boolean(youtubeSetup.youtubePermissions.allowFeed)}
                          disabled={isSavingTarget !== null || !youtubeHasReadonlyScope}
                          onChange={(checked) => void youtubeSetup.updateYouTubePermissions({ allowFeed: checked })}
                        />
                      </div>
                      <div className={cn("flex items-center justify-between gap-3 rounded-lg border px-3 py-2", isLight ? "border-[#d5dce8] bg-white/70" : "border-white/10 bg-black/20")}>
                        <div>
                          <p className={cn("text-xs font-medium", isLight ? "text-s-90" : "text-slate-100")}>Search</p>
                          <p className={cn("text-[11px]", isLight ? "text-s-60" : "text-slate-400")}>Allow Nova to search YouTube videos and channels for this user.</p>
                        </div>
                        <NovaSwitch
                          size="sm"
                          checked={Boolean(youtubeSetup.youtubePermissions.allowSearch)}
                          disabled={isSavingTarget !== null || !youtubeHasReadonlyScope}
                          onChange={(checked) => void youtubeSetup.updateYouTubePermissions({ allowSearch: checked })}
                        />
                      </div>
                      <div className={cn("flex items-center justify-between gap-3 rounded-lg border px-3 py-2", isLight ? "border-[#d5dce8] bg-white/70" : "border-white/10 bg-black/20")}>
                        <div>
                          <p className={cn("text-xs font-medium", isLight ? "text-s-90" : "text-slate-100")}>Video Details</p>
                          <p className={cn("text-[11px]", isLight ? "text-s-60" : "text-slate-400")}>Allow Nova to fetch metadata such as duration, views, and channel details.</p>
                        </div>
                        <NovaSwitch
                          size="sm"
                          checked={Boolean(youtubeSetup.youtubePermissions.allowVideoDetails)}
                          disabled={isSavingTarget !== null || !youtubeHasReadonlyScope}
                          onChange={(checked) => void youtubeSetup.updateYouTubePermissions({ allowVideoDetails: checked })}
                        />
                      </div>
                      {!youtubeHasReadonlyScope && (
                        <p className={cn("text-[11px]", isLight ? "text-amber-700" : "text-amber-300")}>
                          This account is missing YouTube read scope. Reconnect YouTube to grant permissions.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>How it works</p>
                  <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                    <li>1. Configure Gmail OAuth client credentials in Gmail Setup.</li>
                    <li>2. Click <span className="font-mono">Connect</span> and approve YouTube read access in Google OAuth.</li>
                    <li>3. Keep Home playback muted while browsing Nova.</li>
                    <li>4. Use permissions above to restrict feed/search/details behavior per user.</li>
                  </ol>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Connection Status</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <p className={cn("text-[12px]", isLight ? "text-s-70" : "text-slate-300")}>
                      Connected: <span className={cn("font-mono", settings.youtube.connected ? "text-emerald-300" : "text-rose-300")}>{settings.youtube.connected ? "yes" : "no"}</span>
                    </p>
                    <p className={cn("text-[12px]", isLight ? "text-s-70" : "text-slate-300")}>
                      Token: <span className={cn("font-mono", settings.youtube.tokenConfigured ? "text-emerald-300" : "text-rose-300")}>{settings.youtube.tokenConfigured ? "configured" : "missing"}</span>
                    </p>
                    <p className={cn("text-[12px] truncate", isLight ? "text-s-70" : "text-slate-300")}>
                      Channel ID: <span className="font-mono">{youtubeSetup.youtubeChannelId || "n/a"}</span>
                    </p>
                    <p className={cn("text-[12px] truncate", isLight ? "text-s-70" : "text-slate-300")}>
                      Channel: <span className="font-mono">{youtubeSetup.youtubeChannelTitle || "n/a"}</span>
                    </p>
                  </div>
                  <p className={cn("mt-2 text-[11px] leading-4", isLight ? "text-s-50" : "text-slate-400")}>
                    Scopes: <span className="font-mono">{youtubeSetup.youtubeScopes || "none"}</span>
                  </p>
                </div>
              </div>
            </section>
            )}

            {providerDefinition && (
              <LlmSetupPanel
                sectionRef={providerDefinition.sectionRef}
                panelStyle={panelStyle}
                panelClass={panelClass}
                moduleHeightClass={moduleHeightClass}
                isLight={isLight}
                subPanelClass={subPanelClass}
                title={providerDefinition.title}
                description={providerDefinition.description}
                isConnected={providerDefinition.isConnected}
                isSaving={providerDefinition.isSaving}
                isSavingAny={isSavingTarget !== null}
                onToggle={providerDefinition.onToggle}
                onSave={providerDefinition.onSave}
                apiKey={providerDefinition.apiKey}
                onApiKeyChange={providerDefinition.onApiKeyChange}
                apiKeyPlaceholder={providerDefinition.apiKeyPlaceholder}
                apiKeyConfigured={providerDefinition.apiKeyConfigured}
                apiKeyMasked={providerDefinition.apiKeyMasked}
                apiKeyInputName={providerDefinition.apiKeyInputName}
                apiKeyPlaceholderWhenConfigured={providerDefinition.apiKeyPlaceholderWhenConfigured}
                baseUrl={providerDefinition.baseUrl}
                onBaseUrlChange={providerDefinition.onBaseUrlChange}
                baseUrlPlaceholder={providerDefinition.baseUrlPlaceholder}
                baseUrlHint={providerDefinition.baseUrlHint}
                model={providerDefinition.model}
                onModelChange={providerDefinition.onModelChange}
                modelOptions={providerDefinition.modelOptions}
                costEstimate={providerDefinition.costEstimate}
                priceHint={providerDefinition.priceHint}
                usageNote={providerDefinition.usageNote}
                instructionSteps={providerDefinition.instructionSteps}
              />
            )}

            {activeSetup === "gmail" && (
              <GmailSetupPanel
                sectionRef={gmailSetupSectionRef}
                panelStyle={panelStyle}
                panelClass={panelClass}
                moduleHeightClass={moduleHeightClass}
                isLight={isLight}
                subPanelClass={subPanelClass}
                settings={settings}
                isSavingAny={isSavingTarget !== null}
                isSavingOauth={isSavingTarget === "gmail-oauth"}
                gmailClientId={gmailSetup.gmailClientId}
                onGmailClientIdChange={gmailSetup.setGmailClientId}
                gmailClientSecret={gmailSetup.gmailClientSecret}
                onGmailClientSecretChange={gmailSetup.setGmailClientSecret}
                gmailClientSecretConfigured={gmailSetup.gmailClientSecretConfigured}
                gmailClientSecretMasked={gmailSetup.gmailClientSecretMasked}
                gmailRedirectUri={gmailSetup.gmailRedirectUri}
                onGmailRedirectUriChange={gmailSetup.setGmailRedirectUri}
                selectedGmailAccountId={gmailSetup.selectedGmailAccountId}
                onSelectGmailAccount={gmailSetup.setSelectedGmailAccountId}
                onSaveGmailConfig={gmailSetup.saveGmailConfig}
                onConnectGmail={gmailSetup.connectGmail}
                onDisconnectGmail={gmailSetup.disconnectGmail}
                onSetPrimaryGmailAccount={gmailSetup.setPrimaryGmailAccount}
                onUpdateGmailAccountState={gmailSetup.updateGmailAccountState}
              />
            )}

            {activeSetup === "gmail-calendar" && (
              <GmailCalendarSetupPanel
                sectionRef={gmailCalendarSetupSectionRef}
                panelStyle={panelStyle}
                panelClass={panelClass}
                moduleHeightClass={moduleHeightClass}
                isLight={isLight}
                subPanelClass={subPanelClass}
                settings={settings}
                isSavingAny={isSavingTarget !== null}
                selectedAccountId={gmailCalendarSetup.selectedAccountId}
                onSelectAccount={gmailCalendarSetup.setSelectedAccountId}
                onConnect={gmailCalendarSetup.connectGmailCalendar}
                onDisconnect={gmailCalendarSetup.disconnectGmailCalendar}
                onUpdatePermissions={gmailCalendarSetup.updateCalendarPermissions}
              />
            )}

          </div>  )
}
