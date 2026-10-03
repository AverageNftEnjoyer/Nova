import type { CSSProperties } from "react"
import { Save } from "lucide-react"
import { cn } from "@/lib/shared/utils"
import type { IntegrationsSettings } from "@/lib/integrations/store/client-store"
import { SecretInput } from "./SecretInput"
import { TextInput } from "./TextInput"
import { SetupInstructions } from "./SetupInstructions"

interface GmailSetupPanelProps {
  sectionRef: React.RefObject<HTMLElement | null>
  panelStyle: CSSProperties | undefined
  panelClass: string
  moduleHeightClass: string
  isLight: boolean
  subPanelClass: string
  settings: IntegrationsSettings
  isSavingAny: boolean
  isSavingOauth: boolean
  gmailClientId: string
  onGmailClientIdChange: (value: string) => void
  gmailClientSecret: string
  onGmailClientSecretChange: (value: string) => void
  gmailClientSecretConfigured: boolean
  gmailClientSecretMasked: string
  gmailRedirectUri: string
  onGmailRedirectUriChange: (value: string) => void
  selectedGmailAccountId: string
  onSelectGmailAccount: (value: string) => void
  onSaveGmailConfig: () => void
  onConnectGmail: () => void
  onDisconnectGmail: (accountId?: string) => void
  onSetPrimaryGmailAccount: (accountId: string) => void
  onUpdateGmailAccountState: (action: "set_enabled" | "delete", accountId: string, enabled?: boolean) => void
}

