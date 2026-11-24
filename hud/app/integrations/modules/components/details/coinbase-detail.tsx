"use client"

import { Button, Field, Select, Stat, StatGroup } from "@/components/ui"
import { CryptoPrices } from "../../../components/live/crypto-prices"
import { SecretInput } from "../../../components/SecretInput"
import { SetupInstructions } from "../../../components/SetupInstructions"
import { FormActions, IntegrationDetail, Notice, SetupSection, ToggleRow } from "../../../components/setup-parts"
import { useCryptoMarket } from "../../../hooks/use-crypto-market"
import { COINBASE_CADENCE_OPTIONS, COINBASE_CURRENCY_OPTIONS, COINBASE_TIMEZONE_OPTIONS } from "../../coinbase/meta"
import { detailBase, type DetailProps } from "./shared"

function withCurrent(options: Array<{ value: string; label: string }>, value: string) {
  return value && !options.some((option) => option.value === value) ? [...options, { value, label: value }] : options
}

function CoinbaseLive() {
  const market = useCryptoMarket()
  return (
    <SetupSection title="Prices" description="Spot prices from Coinbase, refreshed every minute while this tab is open.">
      <CryptoPrices
        assets={market.cryptoAssets}
        range={market.cryptoRange}
        onRangeChange={market.setCryptoRange}
        loading={market.cryptoLoading}
        error={market.cryptoError}
        onRetry={() => void market.refreshCryptoMarket()}
      />
    </SetupSection>
  )
}

