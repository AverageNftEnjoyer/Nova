"use client"

import { ExternalLink } from "lucide-react"

import { Badge, Button } from "@/components/ui"
import { SetupInstructions } from "../../../components/SetupInstructions"
import { DetailList, IntegrationDetail, Notice, SetupSection, ToggleRow } from "../../../components/setup-parts"
import { detailBase, formatTimestamp, type DetailProps } from "./shared"

export function PhantomDetail({ props }: { props: DetailProps }) {
  const { settings, isSavingTarget, phantomSetup } = props
  const busy = isSavingTarget !== null
  const connected = settings.phantom.connected
  const preferences = settings.phantom.preferences

  return (
    <IntegrationDetail
      {...detailBase(props, "phantom")}
      actions={
        connected ? (
          <Button variant="outline" onClick={() => void phantomSetup.disconnectPhantom()} disabled={busy}>
            Disconnect
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={() => void phantomSetup.refreshProviderState()} disabled={busy}>
              Detect again
            </Button>
            {phantomSetup.providerSupportedContext ? (
              <Button onClick={() => void phantomSetup.connectPhantom()} disabled={busy || !phantomSetup.providerInstalled}>
                Connect
              </Button>
            ) : (
              <Button onClick={() => void phantomSetup.openBrowserConnect()} disabled={busy}>
                <ExternalLink />
                Open in browser
              </Button>
            )}
          </>
        )
      }
      tabs={[
        {
          id: "setup",
          content: (
            <>
              {!phantomSetup.providerSupportedContext ? (
                <Notice tone="warning">
                  {phantomSetup.providerContextReason || "Phantom only connects from a top-level browser tab."} Click Open in browser to continue in your normal browser.
                </Notice>
              ) : !phantomSetup.providerInstalled ? (
                <Notice tone="warning">
                  Phantom is not detected in this browser. If it is installed, allow it on <code className="font-mono text-xs">localhost</code> from the extension menu and click Detect again.{" "}
                  <Button variant="link" size="sm" onClick={() => void phantomSetup.openPhantomInstall()}>
                    Install Phantom
                  </Button>
                </Notice>
              ) : !phantomSetup.providerReady && !connected ? (
                <Notice tone="info">Unlock Phantom and select a Solana account, then click Connect.</Notice>
              ) : null}
              <SetupSection
                title="Wallet"
                description="Connecting asks Phantom to sign a verification message. Nova keeps only the wallet address and your settings, never a seed phrase or private key."
                actions={connected ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Not verified</Badge>}
              >
                <DetailList
                  rows={[
                    { label: "Solana wallet", value: phantomSetup.walletLabel || "Not connected", mono: Boolean(phantomSetup.walletLabel) },
                    { label: "Signer", value: phantomSetup.providerReady ? "Ready" : "Locked or disconnected" },
                    { label: "EVM wallet", value: phantomSetup.evmLabel || "Not detected", mono: Boolean(phantomSetup.evmLabel) },
                    { label: "EVM chain", value: phantomSetup.evmChainId || "None", mono: Boolean(phantomSetup.evmChainId) },
                    { label: "Browser", value: phantomSetup.providerSupportedContext ? "Supported" : "Open in a browser tab" },
                    { label: "Extension", value: phantomSetup.providerInstalled ? "Detected" : "Not installed here" },
                    { label: "Trusted reconnect", value: phantomSetup.trustedReconnectReady ? "Ready" : "Waiting" },
                    { label: "Verified", value: formatTimestamp(phantomSetup.verifiedAt) },
                    { label: "Connected", value: formatTimestamp(phantomSetup.connectedAt) },
                    { label: "Last disconnected", value: formatTimestamp(phantomSetup.lastDisconnectedAt) },
                  ]}
                />
              </SetupSection>
            </>
          ),
        },
        {
          id: "settings",
          content: (
            <SetupSection title="What agents may use" description="Saved toggles apply to the agent runtime right away.">
              <div className="flex flex-col gap-3">
                <ToggleRow
                  label="Wallet context"
                  description="Agents and tools can read the verified Solana wallet label and address."
                  checked={Boolean(preferences.allowAgentWalletContext)}
                  onCheckedChange={(checked) => void phantomSetup.savePhantomPreferences({ allowAgentWalletContext: checked })}
                  disabled={busy}
                />
                <ToggleRow
                  label="EVM readiness context"
                  description="Agents can read Phantom's EVM address and chain as readiness metadata."
                  checked={Boolean(preferences.allowAgentEvmContext)}
                  onCheckedChange={(checked) => void phantomSetup.savePhantomPreferences({ allowAgentEvmContext: checked })}
                  disabled={busy}
                />
                <ToggleRow
                  label="Approval-gated Polymarket preparation"
                  description="Agents can prepare Polymarket actions that still need your explicit approval in Phantom."
                  checked={Boolean(preferences.allowApprovalGatedPolymarket)}
                  onCheckedChange={(checked) => void phantomSetup.savePhantomPreferences({ allowApprovalGatedPolymarket: checked })}
                  disabled={busy}
                />
              </div>
              {preferences.allowApprovalGatedPolymarket && !settings.phantom.capabilities.approvalGatedPolymarketReady ? (
                <Notice tone="info">Polymarket preparation is on and waits for a Phantom EVM address.</Notice>
              ) : null}
            </SetupSection>
          ),
        },
        {
          id: "instructions",
          content: (
            <>
              <SetupInstructions
                title="Connect Phantom from the desktop app"
                steps={[
                  <>In the desktop app, click Open in browser. Nova opens itself in your normal browser (Chrome when available).</>,
                  <>Install Phantom there if it is missing, unlock it and select the wallet to use.</>,
                  <>In that browser tab, click Connect and approve account access.</>,
                  <>Approve the signed verification message.</>,
                ]}
              />
              <SetupSection title="Limits">
                <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted">
                  <li>Phantom cannot trade on its own, export private keys or skip your approval.</li>
                  <li>This is wallet connect with a signed message, not OAuth.</li>
                </ul>
              </SetupSection>
            </>
          ),
        },
      ]}
    />
  )
}

