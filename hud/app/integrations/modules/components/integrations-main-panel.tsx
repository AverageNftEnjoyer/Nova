"use client"

import type { IntegrationsMainPanelProps } from "../types"
import { CoinbaseDetail } from "./details/coinbase-detail"
import { CalendarDetail, GmailDetail } from "./details/google-details"
import { LlmDetail } from "./details/llm-detail"
import { SpotifyDetail, YouTubeDetail } from "./details/media-details"
import { BraveDetail, DiscordDetail, NewsDetail, SlackDetail, TelegramDetail } from "./details/messaging-details"
import { PhantomDetail, PolymarketDetail } from "./details/wallet-details"

/** The detail of the integration selected on /integrations. */
export function IntegrationsMainPanel(props: IntegrationsMainPanelProps) {
  if (props.providerDefinition) return <LlmDetail props={props} definition={props.providerDefinition} />
  switch (props.activeSetup) {
    case "telegram":
      return <TelegramDetail props={props} />
    case "discord":
      return <DiscordDetail props={props} />
    case "slack":
      return <SlackDetail props={props} />
    case "brave":
      return <BraveDetail props={props} />
    case "news":
      return <NewsDetail props={props} />
    case "coinbase":
      return <CoinbaseDetail props={props} />
    case "phantom":
      return <PhantomDetail props={props} />
    case "polymarket":
      return <PolymarketDetail props={props} />
    case "spotify":
      return <SpotifyDetail props={props} />
    case "youtube":
      return <YouTubeDetail props={props} />
    case "gmail":
      return <GmailDetail props={props} />
    case "gmail-calendar":
      return <CalendarDetail props={props} />
    default:
      return null
  }
}