export function GmailSetupPanel({
  sectionRef,
  panelStyle,
  panelClass,
  moduleHeightClass,
  isLight,
  subPanelClass,
  settings,
  isSavingAny,
  isSavingOauth,
  gmailClientId,
  onGmailClientIdChange,
  gmailClientSecret,
  onGmailClientSecretChange,
  gmailClientSecretConfigured,
  gmailClientSecretMasked,
  gmailRedirectUri,
  onGmailRedirectUriChange,
  selectedGmailAccountId,
  onSelectGmailAccount,
  onSaveGmailConfig,
  onConnectGmail,
  onDisconnectGmail,
  onSetPrimaryGmailAccount,
  onUpdateGmailAccountState,
}: GmailSetupPanelProps) {
  return (
    <section ref={sectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
            Gmail Setup
          </h2>
          <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
            Connect one or more Gmail accounts for U.B Agents workflows and chat-triggered inbox automations.
          </p>
        </div>
        <div className="grid grid-cols-[repeat(2,max-content)] gap-2 w-full lg:w-auto">
          <button
            onClick={onSaveGmailConfig}
            disabled={isSavingAny}
            className={cn(
              "pixel-btn pixel-btn--gold",
            )}
          >
            <Save className="w-3.5 h-3.5" />
            {isSavingOauth ? "Saving..." : "Save OAuth"}
          </button>
          <button
            onClick={settings.gmail.connected ? () => onDisconnectGmail() : onConnectGmail}
            disabled={isSavingAny}
            className={cn(
              "pixel-btn",
              settings.gmail.connected
                ? "pixel-btn--red"
                : "pixel-btn--teal",
            )}
          >
            {settings.gmail.connected ? "Disconnect All" : "Connect"}
          </button>
        </div>
      </div>

      <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto no-scrollbar pr-1">
        <TextInput
          value={gmailClientId}
          onChange={onGmailClientIdChange}
          label="OAuth Client ID"
          placeholder="123456789012-abc123def456.apps.googleusercontent.com"
          isLight={isLight}
          subPanelClass={subPanelClass}
        />

        <SecretInput
          value={gmailClientSecret}
          onChange={onGmailClientSecretChange}
          label="OAuth Client Secret"
          placeholder="Paste Gmail OAuth client secret"
          placeholderWhenConfigured="Paste new secret to replace current secret"
          maskedValue={gmailClientSecretMasked}
          isConfigured={gmailClientSecretConfigured}
          serverLabel="Secret on server"
          isLight={isLight}
          subPanelClass={subPanelClass}
        />

        <TextInput
          value={gmailRedirectUri}
          onChange={onGmailRedirectUriChange}
          label="Redirect URI"
          placeholder="http://localhost:3000/api/integrations/gmail/callback"
          hint="Must exactly match the authorized redirect URI in your Google Cloud OAuth client."
          isLight={isLight}
          subPanelClass={subPanelClass}
        />

        <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
          <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Connection Status</p>
          <p className={cn("text-sm", isLight ? "text-s-90" : "text-slate-200")}>
            {settings.gmail.connected ? "Connected" : "Disconnected"} - {settings.gmail.accounts.length} linked
          </p>
          <p className={cn("mt-1 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
            Primary: {settings.gmail.email || "Not linked yet"}
          </p>
          <p className={cn("mt-1 text-[11px]", isLight ? "text-s-40" : "text-slate-500")}>
            Enabled accounts: {settings.gmail.accounts.filter((account) => account.enabled !== false).length}
          </p>
        </div>

        <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
          <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Linked Accounts</p>
          <div className="space-y-2">
            {settings.gmail.accounts.length === 0 && (
              <p className={cn("text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                No Gmail accounts linked yet.
              </p>
            )}
            {settings.gmail.accounts.map((account) => (
              <div
                key={account.id}
                onClick={() => onSelectGmailAccount(account.id)}
                className={cn(
                  "rounded-md border px-2.5 py-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 cursor-pointer",
                  selectedGmailAccountId === account.id
                    ? (isLight ? "border-[#9fb3d8] bg-[#eaf1fc]" : "border-white/30 bg-white/10")
                    : ("ig-tile"),
                )}
              >
                <div className="min-w-0">
                  <p className={cn("text-[12px] truncate", isLight ? "text-s-90" : "text-slate-100")}>{account.email}</p>
                  <p className={cn("text-[10px] truncate", isLight ? "text-s-50" : "text-slate-500")}>
                    {account.active ? "Primary" : "Linked"} • {account.enabled === false ? "Disabled" : "Enabled"}
                  </p>
                </div>
                <span className={cn("text-[10px]", isLight ? "text-s-50" : "text-slate-400")}>
                  {selectedGmailAccountId === account.id ? "Selected" : "Select"}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={onConnectGmail}
              disabled={isSavingAny}
              className={cn(
                "pixel-btn ig-btn-sm",
                "pixel-btn--teal",
              )}
            >
              Link Another
            </button>
            <button
              onClick={() => selectedGmailAccountId && onSetPrimaryGmailAccount(selectedGmailAccountId)}
              disabled={isSavingAny || !selectedGmailAccountId}
              className={cn(
                "pixel-btn ig-btn-sm",
                "pixel-btn--ghost",
              )}
            >
              Set Primary
            </button>
            <button
              onClick={() => {
                const account = settings.gmail.accounts.find((item) => item.id === selectedGmailAccountId)
                if (!account) return
                onUpdateGmailAccountState("set_enabled", account.id, account.enabled === false)
              }}
              disabled={isSavingAny || !selectedGmailAccountId}
              className={cn(
                "pixel-btn ig-btn-sm",
                "pixel-btn--ghost",
              )}
            >
              {settings.gmail.accounts.find((item) => item.id === selectedGmailAccountId)?.enabled === false ? "Enable" : "Disable"}
            </button>
            <button
              onClick={() => selectedGmailAccountId && onUpdateGmailAccountState("delete", selectedGmailAccountId)}
              disabled={isSavingAny || !selectedGmailAccountId}
              className={cn(
                "pixel-btn ig-btn-sm",
                "pixel-btn--red",
              )}
            >
              Delete
            </button>
          </div>
          <p className={cn("mt-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
            Inbox summaries and email actions run via U.B Agents chat prompts or mission workflow steps, not from this setup panel.
          </p>
        </div>

        <SetupInstructions
          steps={[
            "In Google Cloud, create/select your project and enable Gmail API.",
            "Open OAuth consent screen, choose External, and select User Data.",
            "Fill app info, then add Gmail scopes (start with gmail.readonly).",
            "If app is in Testing mode, add your Gmail addresses as Test users.",
            "Create OAuth Client ID (Web application) and paste credentials here.",
            "Add the exact Redirect URI shown above, click Save OAuth, then Connect.",
            "Repeat Connect to add multiple Gmail accounts, then use Set Primary.",
          ]}
          isLight={isLight}
          subPanelClass={subPanelClass}
        />
      </div>
    </section>
  )
}
