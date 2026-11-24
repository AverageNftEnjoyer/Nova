"use client"

import { useRouter } from "next/navigation"

import { Button } from "@/components/ui"
import { buildIntegrationsHref } from "@/lib/integrations/navigation"
import { SpotifyNowPlaying } from "../../../components/live/spotify-now-playing"
import { YouTubeFeed } from "../../../components/live/youtube-feed"
import { SetupInstructions } from "../../../components/SetupInstructions"
import { TextInput } from "../../../components/TextInput"
import { DetailList, FormActions, IntegrationDetail, Notice, SetupSection, ToggleRow } from "../../../components/setup-parts"
import { useSpotifyPlayback } from "../../../hooks/use-spotify-playback"
import { detailBase, scopeList, type DetailProps } from "./shared"

function SpotifyLive({ props }: { props: DetailProps }) {
  const connected = props.settings.spotify.connected
  const playback = useSpotifyPlayback(connected)
  return (
    <SetupSection title="Now playing" description="Controls the active Spotify device. Nova can also do this from chat.">
      <div className="max-w-[32rem]">
        <SpotifyNowPlaying
          connected={connected}
          connecting={props.isSavingTarget === "spotify-oauth"}
          nowPlaying={playback.nowPlaying}
          error={playback.error}
          busyAction={playback.busyAction}
          onConnectSpotify={props.spotifySetup.connectSpotify}
          onOpenIntegrations={() => props.onTabChange("setup")}
          onTogglePlayPause={playback.togglePlayPause}
          onNext={playback.next}
          onPrevious={playback.previous}
          onPlaySmart={playback.playSmart}
          onSeek={playback.seek}
        />
      </div>
    </SetupSection>
  )
}

export function SpotifyDetail({ props }: { props: DetailProps }) {
  const { settings, isSavingTarget, spotifySetup } = props
  const busy = isSavingTarget !== null
  const connected = settings.spotify.connected
  const scopes = scopeList(spotifySetup.spotifyScopes)

  return (
    <IntegrationDetail
      {...detailBase(props, "spotify")}
      actions={
        connected ? (
          <>
            <Button variant="outline" onClick={() => void spotifySetup.testSpotifyConnection()} loading={isSavingTarget === "spotify-test"} disabled={busy}>
              Test connection
            </Button>
            <Button variant="outline" onClick={() => void spotifySetup.disconnectSpotify()} disabled={busy}>
              Disconnect
            </Button>
          </>
        ) : (
          <Button onClick={spotifySetup.connectSpotify} loading={isSavingTarget === "spotify-oauth"} disabled={busy || !spotifySetup.spotifyClientId.trim()}>
            Connect
          </Button>
        )
      }
      tabs={[
        {
          id: "setup",
          content: (
            <>
              <SetupSection title="Spotify app" description="Your own Spotify developer app. Save it before you connect.">
                <TextInput
                  label="Client ID"
                  value={spotifySetup.spotifyClientId}
                  onChange={spotifySetup.setSpotifyClientId}
                  placeholder="Spotify app client ID"
                />
                <TextInput
                  label="Redirect URI"
                  value={spotifySetup.spotifyRedirectUri}
                  onChange={spotifySetup.setSpotifyRedirectUri}
                  placeholder="http://localhost:3000/api/integrations/spotify/callback"
                  hint="Add this exact URI to the app's redirect URIs in the Spotify dashboard."
                />
                <FormActions hint={connected ? undefined : "After saving, click Connect and approve access in the popup."}>
                  <Button onClick={() => void spotifySetup.saveSpotifyConfig()} loading={isSavingTarget === "spotify-save"} disabled={busy && isSavingTarget !== "spotify-save"}>
                    Save
                  </Button>
                </FormActions>
              </SetupSection>
              <SetupSection title="Account">
                <DetailList
                  rows={[
                    { label: "Account", value: spotifySetup.spotifyDisplayName || "Not connected" },
                    { label: "User ID", value: spotifySetup.spotifyUserId || "None", mono: Boolean(spotifySetup.spotifyUserId) },
                    { label: "Token", value: settings.spotify.tokenConfigured ? "Stored" : "Missing" },
                    { label: "Scopes", value: scopes.length > 0 ? scopes.join(" ") : "None", mono: scopes.length > 0 },
                  ]}
                />
              </SetupSection>
            </>
          ),
        },
        { id: "live", content: <SpotifyLive props={props} /> },
        {
          id: "instructions",
          content: (
            <SetupInstructions
              title="Connect Spotify"
              steps={[
                <>
                  Open the{" "}
                  <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer noopener" className="text-accent-text underline underline-offset-2">
                    Spotify developer dashboard
                  </a>{" "}
                  and create an app.
                </>,
                <>Copy the app&apos;s Client ID into Client ID on the Setup tab.</>,
                <>In the app settings, add the Redirect URI shown on the Setup tab and save.</>,
                <>Click Save, then Connect and approve access in the popup.</>,
                <>Click Test connection to check the token and scopes.</>,
              ]}
            />
          ),
        },
      ]}
    />
  )
}