export function CoinbaseDetail({ props }: { props: DetailProps }) {
  const { settings, isSavingTarget, coinbasePendingAction, coinbasePrivacy, coinbasePrivacyHydrated, coinbasePrivacySaving } = props
  const busy = isSavingTarget !== null || coinbasePendingAction !== null
  const privacyDisabled = !coinbasePrivacyHydrated || coinbasePrivacySaving
  const connected = settings.coinbase.connected

  return (
    <IntegrationDetail
      {...detailBase(props, "coinbase")}
      actions={
        <>
          <Button
            variant="outline"
            onClick={() => void props.probeCoinbaseConnection("Coinbase connection works.")}
            loading={coinbasePendingAction === "sync"}
            disabled={busy || !props.coinbaseHasKeys}
          >
            Test connection
          </Button>
          <Button
            variant={connected ? "outline" : "primary"}
            onClick={() => void props.toggleCoinbase()}
            loading={coinbasePendingAction === "toggle"}
            disabled={busy || (!connected && !props.coinbaseHasKeys)}
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
              <StatGroup>
                <Stat size="sm" label="Sync" value={props.coinbaseSyncLabel} />
                <Stat size="sm" label="Last sync" value={props.coinbaseLastSyncText} />
                <Stat size="sm" label="Freshness" value={props.coinbaseFreshnessText} />
              </StatGroup>
              {settings.coinbase.lastSyncStatus === "error" && props.coinbaseErrorText ? (
                <Notice tone="danger">{props.coinbaseErrorText}</Notice>
              ) : null}
              <SetupSection
                title="API key pair"
                description="A read-only Coinbase Developer Platform key. Nova stores both values encrypted and shows only masked hints."
              >
                <SecretInput
                  label="Secret API key"
                  value={props.coinbaseApiKey}
                  onChange={props.setCoinbaseApiKey}
                  placeholder="organizations/{org_id}/apiKeys/{key_id}"
                  maskedValue={props.coinbaseApiKeyMasked}
                  isConfigured={props.coinbaseApiKeyConfigured}
                  name="coinbase_api_key_input"
                  hint="The key value, usually organizations/.../apiKeys/..., not its nickname."
                />
                <SecretInput
                  label="Private key"
                  value={props.coinbaseApiSecret}
                  onChange={props.setCoinbaseApiSecret}
                  placeholder={"-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----"}
                  maskedValue={props.coinbaseApiSecretMasked}
                  isConfigured={props.coinbaseApiSecretConfigured}
                  name="coinbase_api_secret_input"
                  multiline
                  hint="Paste it exactly as downloaded, line breaks included. Nova does not use the extra passphrase field."
                />
                <FormActions hint={`Required scopes: ${props.coinbaseScopeSummary}`}>
                  <Button onClick={() => void props.saveCoinbaseConfig()} loading={coinbasePendingAction === "save"} disabled={busy && coinbasePendingAction !== "save"}>
                    Save
                  </Button>
                </FormActions>
              </SetupSection>
            </>
          ),
        },
        {
          id: "settings",
          content: (
            <>
              <SetupSection
                title="Privacy"
                description="What Nova may read and show from your account. Changes apply right away."
                actions={coinbasePrivacySaving ? <span className="text-xs text-muted">Saving...</span> : null}
              >
                <div className="flex flex-col gap-3">
                  <ToggleRow
                    label="Require consent for transaction history"
                    description="Block transaction-level reads until consent is granted below."
                    checked={coinbasePrivacy.requireTransactionConsent}
                    onCheckedChange={(checked) => void props.updateCoinbasePrivacy({ requireTransactionConsent: checked })}
                    disabled={privacyDisabled}
                  />
                  <ToggleRow
                    label="Transaction history consent"
                    description="Lets Nova read transaction history for reports such as weekly PnL."
                    checked={coinbasePrivacy.transactionHistoryConsentGranted}
                    onCheckedChange={(checked) => void props.updateCoinbasePrivacy({ transactionHistoryConsentGranted: checked })}
                    disabled={privacyDisabled}
                  />
                  <ToggleRow
                    label="Show balances"
                    description="When off, portfolio amounts are redacted in generated reports."
                    checked={coinbasePrivacy.showBalances}
                    onCheckedChange={(checked) => void props.updateCoinbasePrivacy({ showBalances: checked })}
                    disabled={privacyDisabled}
                  />
                  <ToggleRow
                    label="Show transactions"
                    description="When off, transaction amounts and prices are redacted in generated reports."
                    checked={coinbasePrivacy.showTransactions}
                    onCheckedChange={(checked) => void props.updateCoinbasePrivacy({ showTransactions: checked })}
                    disabled={privacyDisabled}
                  />
                </div>
                {coinbasePrivacy.requireTransactionConsent && !coinbasePrivacy.transactionHistoryConsentGranted ? (
                  <Notice tone="warning">Weekly PnL and transaction history stay blocked until you grant consent.</Notice>
                ) : null}
                {props.coinbasePrivacyError ? <Notice tone="danger">{props.coinbasePrivacyError}</Notice> : null}
              </SetupSection>
              <SetupSection title="Report defaults" description="Used by portfolio reports and automations. Saved with the Coinbase configuration.">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Timezone">
                    <Select
                      value={settings.coinbase.reportTimezone}
                      onValueChange={(value) => props.updateCoinbaseDefaults({ reportTimezone: value || "UTC" })}
                      options={withCurrent(COINBASE_TIMEZONE_OPTIONS, settings.coinbase.reportTimezone)}
                    />
                  </Field>
                  <Field label="Currency">
                    <Select
                      value={settings.coinbase.reportCurrency}
                      onValueChange={(value) => props.updateCoinbaseDefaults({ reportCurrency: (value || "USD").toUpperCase() })}
                      options={withCurrent(COINBASE_CURRENCY_OPTIONS, settings.coinbase.reportCurrency)}
                    />
                  </Field>
                  <Field label="Cadence">
                    <Select
                      value={settings.coinbase.reportCadence}
                      onValueChange={(value) => props.updateCoinbaseDefaults({ reportCadence: value === "weekly" ? "weekly" : "daily" })}
                      options={COINBASE_CADENCE_OPTIONS}
                    />
                  </Field>
                </div>
                <FormActions>
                  <Button variant="secondary" onClick={() => void props.saveCoinbaseConfig()} loading={coinbasePendingAction === "save"} disabled={busy && coinbasePendingAction !== "save"}>
                    Save defaults
                  </Button>
                </FormActions>
              </SetupSection>
            </>
          ),
        },
        { id: "live", content: <CoinbaseLive /> },
        {
          id: "instructions",
          content: (
            <>
              <SetupInstructions
                title="Create Coinbase API credentials"
                steps={[
                  <>
                    Open the{" "}
                    <a href="https://portal.cdp.coinbase.com/access/api" target="_blank" rel="noreferrer noopener" className="text-accent-text underline underline-offset-2">
                      Coinbase Developer Platform
                    </a>{" "}
                    and create an API key (Advanced Trade / Coinbase App).
                  </>,
                  <>Under Advanced settings choose <code>ECDSA</code>.</>,
                  <>Set permissions to read-only (Portfolio view). Leave Trade and Transfer off.</>,
                  <>If you use an IP allowlist, include this computer&apos;s IPv4 and IPv6 addresses, or calls will fail.</>,
                  <>Copy the API key and the private key right away. Ignore any extra passphrase value.</>,
                ]}
              />
              <SetupInstructions
                title="Save and connect"
                steps={[
                  <>Paste the key into Secret API key and the private key into Private key on the Setup tab.</>,
                  <>Click Save and check that both fields show Configured.</>,
                  <>Click Connect, then Test connection to run a live sync.</>,
                ]}
              />
            </>
          ),
        },
      ]}
    />
  )
}
