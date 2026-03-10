"use client"

import type { CSSProperties, FocusEvent as ReactFocusEvent, MouseEvent as ReactMouseEvent, RefObject } from "react"
import { RefreshCw, Settings } from "lucide-react"

import { cn } from "@/lib/shared/utils"
import type { HomeNewsArticle } from "../hooks/use-home-news-feed"

interface NewsFeedModuleProps {
  isLight: boolean
  panelClass: string
  subPanelClass: string
  panelStyle: CSSProperties | undefined
  sectionRef?: RefObject<HTMLElement | null>
  className?: string
  connected: boolean
  selectedTopics: string[]
  articles: HomeNewsArticle[]
  loading: boolean
  error: string | null
  stale: boolean
  fetchedAt: string
  onOpenIntegrations: () => void
  onOpenFilters: () => void
  onRefresh: () => void
}

function formatTagLabel(value: string): string {
  return String(value || "")
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .toUpperCase()
}

function hashTag(value: string): number {
  let hash = 0
  const input = String(value || "")
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0
  }
  return hash
}

function shouldRenderTag(value: string): boolean {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  if (!normalized) return false
  if (normalized.length < 2 || normalized.length > 24) return false
  if (
    /premium|subscriber|subscribers|professional|corporate|plans|subscribe|subscription|newsletter|sponsored|advertisement|only-available|available-only/.test(
      normalized,
    )
  ) {
    return false
  }
  return true
}

function tagToneClass(tag: string, isLight: boolean): string {
  const normalized = String(tag || "").toLowerCase()
  if (/alert|breaking|urgent|risk/.test(normalized)) {
    return isLight
      ? "border-rose-300/70 bg-rose-100 text-rose-700"
      : "border-rose-500/60 bg-rose-500/15 text-rose-200"
  }
  if (/conflict|war|tension|crisis|sanction/.test(normalized)) {
    return isLight
      ? "border-orange-300/70 bg-orange-100 text-orange-700"
      : "border-orange-500/60 bg-orange-500/15 text-orange-200"
  }
  if (/live|developing|fresh|now/.test(normalized)) {
    return isLight
      ? "border-emerald-300/70 bg-emerald-100 text-emerald-700"
      : "border-emerald-500/60 bg-emerald-500/15 text-emerald-200"
  }
  const lightPalette = [
    "border-sky-300/70 bg-sky-100 text-sky-700",
    "border-violet-300/70 bg-violet-100 text-violet-700",
    "border-teal-300/70 bg-teal-100 text-teal-700",
    "border-amber-300/70 bg-amber-100 text-amber-700",
    "border-fuchsia-300/70 bg-fuchsia-100 text-fuchsia-700",
  ]
  const darkPalette = [
    "border-sky-500/60 bg-sky-500/15 text-sky-200",
    "border-violet-500/60 bg-violet-500/15 text-violet-200",
    "border-teal-500/60 bg-teal-500/15 text-teal-200",
    "border-amber-500/60 bg-amber-500/15 text-amber-200",
    "border-fuchsia-500/60 bg-fuchsia-500/15 text-fuchsia-200",
  ]
  const palette = isLight ? lightPalette : darkPalette
  return palette[hashTag(normalized) % palette.length]
}

const GLOW_EDGE_GUARD_PCT = 5

function clampPercent(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return 50
  return Math.max(min, Math.min(max, value))
}

function updateArticleSpotlight(element: HTMLElement, clientX: number, clientY: number): void {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 1 || rect.height <= 1) return
  const relativeX = clampPercent(((clientX - rect.left) / rect.width) * 100, GLOW_EDGE_GUARD_PCT, 100 - GLOW_EDGE_GUARD_PCT)
  const relativeY = clampPercent(((clientY - rect.top) / rect.height) * 100, GLOW_EDGE_GUARD_PCT, 100 - GLOW_EDGE_GUARD_PCT)
  element.style.setProperty("--glow-x", `${relativeX}%`)
  element.style.setProperty("--glow-y", `${relativeY}%`)
  element.style.setProperty("--glow-intensity", "1")
  element.style.setProperty("--glow-radius", "120px")
}

function articleMatchesSelection(article: HomeNewsArticle, selectedTopics: string[]): boolean {
  if (selectedTopics.includes("all")) return true
  const selected = new Set(selectedTopics)
  if (selected.has(article.topic)) return true
  return article.tags.some((tag) => selected.has(tag))
}

const LOADING_PLACEHOLDER_ROWS = [0, 1, 2] as const