export function YouTubeDetail({ props }: { props: DetailProps }) {
  const router = useRouter()
  const { settings, isSavingTarget, youtubeSetup } = props
  const busy = isSavingTarget !== null
  const connected = settings.youtube.connected
  const scopes = scopeList(settings.youtube.scopes, youtubeSetup.youtubeScopes)
  const hasReadScope = scopes.some((scope) => /\/auth\/youtube(\.readonly)?$/i.test(scope))
  const gmailHasCredentials =
    Boolean(settings.gmail.oauthClientId?.trim()) &&
    (Boolean(settings.gmail.oauthClientSecretConfigured) || Boolean(settings.gmail.oauthClientSecret?.trim()))
  const permissionsDisabled = busy || !hasReadScope

  return (
    <IntegrationDetail
      {...detailBase(props, "youtube")}
      actions={
        connected ? (
          <>
            <Button variant="outline" onClick={() => void youtubeSetup.testYouTubeConnection()} loading={isSavingTarget === "youtube-test"} disabled={busy}>
              Test connection
            </Button>
            <Button variant="outline" onClick={() => void youtubeSetup.disconnectYouTube()} disabled={busy}>
              Disconnect
            </Button>
          </>
        ) : (
          <Button onClick={youtubeSetup.connectYouTube} loading={isSavingTarget === "youtube-oauth"} disabled={busy || !gmailHasCredentials}>
            Connect
          </Button>
        )
      }
      tabs={[
        {
          id: "setup",
          content: (
            <>
              {!gmailHasCredentials ? (
                <Notice tone="warning">
                  YouTube uses your Gmail OAuth app. Add the Gmail client ID and secret first.{" "}
                  <Button variant="link" size="sm" onClick={() => router.replace(buildIntegrationsHref("gmail"), { scroll: false })}>
                    Open Gmail setup
                  </Button>
                </Notice>
              ) : null}
              <SetupSection title="Account" description="Connect signs in with Google and asks for read access to YouTube.">
                <DetailList
                  rows={[
                    { label: "Channel", value: youtubeSetup.youtubeChannelTitle || (connected ? "Connected" : "Not connected") },
                    { label: "Channel ID", value: youtubeSetup.youtubeChannelId || "None", mono: Boolean(youtubeSetup.youtubeChannelId) },
                    { label: "Token", value: settings.youtube.tokenConfigured ? "Stored" : "Missing" },
                    { label: "Scopes", value: scopes.length > 0 ? scopes.join(" ") : "None", mono: scopes.length > 0 },
                  ]}
                />
              </SetupSection>
            </>
          ),
        },
        {
          id: "settings",
          content: (
            <SetupSection title="Permissions" description="What Nova may do with YouTube for you. Home playback is always muted.">
              {connected && !hasReadScope ? <Notice tone="warning">This account is missing YouTube read access. Disconnect and connect again to grant it.</Notice> : null}
              {!connected ? <Notice tone="info">Connect YouTube to change these.</Notice> : null}
              <div className="flex flex-col gap-3">
                <ToggleRow
                  label="Feed"
                  description="Load a personalised or source-ranked feed."
                  checked={Boolean(youtubeSetup.youtubePermissions.allowFeed)}
                  onCheckedChange={(checked) => void youtubeSetup.updateYouTubePermissions({ allowFeed: checked })}
                  disabled={permissionsDisabled}
                />
                <ToggleRow
                  label="Search"
                  description="Search videos and channels."
                  checked={Boolean(youtubeSetup.youtubePermissions.allowSearch)}
                  onCheckedChange={(checked) => void youtubeSetup.updateYouTubePermissions({ allowSearch: checked })}
                  disabled={permissionsDisabled}
                />
                <ToggleRow
                  label="Video details"
                  description="Read duration, views and channel details."
                  checked={Boolean(youtubeSetup.youtubePermissions.allowVideoDetails)}
                  onCheckedChange={(checked) => void youtubeSetup.updateYouTubePermissions({ allowVideoDetails: checked })}
                  disabled={permissionsDisabled}
                />
              </div>
            </SetupSection>
          ),
        },
        {
          id: "live",
          content: (
            <SetupSection title="Player" description="Ask Nova in chat what to watch and the video plays here and on Home.">
              <div className="max-w-[40rem]">
                <YouTubeFeed connected={connected} onOpenIntegrations={() => props.onTabChange("setup")} />
              </div>
            </SetupSection>
          ),
        },
        {
          id: "instructions",
          content: (
            <SetupInstructions
              title="Connect YouTube"
              steps={[
                <>Add your Google OAuth client ID and secret in Gmail setup.</>,
                <>Click Connect and approve YouTube read access.</>,
                <>Choose what Nova may do on the Settings tab.</>,
              ]}
            />
          ),
        },
      ]}
    />
  )
}
