"use client"

import type { ReactNode } from "react"

import { Button } from "@/components/ui"
import { SecretInput } from "../../../components/SecretInput"
import { SetupInstructions } from "../../../components/SetupInstructions"
import { TextInput } from "../../../components/TextInput"
import { FormActions, IntegrationDetail, Notice, SetupSection } from "../../../components/setup-parts"
import { detailBase, type DetailProps } from "./shared"

/** Disconnect when on; turn on when a credential is saved but the integration is off. */
function ConnectionToggle({
  connected,
  canEnable,
  busy,
  onToggle,
}: {
  connected: boolean
  canEnable: boolean
  busy: boolean
  onToggle: () => Promise<void>
}): ReactNode {
  if (connected) {
    return (
      <Button variant="outline" onClick={() => void onToggle()} disabled={busy}>
        Disconnect
      </Button>
    )
  }
  if (!canEnable) return null
  return (
    <Button onClick={() => void onToggle()} disabled={busy}>
      Turn on
    </Button>
  )
}

export function TelegramDetail({ props }: { props: DetailProps }) {
  const { settings, isSavingTarget } = props
  const busy = isSavingTarget !== null
  return (
    <IntegrationDetail
      {...detailBase(props, "telegram")}
      actions={
        <ConnectionToggle
          connected={settings.telegram.connected}
          canEnable={props.botTokenConfigured}
          busy={busy}
          onToggle={props.toggleTelegram}
        />
      }
      tabs={[
        {
          id: "setup",
          content: (
            <SetupSection title="Bot and chats" description="Saving sends a test message to every chat ID and turns Telegram on when it arrives.">
              <SecretInput
                label="Bot token"
                value={props.botToken}
                onChange={props.setBotToken}
                placeholder="1234567890:AA..."
                maskedValue={props.botTokenMasked}
                isConfigured={props.botTokenConfigured}
                name="telegram_token_input"
              />
              <TextInput
                label="Chat IDs"
                value={props.chatIds}
                onChange={props.setChatIds}
                placeholder="123456789, -100987654321"
                hint="Separate several chats with commas."
              />
              <FormActions>
                <Button onClick={() => void props.saveTelegramConfig()} loading={isSavingTarget === "telegram"} disabled={busy && isSavingTarget !== "telegram"}>
                  Save and test
                </Button>
              </FormActions>
            </SetupSection>
          ),
        },
        {
          id: "instructions",
          content: (
            <>
              <SetupInstructions
                title="Create a bot token"
                steps={[
                  <>Open Telegram and message <code>@BotFather</code>.</>,
                  <>Send <code>/newbot</code> (or <code>/token</code> for a bot you already have).</>,
                  <>Copy the token into Bot token on the Setup tab.</>,
                ]}
              />
              <SetupInstructions
                title="Find your chat ID"
                steps={[
                  <>Open the chat with your bot, press Start and send any message.</>,
                  <>Open <code>https://api.telegram.org/bot&lt;token&gt;/getUpdates</code> in a browser.</>,
                  <>Copy <code>message.chat.id</code> into Chat IDs, then click Save and test.</>,
                ]}
              />
            </>
          ),
        },
      ]}
    />
  )
}

export function DiscordDetail({ props }: { props: DetailProps }) {
  const { settings, isSavingTarget } = props
  const busy = isSavingTarget !== null
  const hasWebhooks = Boolean(settings.discord.webhookUrlsConfigured) || props.discordWebhookUrls.trim().length > 0
  return (
    <IntegrationDetail
      {...detailBase(props, "discord")}
      actions={<ConnectionToggle connected={settings.discord.connected} canEnable={hasWebhooks} busy={busy} onToggle={props.toggleDiscord} />}
      tabs={[
        {
          id: "setup",
          content: (
            <SetupSection title="Webhooks" description="Saving posts a test message to each webhook and turns Discord on when they answer.">
              <TextInput
                label="Webhook URLs"
                value={props.discordWebhookUrls}
                onChange={props.setDiscordWebhookUrls}
                placeholder="https://discord.com/api/webhooks/..."
                hint="Separate several channels with commas."
              />
              {(settings.discord.webhookUrlsMasked?.length ?? 0) > 0 && props.discordWebhookUrls.trim().length === 0 ? (
                <p className="font-mono text-xs text-muted">Stored: {settings.discord.webhookUrlsMasked?.join(", ")}</p>
              ) : null}
              <FormActions>
                <Button onClick={() => void props.saveDiscordConfig()} loading={isSavingTarget === "discord"} disabled={busy && isSavingTarget !== "discord"}>
                  Save and test
                </Button>
              </FormActions>
            </SetupSection>
          ),
        },
        {
          id: "instructions",
          content: (
            <SetupInstructions
              title="Create a Discord webhook"
              steps={[
                <>Open your server settings, then Integrations and Webhooks.</>,
                <>Create or pick a webhook for the channel and copy its URL.</>,
                <>Paste one or more URLs into Webhook URLs on the Setup tab, then click Save and test.</>,
              ]}
            />
          ),
        },
      ]}
    />
  )
}

