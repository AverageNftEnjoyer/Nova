import type { CSSProperties } from "react"
import { cn } from "@/lib/shared/utils"
import { NovaSwitch } from "@/components/ui/nova-switch"
import type { IntegrationsSettings } from "@/lib/integrations/client-store"

interface GmailCalendarSetupPanelProps {
  sectionRef: React.RefObject<HTMLElement | null>
  panelStyle: CSSProperties | undefined
  panelClass: string
  moduleHeightClass: string
  isLight: boolean
  subPanelClass: string
  settings: IntegrationsSettings
  isSavingAny: boolean
  selectedAccountId: string
  onSelectAccount: (value: string) => void
  onConnect: () => void
  onDisconnect: (accountId?: string) => void
  onUpdatePermissions: (patch: Partial<IntegrationsSettings["gcalendar"]["permissions"]>) => void | Promise<void>
}

export function GmailCalendarSetupPanel({
  sectionRef,
  panelStyle,
  panelClass,
  moduleHeightClass,
  isLight,
  subPanelClass,
  settings,
  isSavingAny,
  selectedAccountId,
  onSelectAccount,
  onConnect,
  onDisconnect,
  onUpdatePermissions,
}: GmailCalendarSetupPanelProps) {
  const gcal = settings.gcalendar
  const accounts = gcal.accounts ?? []
  const mergedScopes = new Set(
    [
      ...(typeof gcal.scopes === "string" ? gcal.scopes.split(/\s+/).map((s) => s.trim()).filter(Boolean) : []),
      ...accounts.flatMap((account) => (Array.isArray(account.scopes) ? account.scopes : [])),
    ].map((scope) => scope.toLowerCase()),
  )
  const canManageEvents =
    mergedScopes.has("https://www.googleapis.com/auth/calendar.events") ||
    mergedScopes.has("https://www.googleapis.com/auth/calendar")
  const gmailHasCredentials =
    Boolean(settings.gmail.oauthClientId?.trim()) &&
    (Boolean(settings.gmail.oauthClientSecretConfigured) || Boolean(settings.gmail.oauthClientSecret?.trim()))

  return (
    <section
      ref={sectionRef}
      style={panelStyle}
      className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
            Google Calendar Setup
          </h2>
          <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
            Connect Google Calendar using your existing Gmail OAuth credentials. Set exactly what Nova can do with events.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {gcal.connected ? (
            <>
              <button
                onClick={() => onDisconnect(selectedAccountId || undefined)}
                disabled={isSavingAny}
                className={cn(
                  "h-8 px-3 rounded-lg border text-xs font-medium transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                  "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20",
                )}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={onConnect}
              disabled={isSavingAny}
              className={cn(
                "h-8 px-3 rounded-lg border text-xs font-medium transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20",
              )}
            >
              Connect
            </button>
          )}
        </div>
      </div>

      {/* Gmail OAuth requirement notice */}
      {!gmailHasCredentials && (
        <div className={cn(
          "mt-4 rounded-lg border p-3 text-xs",
          isLight ? "border-amber-200 bg-amber-50 text-amber-800" : "border-amber-500/30 bg-amber-500/10 text-amber-200",
        )}>
          Google Calendar uses your Gmail OAuth app credentials. Configure the Gmail OAuth Client ID and Secret in the Gmail Setup panel first.
        </div>
      )}

      {/* Connection status */}
      <div className={cn("mt-4 rounded-lg border p-3 home-spotlight-card home-border-glow", isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/20")}>
        <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>
          Connection
        </p>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-2 w-2 rounded-full shrink-0",
              gcal.connected ? "bg-emerald-400" : "bg-rose-400",
            )}
            aria-hidden="true"
          />
          <span className={cn("text-xs font-medium", isLight ? "text-s-90" : "text-slate-100")}>
            {gcal.connected ? `Connected as ${gcal.email || "Google Account"}` : "Not connected"}
          </span>
        </div>
      </div>

      {/* Accounts list */}
      {accounts.length > 0 && (
        <div className={cn("mt-3 rounded-lg border overflow-hidden", isLight ? "border-[#d5dce8]" : "border-white/10")}>
          <p className={cn("text-[11px] px-3 pt-2 pb-1 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>
            Linked Accounts
          </p>
          {accounts.map((account) => (
            <div
              key={account.id}
              className={cn(
                "home-spotlight-card home-border-glow grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-xs",
                "cursor-pointer",
                isLight
                  ? "bg-[#f4f7fd] text-s-70 border-b border-[#dfe5ef] last:border-b-0"
                  : "bg-black/20 text-slate-300 border-b border-white/8 last:border-b-0",
                selectedAccountId === account.id && "ring-inset ring-1 ring-accent/40",
              )}
              onClick={() => onSelectAccount(account.id)}
            >
              <div className="min-w-0">
                <p className={cn("font-medium truncate", isLight ? "text-s-90" : "text-slate-100")}>
                  {account.email}
                </p>
                {account.connectedAt && (
                  <p className={cn("text-[10px] mt-0.5", isLight ? "text-s-50" : "text-slate-500")}>
                    Connected {new Date(account.connectedAt).toLocaleDateString()}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    (account.enabled ?? true) ? "bg-emerald-400" : "bg-slate-500",
                  )}
                  aria-hidden="true"
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDisconnect(account.id)
                  }}
                  disabled={isSavingAny}
                  className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded border transition-colors disabled:opacity-50",
                    isLight
                      ? "border-rose-200 text-rose-500 hover:bg-rose-50"
                      : "border-rose-500/30 text-rose-300 hover:bg-rose-500/10",
                  )}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {gcal.connected && (
        <div className={cn("mt-3 rounded-lg border p-3", isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/20")}>
          <p className={cn("text-[11px] mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>
            Calendar Permissions
          </p>
          <div className="space-y-2">
            <div className={cn("flex items-center justify-between gap-3 rounded-lg border px-3 py-2", isLight ? "border-[#d5dce8] bg-white/70" : "border-white/10 bg-black/20")}>
              <div>
                <p className={cn("text-xs font-medium", isLight ? "text-s-90" : "text-slate-100")}>Add Events</p>
                <p className={cn("text-[11px]", isLight ? "text-s-60" : "text-slate-400")}>Allow Nova to create new calendar events.</p>
              </div>
              <NovaSwitch
                size="sm"
                checked={Boolean(gcal.permissions?.allowCreate)}
                disabled={isSavingAny || !canManageEvents}
                onChange={(checked) => onUpdatePermissions({ allowCreate: checked })}
              />
            </div>
            <div className={cn("flex items-center justify-between gap-3 rounded-lg border px-3 py-2", isLight ? "border-[#d5dce8] bg-white/70" : "border-white/10 bg-black/20")}>
              <div>
                <p className={cn("text-xs font-medium", isLight ? "text-s-90" : "text-slate-100")}>Edit Events</p>
                <p className={cn("text-[11px]", isLight ? "text-s-60" : "text-slate-400")}>Allow Nova to update time, title, or details.</p>
              </div>
              <NovaSwitch
                size="sm"
                checked={Boolean(gcal.permissions?.allowEdit)}
                disabled={isSavingAny || !canManageEvents}
                onChange={(checked) => onUpdatePermissions({ allowEdit: checked })}
              />
            </div>
            <div className={cn("flex items-center justify-between gap-3 rounded-lg border px-3 py-2", isLight ? "border-[#d5dce8] bg-white/70" : "border-white/10 bg-black/20")}>
              <div>
                <p className={cn("text-xs font-medium", isLight ? "text-s-90" : "text-slate-100")}>Delete Events</p>
                <p className={cn("text-[11px]", isLight ? "text-s-60" : "text-slate-400")}>Allow Nova to remove calendar events.</p>
              </div>
              <NovaSwitch
                size="sm"
                checked={Boolean(gcal.permissions?.allowDelete)}
                disabled={isSavingAny || !canManageEvents}
                onChange={(checked) => onUpdatePermissions({ allowDelete: checked })}
              />
            </div>
            <p className={cn("text-[11px]", isLight ? "text-s-60" : "text-slate-400")}>
              Nova can read event metadata for scheduling and cannot access Gmail message content from this connection.
            </p>
            {!canManageEvents && (
              <p className={cn("text-[11px]", isLight ? "text-amber-700" : "text-amber-300")}>
                This account is currently read-only. Reconnect Google Calendar to grant edit scopes.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Setup instructions */}
      <div className={cn("mt-3 rounded-lg border p-3", subPanelClass)}>
        <p className={cn("text-[11px] mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>
          How it works
        </p>
        <ol className={cn("text-xs space-y-1 list-decimal list-inside", isLight ? "text-s-70" : "text-slate-400")}>
          <li>Configure Gmail OAuth credentials in the Gmail Setup panel.</li>
          <li>Click <strong className={isLight ? "text-s-80" : "text-slate-200"}>Connect</strong> — uses the same Google app and requests calendar event management access.</li>
          <li>Approve calendar access in the Google consent screen.</li>
          <li>Nova will include your Google Calendar events on the calendar view.</li>
        </ol>
      </div>
    </section>
  )
}

