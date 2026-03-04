import type { IntegrationsStoreScope } from "../../store/server-store"

export const GOOGLE_OAUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth"
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
export const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"

export const DEFAULT_YOUTUBE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/youtube.readonly",
]

export type YouTubeErrorCode =
  | "youtube.invalid_request"
  | "youtube.invalid_state"
  | "youtube.unauthorized"
  | "youtube.forbidden"
  | "youtube.not_found"
  | "youtube.rate_limited"
  | "youtube.quota_exceeded"
  | "youtube.token_missing"
  | "youtube.not_connected"
  | "youtube.timeout"
  | "youtube.cancelled"
  | "youtube.network"
  | "youtube.transient"
  | "youtube.internal"

export type YouTubeScope = IntegrationsStoreScope

export interface YouTubeClientConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  appUrl: string
}

export interface YouTubeOAuthStatePayload {
  ts: number
  nonce: string
  userId: string
  returnTo: string
}

export interface YouTubeTokenRefreshResult {
  accessToken: string
  refreshToken: string
  expiresIn: number
  scopes: string[]
}

export type YouTubeSearchType = "video" | "channel"

export interface YouTubeSearchItem {
  id: string
  kind: YouTubeSearchType
  title: string
  description: string
  channelId: string
  channelTitle: string
  publishedAt: string
  thumbnailUrl: string
}

export interface YouTubeSearchResult {
  items: YouTubeSearchItem[]
  nextPageToken: string
  prevPageToken: string
}

export interface YouTubeVideoDetails {
  id: string
  title: string
  description: string
  channelId: string
  channelTitle: string
  publishedAt: string
  thumbnailUrl: string
  durationIso: string
  durationSeconds: number
  viewCount: number
  likeCount: number
}

export interface YouTubeFeedItem {
  videoId: string
  title: string
  channelId: string
  channelTitle: string
  publishedAt: string
  thumbnailUrl: string
  description: string
  score: number
  reason: string
}

export type YouTubeFeedMode = "personalized" | "sources"

export interface YouTubeFeedOptions {
  mode: YouTubeFeedMode
  topic: string
  pageToken?: string
  maxResults?: number
  preferredSources?: string[]
  historyChannelIds?: string[]
}

export interface YouTubeFeedResult {
  items: YouTubeFeedItem[]
  nextPageToken: string
  prevPageToken: string
  mode: YouTubeFeedMode
  topic: string
  sourceSummary: string[]
}
