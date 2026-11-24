"use client"

import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"

import { Badge, Button, EmptyState } from "@/components/ui"
import { buildIntegrationsHref } from "@/lib/integrations/navigation"
import { SecretInput } from "../../../components/SecretInput"
import { SetupInstructions } from "../../../components/SetupInstructions"
import { TextInput } from "../../../components/TextInput"
import { FormActions, IntegrationDetail, Notice, SetupSection, ToggleRow } from "../../../components/setup-parts"
import { detailBase, scopeList, type DetailProps } from "./shared"

function gmailCredentialsSaved(props: DetailProps): boolean {
  const gmail = props.settings.gmail
  return Boolean(gmail.oauthClientId?.trim()) && (Boolean(gmail.oauthClientSecretConfigured) || Boolean(gmail.oauthClientSecret?.trim()))
}

export function GmailDetail({ props }: { props: DetailProps }) {
  const { settings, isSavingTarget, gmailSetup } = props
  const busy = isSavingTarget !== null
  const accounts = settings.gmail.accounts
  const hasCredentials = gmailCredentialsSaved(props)

  return (
    <IntegrationDetail
      {...detailBase(props, "gmail")}
      actions={
        settings.gmail.connected ? (
          <Button variant="outline" onClick={() => gmailSetup.disconnectGmail()} disabled={busy}>
            Disconnect all
          </Button>
        ) : (
          <Button onClick={gmailSetup.connectGmail} disabled={busy || !hasCredentials}>
            Connect
          </Button>
        )
      }
      tabs={[
        {
          id: "setup",
          content: (
            <>
              <SetupSection
                title="Google OAuth app"
                description="Your own Google Cloud OAuth client. Google Calendar and YouTube use it too."
              >
                <TextInput
                  label="Client ID"
                  value={gmailSetup.gmailClientId}
                  onChange={gmailSetup.setGmailClientId}
                  placeholder="123456789012-abc.apps.googleusercontent.com"
                />
                <SecretInput
                  label="Client secret"
                  value={gmailSetup.gmailClientSecret}
                  onChange={gmailSetup.setGmailClientSecret}
                  placeholder="GOCSPX-..."
                  maskedValue={gmailSetup.gmailClientSecretMasked}
                  isConfigured={gmailSetup.gmailClientSecretConfigured}
                  name="gmail_client_secret_input"
                />
                <TextInput
                  label="Redirect URI"
                  value={gmailSetup.gmailRedirectUri}
                  onChange={gmailSetup.setGmailRedirectUri}
                  placeholder="http://localhost:3000/api/integrations/gmail/callback"
                  hint="Must match an authorised redirect URI of the OAuth client exactly."
                />
                <FormActions hint={hasCredentials ? undefined : "Save the client ID and secret, then click Connect."}>
                  <Button onClick={gmailSetup.saveGmailConfig} loading={isSavingTarget === "gmail-oauth"} disabled={busy && isSavingTarget !== "gmail-oauth"}>
                    Save
                  </Button>
                </FormActions>
              </SetupSection>
              <SetupSection
                title="Accounts"
                description="Nova reads and sends mail from the primary account unless a chat or mission names another."
                actions={
                  <Button variant="outline" size="sm" onClick={gmailSetup.connectGmail} disabled={busy || !hasCredentials}>
                    <Plus />
                    Link account
                  </Button>
                }
              >
                {accounts.length === 0 ? (
                  <EmptyState
                    size="compact"
                    title="No Gmail accounts linked"
                    description={hasCredentials ? "Click Link account and sign in with Google." : "Save your OAuth app above, then link an account."}
                  />
                ) : (
                  <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border">
                    {accounts.map((account) => {
                      const enabled = account.enabled !== false
                      return (
                        <li key={account.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                          <span className="min-w-0 flex-1 truncate text-sm text-fg">{account.email}</span>
                          {account.active ? <Badge tone="accent">Primary</Badge> : null}
                          {!enabled ? <Badge>Off</Badge> : null}
                          <div className="flex items-center gap-1">
                            {!account.active ? (
                              <Button variant="ghost" size="sm" onClick={() => gmailSetup.setPrimaryGmailAccount(account.id)} disabled={busy}>
                                Make primary
                              </Button>
                            ) : null}
                            <Button variant="ghost" size="sm" onClick={() => gmailSetup.updateGmailAccountState("set_enabled", account.id, !enabled)} disabled={busy}>
                              {enabled ? "Turn off" : "Turn on"}
                            </Button>
                            <Button variant="ghost" size="sm" className="text-danger" onClick={() => gmailSetup.updateGmailAccountState("delete", account.id)} disabled={busy}>
                              Remove
                            </Button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </SetupSection>
            </>
          ),
        },
        {
          id: "instructions",
          content: (
            <SetupInstructions
              title="Create a Google OAuth client"
              steps={[
                <>In Google Cloud, create or pick a project and enable the Gmail API.</>,
                <>Open the OAuth consent screen, choose External and fill in the app details.</>,
                <>Add the Gmail scopes (start with <code>gmail.readonly</code>).</>,
                <>While the app is in Testing mode, add your Gmail addresses as test users.</>,
                <>Create an OAuth client ID of type Web application and copy its ID and secret into the Setup tab.</>,
                <>Add the Redirect URI from the Setup tab to the client, click Save, then Connect.</>,
                <>Connect again to link more accounts and pick the primary one.</>,
              ]}
            />
          ),
        },
      ]}
    />
  )
}

export function CalendarDetail({ props }: { props: DetailProps }) {
  const router = useRouter()
  const { settings, isSavingTarget, gmailCalendarSetup } = props
  const busy = isSavingTarget !== null
  const calendar = settings.gcalendar
  const accounts = calendar.accounts ?? []
  const hasCredentials = gmailCredentialsSaved(props)
  const scopes = scopeList(calendar.scopes, accounts.flatMap((account) => (Array.isArray(account.scopes) ? account.scopes : []))).map((scope) => scope.toLowerCase())
  const canManageEvents = scopes.includes("https://www.googleapis.com/auth/calendar.events") || scopes.includes("https://www.googleapis.com/auth/calendar")
  const permissionsDisabled = busy || !canManageEvents

  return (
    <IntegrationDetail
      {...detailBase(props, "gmail-calendar")}
      actions={
        calendar.connected ? (
          <Button variant="outline" onClick={() => gmailCalendarSetup.disconnectGmailCalendar()} disabled={busy}>
            Disconnect all
          </Button>
        ) : (
          <Button onClick={gmailCalendarSetup.connectGmailCalendar} disabled={busy || !hasCredentials}>
            Connect
          </Button>
        )
      }
      tabs={[
        {
          id: "setup",
          content: (
            <>
              {!hasCredentials ? (
                <Notice tone="warning">
                  Google Calendar uses your Gmail OAuth app. Add the Gmail client ID and secret first.{" "}
                  <Button variant="link" size="sm" onClick={() => router.replace(buildIntegrationsHref("gmail"), { scroll: false })}>
                    Open Gmail setup
                  </Button>
                </Notice>
              ) : null}
              <SetupSection
                title="Accounts"
                description="Events from these accounts show on the mission calendar. This connection cannot read email."
                actions={
                  calendar.connected ? (
                    <Button variant="outline" size="sm" onClick={gmailCalendarSetup.connectGmailCalendar} disabled={busy || !hasCredentials}>
                      <Plus />
                      Link account
                    </Button>
                  ) : null
                }
              >
                {accounts.length === 0 ? (
                  <EmptyState
                    size="compact"
                    title="No calendars linked"
                    description={hasCredentials ? "Click Connect and approve calendar access." : "Set up the Gmail OAuth app first."}
                  />
                ) : (
                  <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border">
                    {accounts.map((account) => (
                      <li key={account.id} className="flex items-center gap-3 px-3 py-2">
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm text-fg">{account.email}</span>
                          {account.connectedAt ? (
                            <span className="text-xs text-muted">Connected {new Date(account.connectedAt).toLocaleDateString()}</span>
                          ) : null}
                        </div>
                        {account.active ? <Badge tone="accent">Primary</Badge> : null}
                        {account.enabled === false ? <Badge>Off</Badge> : null}
                        <Button variant="ghost" size="sm" className="text-danger" onClick={() => gmailCalendarSetup.disconnectGmailCalendar(account.id)} disabled={busy}>
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </SetupSection>
            </>
          ),
        },
        {
          id: "settings",
          content: (
            <SetupSection title="What Nova may change" description="Nova can always read event times and titles for scheduling.">
              {calendar.connected && !canManageEvents ? (
                <Notice tone="warning">This account is read-only. Disconnect and connect again to grant event access.</Notice>
              ) : null}
              {!calendar.connected ? <Notice tone="info">Connect Google Calendar to change these.</Notice> : null}
              <div className="flex flex-col gap-3">
                <ToggleRow
                  label="Add events"
                  description="Create new calendar events."
                  checked={Boolean(calendar.permissions?.allowCreate)}
                  onCheckedChange={(checked) => void gmailCalendarSetup.updateCalendarPermissions({ allowCreate: checked })}
                  disabled={permissionsDisabled}
                />
                <ToggleRow
                  label="Edit events"
                  description="Change the time, title or details of events."
                  checked={Boolean(calendar.permissions?.allowEdit)}
                  onCheckedChange={(checked) => void gmailCalendarSetup.updateCalendarPermissions({ allowEdit: checked })}
                  disabled={permissionsDisabled}
                />
                <ToggleRow
                  label="Delete events"
                  description="Remove calendar events."
                  checked={Boolean(calendar.permissions?.allowDelete)}
                  onCheckedChange={(checked) => void gmailCalendarSetup.updateCalendarPermissions({ allowDelete: checked })}
                  disabled={permissionsDisabled}
                />
              </div>
            </SetupSection>
          ),
        },
        {
          id: "instructions",
          content: (
            <SetupInstructions
              title="Connect Google Calendar"
              steps={[
                <>Set up the Google OAuth app in Gmail setup.</>,
                <>Click Connect. It uses the same Google app and asks for calendar event access.</>,
                <>Approve calendar access on the Google consent screen.</>,
                <>Your events appear on the mission calendar.</>,
              ]}
            />
          ),
        },
      ]}
    />
  )
}