export function NewsFeedModule({
  isLight,
  panelClass,
  subPanelClass,
  panelStyle,
  sectionRef,
  className,
  connected,
  selectedTopics,
  articles,
  loading,
  error,
  onOpenIntegrations,
  onOpenFilters,
  onRefresh,
}: NewsFeedModuleProps) {
  const visibleArticles = articles.filter((article) => articleMatchesSelection(article, selectedTopics))

  const handleArticleMouseMove = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    updateArticleSpotlight(event.currentTarget, event.clientX, event.clientY)
  }

  const handleArticleMouseLeave = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    event.currentTarget.style.setProperty("--glow-intensity", "0")
  }

  const handleArticleFocus = (event: ReactFocusEvent<HTMLAnchorElement>) => {
    const element = event.currentTarget
    const rect = element.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    updateArticleSpotlight(element, centerX, centerY)
  }

  const handleArticleBlur = (event: ReactFocusEvent<HTMLAnchorElement>) => {
    event.currentTarget.style.setProperty("--glow-intensity", "0")
  }

  return (
    <section
      ref={sectionRef}
      style={panelStyle}
      className={cn(`${panelClass} home-spotlight-shell p-2.5 min-h-0 flex flex-col`, className)}
    >
      <div className="relative flex items-center justify-end gap-2">
        <h2
          className={cn(
            "pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-xs uppercase tracking-[0.22em] font-semibold",
            isLight ? "text-s-90" : "text-slate-200",
          )}
        >
          Live News
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenFilters}
            className={cn(
              "group/news-settings h-7 w-7 rounded-md border grid place-items-center transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover",
              subPanelClass,
            )}
            title="News category filters"
            aria-label="News category filters"
          >
            <Settings className="w-3.5 h-3.5 text-s-50 transition-transform duration-200 group-hover/news-settings:text-accent group-hover/news-settings:rotate-90" />
          </button>
          <button
            onClick={onRefresh}
            className={cn(
              "group/news-refresh h-7 w-7 rounded-md border grid place-items-center transition-colors home-spotlight-card home-border-glow",
              subPanelClass,
            )}
            title="Refresh news now"
            aria-label="Refresh news now"
          >
            <RefreshCw className="w-3.5 h-3.5 text-s-50 transition-transform duration-200 group-hover/news-refresh:text-accent group-hover/news-refresh:rotate-90" />
          </button>
          {!connected && (
            <button
              onClick={onOpenIntegrations}
              className={cn(
                "h-7 px-2 rounded-md border text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors home-spotlight-card home-border-glow",
                subPanelClass,
              )}
            >
              Connect
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto no-scrollbar space-y-1.5 pr-1">
        {!connected ? (
          <div className={cn("rounded-md border p-2 text-[11px] leading-4", subPanelClass)}>
            Connect News integration to enable hourly cached Home headlines.
          </div>
        ) : loading ? (
          <div className={cn("rounded-md border p-2.5", subPanelClass)}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className={cn("text-[10px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}>
                  Loading headlines
                </p>
                <p className={cn("mt-1 text-[11px] leading-4", isLight ? "text-s-80" : "text-slate-300")}>
                  Pulling fresh stories for your saved categories.
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {LOADING_PLACEHOLDER_ROWS.map((index) => (
                  <span
                    key={index}
                    className={cn(
                      "h-1.5 w-1.5 rounded-full animate-pulse",
                      isLight ? "bg-[#4d8dff]/80" : "bg-accent/80",
                    )}
                    style={{ animationDelay: `${index * 160}ms` }}
                  />
                ))}
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {LOADING_PLACEHOLDER_ROWS.map((index) => (
                <div key={`news-loading-${index}`} className={cn("rounded-md border p-2", subPanelClass)}>
                  <div
                    className={cn(
                      "h-2.5 rounded-full animate-pulse",
                      isLight ? "bg-[#d8e5fb]" : "bg-white/10",
                    )}
                    style={{ width: `${72 - (index * 11)}%`, animationDelay: `${index * 120}ms` }}
                  />
                  <div
                    className={cn(
                      "mt-2 h-2 rounded-full animate-pulse",
                      isLight ? "bg-[#e7eefb]" : "bg-white/8",
                    )}
                    style={{ width: `${88 - (index * 7)}%`, animationDelay: `${index * 120 + 80}ms` }}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : error ? (
          <div className={cn("rounded-md border p-2 text-[11px] leading-4 border-rose-300/40 bg-rose-500/10 text-rose-300")}>
            {error}
          </div>
        ) : visibleArticles.length === 0 ? (
          <div className={cn("rounded-md border p-2 text-[11px] leading-4", subPanelClass)}>
            No headlines match the saved categories for this user.
          </div>
        ) : (
          visibleArticles.slice(0, 6).map((article) => {
            const fallbackTopic = shouldRenderTag(article.topic) ? article.topic : ""
            const primaryTag = article.tags.find((tag) => shouldRenderTag(tag) && tag !== fallbackTopic)
            const displayTag = fallbackTopic || primaryTag

            return (
              <a
                key={article.id}
                href={article.url}
                target="_blank"
                rel="noreferrer noopener"
                onMouseMove={handleArticleMouseMove}
                onMouseLeave={handleArticleMouseLeave}
                onFocus={handleArticleFocus}
                onBlur={handleArticleBlur}
                className={cn(
                  "block rounded-md border p-2 transition-colors home-spotlight-card home-border-glow",
                  subPanelClass,
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("min-w-0 flex-1 truncate text-[10px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}>
                    {article.source}
                  </span>
                  {displayTag ? (
                    <span
                      className={cn(
                        "ml-auto shrink-0 rounded-sm border px-1 py-[1px] text-[8px] leading-none font-semibold uppercase tracking-[0.06em]",
                        tagToneClass(displayTag, isLight),
                      )}
                    >
                      {formatTagLabel(displayTag)}
                    </span>
                  ) : null}
                </div>
                <p className={cn("mt-1 text-[11px] font-medium leading-4 line-clamp-2", isLight ? "text-s-90" : "text-slate-100")}>
                  {article.title}
                </p>
              </a>
            )
          })
        )}
      </div>
    </section>
  )
}