export function SlackDetail({ props }: { props: DetailProps }) {
  const { settings, isSavingTarget } = props
  const busy = isSavingTarget !== null
  return (
    <IntegrationDetail
      {...detailBase(props, "slack")}
      actions={<ConnectionToggle connected={Boolean(settings.slack?.connected)} canEnable={props.slackWebhookUrlConfigured} busy={busy} onToggle={props.toggleSlack} />}
      tabs={[
        {
          id: "setup",
          content: (
            <SetupSection title="Incoming webhook" description="Saving posts a test message to the channel and turns Slack on when it arrives.">
              <SecretInput
                label="Webhook URL"
                value={props.slackWebhookUrl}
                onChange={props.setSlackWebhookUrl}
                placeholder="https://hooks.slack.com/services/T.../B.../..."
                maskedValue={props.slackWebhookUrlMasked}
                isConfigured={props.slackWebhookUrlConfigured}
                name="slack_webhook_input"
              />
              <FormActions>
                <Button onClick={() => void props.saveSlackConfig()} loading={isSavingTarget === "slack"} disabled={busy && isSavingTarget !== "slack"}>
                  Save and test
                </Button>
              </FormActions>
            </SetupSection>
          ),
        },
        {
          id: "instructions",
          content: (
            <SetupInstructions
              title="Create a Slack incoming webhook"
              steps={[
                <>Go to <code>api.slack.com/apps</code> and create or pick an app.</>,
                <>Under Incoming Webhooks, turn them on and add a webhook for a channel.</>,
                <>Copy the webhook URL into Webhook URL on the Setup tab.</>,
                <>Click Save and test. Nova posts a test message to confirm the connection.</>,
              ]}
            />
          ),
        },
      ]}
    />
  )
}

export function BraveDetail({ props }: { props: DetailProps }) {
  const { settings, isSavingTarget } = props
  const busy = isSavingTarget !== null
  return (
    <IntegrationDetail
      {...detailBase(props, "brave")}
      actions={<ConnectionToggle connected={settings.brave.connected} canEnable={props.braveApiKeyConfigured} busy={busy} onToggle={props.toggleBrave} />}
      tabs={[
        {
          id: "setup",
          content: (
            <SetupSection title="API key" description="Used for web search and page fetches in chat and missions.">
              <SecretInput
                label="API key"
                value={props.braveApiKey}
                onChange={props.setBraveApiKey}
                placeholder="BSA..."
                maskedValue={props.braveApiKeyMasked}
                isConfigured={props.braveApiKeyConfigured}
                name="brave_api_key_input"
              />
              {props.braveApiKeyConfigured && !settings.brave.connected ? (
                <Notice tone="warning">The key is saved but Brave is off. Click Turn on so searches can use it.</Notice>
              ) : null}
              <FormActions>
                <Button onClick={() => void props.saveBraveConfig()} loading={isSavingTarget === "brave"} disabled={busy && isSavingTarget !== "brave"}>
                  Save
                </Button>
              </FormActions>
            </SetupSection>
          ),
        },
        {
          id: "instructions",
          content: (
            <>
              <SetupInstructions
                title="Create a Brave Search API key"
                steps={[
                  <>Sign in at <code>api.search.brave.com</code>.</>,
                  <>Create a key with a label you will recognise, such as <code>Nova desktop</code>.</>,
                  <>Copy the key right away and keep it private.</>,
                ]}
              />
              <SetupInstructions
                title="Save and check it"
                steps={[
                  <>Paste the key into API key on the Setup tab and click Save.</>,
                  <>Check that the field now shows Configured with a masked hint.</>,
                  <>Click Turn on, then run a chat or mission that searches the web.</>,
                  <>If you still see missing-key warnings, turn Brave off and on again after saving a fresh key. Rotate the key in Brave if it is ever exposed.</>,
                ]}
              />
            </>
          ),
        },
      ]}
    />
  )
}

export function NewsDetail({ props }: { props: DetailProps }) {
  const { settings, isSavingTarget } = props
  const busy = isSavingTarget !== null
  const saveButton = (
    <Button onClick={() => void props.saveNewsConfig()} loading={isSavingTarget === "news"} disabled={busy && isSavingTarget !== "news"}>
      Save
    </Button>
  )
  return (
    <IntegrationDetail
      {...detailBase(props, "news")}
      actions={<ConnectionToggle connected={settings.news.connected} canEnable={props.newsApiKeyConfigured} busy={busy} onToggle={props.toggleNews} />}
      tabs={[
        {
          id: "setup",
          content: (
            <SetupSection title="API key" description="Your news provider key. Nova only reads headlines with it.">
              <SecretInput
                label="API key"
                value={props.newsApiKey}
                onChange={props.setNewsApiKey}
                placeholder="news_live_..."
                maskedValue={props.newsApiKeyMasked}
                isConfigured={props.newsApiKeyConfigured}
                name="news_api_key_input"
              />
              {props.newsApiKeyConfigured && !settings.news.connected ? (
                <Notice tone="warning">The key is saved but News is off. Click Turn on to load headlines.</Notice>
              ) : null}
              <FormActions>{saveButton}</FormActions>
            </SetupSection>
          ),
        },
        {
          id: "settings",
          content: (
            <SetupSection title="Feed defaults" description="The Home feed refreshes every 10 minutes while it is on screen.">
              <TextInput
                label="Default topics"
                value={props.newsDefaultTopics}
                onChange={props.setNewsDefaultTopics}
                placeholder="world, business, technology"
                hint="Comma separated. These seed the topic chips on Home."
                mono={false}
              />
              <TextInput
                label="Preferred sources"
                value={props.newsPreferredSources}
                onChange={props.setNewsPreferredSources}
                placeholder="Reuters, Bloomberg, ABC News"
                hint="Also used to rank news videos in the YouTube feed."
                mono={false}
              />
              <FormActions>{saveButton}</FormActions>
            </SetupSection>
          ),
        },
        {
          id: "instructions",
          content: (
            <SetupInstructions
              title="Connect a news provider"
              steps={[
                <>Create an API key in your news provider dashboard.</>,
                <>Paste it into API key on the Setup tab and set default topics on the Settings tab.</>,
                <>Click Save, then Turn on.</>,
              ]}
            />
          ),
        },
      ]}
    />
  )
}
