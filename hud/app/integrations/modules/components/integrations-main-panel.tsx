import { Eye, EyeOff, Save } from "lucide-react"

import { cn } from "@/lib/shared/utils"
import { FluidSelect } from "@/components/ui/fluid-select"
import { NovaSwitch } from "@/components/ui/nova-switch"

import { LlmSetupPanel, GmailSetupPanel } from "../../components"
import { COINBASE_TIMEZONE_OPTIONS, COINBASE_CURRENCY_OPTIONS, COINBASE_CADENCE_OPTIONS } from "../coinbase/meta"
import type { IntegrationsMainPanelProps } from "../types"

export function IntegrationsMainPanel(props: IntegrationsMainPanelProps) {
  const {
    activeSetup, panelStyle, panelClass, moduleHeightClass, isLight, subPanelClass, settings, isSavingTarget,
    braveNeedsKeyWarning, braveApiKeyConfigured, braveApiKeyMasked, coinbaseNeedsKeyWarning, coinbasePendingAction, coinbaseSyncBadgeClass, coinbaseSyncLabel,
    coinbaseLastSyncText, coinbaseFreshnessText, coinbaseErrorText, coinbaseHasKeys, coinbaseScopeSummary, coinbasePrivacy, coinbasePrivacyHydrated, coinbasePrivacySaving, coinbasePrivacyError,
    coinbaseApiKey, setCoinbaseApiKey, showCoinbaseApiKey, setShowCoinbaseApiKey, coinbaseApiKeyConfigured,
    coinbaseApiKeyMasked, coinbaseApiSecret, setCoinbaseApiSecret, showCoinbaseApiSecret, setShowCoinbaseApiSecret,
    coinbaseApiSecretConfigured, coinbaseApiSecretMasked, providerDefinition, gmailSetup, telegramSetupSectionRef,
    discordSetupSectionRef, braveSetupSectionRef, coinbaseSetupSectionRef, gmailSetupSectionRef, setBotToken,
    botToken, botTokenConfigured, botTokenMasked, setChatIds, chatIds, setDiscordWebhookUrls, discordWebhookUrls,
    setBraveApiKey, braveApiKey, toggleTelegram, saveTelegramConfig, toggleDiscord, saveDiscordConfig, toggleBrave,
    saveBraveConfig, probeCoinbaseConnection, toggleCoinbase, saveCoinbaseConfig, updateCoinbasePrivacy,
    updateCoinbaseDefaults,
  } = props

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
                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Bot Token</p>
                  {botTokenConfigured && botTokenMasked && (
                    <p className={cn("mb-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                      Token on server: <span className="font-mono">{botTokenMasked}</span>
                    </p>
                  )}
                  <div>
                    <input
                      type="password"
                      value={botToken}
                      onChange={(e) => setBotToken(e.target.value)}
                      placeholder={botTokenConfigured ? "Enter new bot token to replace current token" : "1234567890:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}
                      name="telegram_token_input"
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
                      className={cn(
                        "w-full h-9 pr-10 pl-3 rounded-md border bg-transparent text-sm outline-none",
                        isLight
                          ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
                          : "border-white/10 text-slate-100 placeholder:text-slate-500",
                      )}
                    />
                  </div>
                </div>

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
                    {braveNeedsKeyWarning && (
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
                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>API Key</p>
                  {braveApiKeyConfigured && braveApiKeyMasked && (
                    <p className={cn("mb-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                      Key on server: <span className="font-mono">{braveApiKeyMasked}</span>
                    </p>
                  )}
                  <input
                    type="password"
                    value={braveApiKey}
                    onChange={(e) => setBraveApiKey(e.target.value)}
                    placeholder={braveApiKeyConfigured ? "Enter new key to replace current key" : "BSAI-xxxxxxxxxxxxxxxx"}
                    name="brave_api_key_input"
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
                    className={cn(
                      "w-full h-9 px-3 rounded-md border bg-transparent text-sm outline-none",
                      isLight
                        ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
                        : "border-white/10 text-slate-100 placeholder:text-slate-500",
                    )}
                  />
                </div>

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

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Secret API Key</p>
                  {coinbaseApiKeyConfigured && coinbaseApiKeyMasked && (
                    <p className={cn("mb-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                      Key on server: <span className="font-mono">{coinbaseApiKeyMasked}</span>
                    </p>
                  )}
                  <div className="relative">
                    <input
                      type={showCoinbaseApiKey ? "text" : "password"}
                      value={coinbaseApiKey}
                      onChange={(e) => setCoinbaseApiKey(e.target.value)}
                      placeholder={coinbaseApiKeyConfigured ? "Enter new key to replace current key" : "organizations/{org_id}/apiKeys/{key_id}"}
                      name="coinbase_api_key_input"
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
                      className={cn(
                        "w-full h-9 pr-10 pl-3 rounded-md border bg-transparent text-sm outline-none",
                        isLight
                          ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
                          : "border-white/10 text-slate-100 placeholder:text-slate-500",
                        )}
                    />
                    <button
                      type="button"
                      onClick={() => setShowCoinbaseApiKey((v: boolean) => !v)}
                      className={cn(
                        "absolute right-2 top-1/2 z-10 -translate-y-1/2 h-7 w-7 rounded-md flex items-center justify-center transition-all duration-150",
                        isLight ? "text-s-50 hover:bg-black/5" : "text-slate-400 hover:bg-white/10",
                      )}
                      aria-label={showCoinbaseApiKey ? "Hide API key" : "Show API key"}
                      title={showCoinbaseApiKey ? "Hide API key" : "Show API key"}
                    >
                      {showCoinbaseApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className={cn("mt-2 text-[11px] leading-4", isLight ? "text-s-50" : "text-slate-400")}>
                    Paste the Coinbase secret API key value (usually <span className="font-mono">organizations/.../apiKeys/...</span>). Do not paste the nickname.
                  </p>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Secret</p>
                  {coinbaseApiSecretConfigured && coinbaseApiSecretMasked && (
                    <p className={cn("mb-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                      Secret on server: <span className="font-mono">{coinbaseApiSecretMasked}</span>
                    </p>
                  )}
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

          </div>  )
}