export function PolymarketDetail({ props }: { props: DetailProps }) {
  const { settings, isSavingTarget, phantomSetup, polymarketSetup } = props
  const busy = isSavingTarget !== null
  const connected = settings.polymarket.connected

  return (
    <IntegrationDetail
      {...detailBase(props, "polymarket")}
      actions={
        <>
          <Button variant="outline" onClick={polymarketSetup.openPolymarketWorkspace}>
            Open Polymarket
          </Button>
          <Button
            variant={connected ? "outline" : "primary"}
            onClick={() => void (connected ? polymarketSetup.disconnectPolymarket() : polymarketSetup.connectPolymarket())}
            loading={isSavingTarget === "polymarket-connect" || isSavingTarget === "polymarket-disconnect"}
            disabled={busy}
          >
            {connected ? "Disconnect" : "Connect"}
          </Button>
        </>
      }
      tabs={[
        {
          id: "setup",
          content: (
            <>
              {!phantomSetup.evmLabel && !connected ? (
                <Notice tone="warning">Connect Phantom first. Polymarket binds to Phantom&apos;s EVM address.</Notice>
              ) : null}
              <SetupSection title="Wallet binding" description="Orders are always signed in Phantom. Nova does not hold keys.">
                <DetailList
                  rows={[
                    { label: "Phantom EVM wallet", value: phantomSetup.evmLabel || "Not detected", mono: Boolean(phantomSetup.evmLabel) },
                    { label: "Polymarket wallet", value: settings.polymarket.walletAddress || "Not connected", mono: Boolean(settings.polymarket.walletAddress) },
                    { label: "Profile address", value: settings.polymarket.profileAddress || "Not bound", mono: Boolean(settings.polymarket.profileAddress) },
                    { label: "Username", value: settings.polymarket.username || settings.polymarket.pseudonym || "None" },
                    { label: "Last connected", value: formatTimestamp(settings.polymarket.lastConnectedAt) },
                    { label: "Last profile sync", value: formatTimestamp(settings.polymarket.lastProfileSyncAt) },
                  ]}
                />
              </SetupSection>
            </>
          ),
        },
        {
          id: "settings",
          content: (
            <SetupSection title="Trading">
              <ToggleRow
                label="Live trading"
                description="Lets the Polymarket workspace submit wallet-approved orders. Connect first."
                checked={Boolean(settings.polymarket.liveTradingEnabled)}
                onCheckedChange={(checked) => void polymarketSetup.setLiveTradingEnabled(checked)}
                disabled={!connected || busy}
              />
            </SetupSection>
          ),
        },
        {
          id: "instructions",
          content: (
            <SetupInstructions
              title="Connect Polymarket"
              steps={[
                <>Connect Phantom first and check that an EVM wallet appears on its Setup tab.</>,
                <>Click Connect here to bind that wallet to Polymarket.</>,
                <>Turn on Live trading on the Settings tab only when you are ready to place orders.</>,
                <>Open Polymarket for market search, positions and trade tickets.</>,
              ]}
            />
          ),
        },
      ]}
    />
  )
}
