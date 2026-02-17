/**
 * Nova HUD Version
 *
 * Update this constant whenever making significant changes.
 * All pages import from here for consistent versioning.
 *
 * Version format: V.XX Alpha (two-digit build counter).
 * Bump by +.01 on every shipped UI/runtime change.
 *
 * Version History:
 * - V.06 Alpha: Consolidated data cleanup, mission run-trace, and NovaChat UX stabilization
 *     - Added NovaChat as a mission output channel with server-side pending queue + cleanup
 *     - Mission outputs can create/open Nova conversations reliably from run-trace CTA
 *     - Added real-time per-step mission run-trace streaming with true started/ended timings
 *     - Fixed run-trace auth/401 stream issues by switching to fetch-based SSE parsing
 *     - Step timer now reflects actual execution duration; status icons update per-step live
 *     - Output step labels now correctly reflect selected channel (NovaChat vs Telegram)
 *     - Added response date stamp to mission outputs for clearer report context
 *     - Improved multi-fetch handling so all fetch steps accumulate into final AI context
 *     - Improved section fallback behavior to pull factual lines from fetched context when possible
 *     - Fixed spacing cleanup in rendered mission responses (less blank-line bloat)
 *     - Sources now map one unique source per web request/fetch step with hover link preview support
 *     - Removed top-left orb square/header glow in Missions + Integrations; orb-only highlight behavior
 *     - Reduced spotlight hover overhead (RAF throttling + lower particle churn) for smoother UI
 *     - Reduced integrations catalog refetch spam that caused repeated connection-refused console noise
 *     - Nova Suggest now fails gracefully when provider returns empty/no content
 * - V.05 Alpha: Multi-fetch fixes
 *     - Fixed multi-fetch execution: all fetch steps now run and accumulate results
 *     - Sources now display stacked (one per line) instead of inline
 *     - Better quote extraction: targets single clean quote with attribution
 * - V.04 Alpha: Output formatting improvements
 *     - Improved AI prompts with strict section formatting rules
 *     - Topic-specific report formatting (scores, market data, quotes)
 * - V.03 Alpha: Multi-topic mission architecture
 *     - Added topic detection for prompts (sports, markets, crypto, quotes, tech, news)
 *     - Missions now create separate fetch steps for each detected topic
 *     - Enhanced search queries with date-aware, site-filtered strategies
 *     - AI prompts generate structured multi-section summaries
 *     - New quick templates: Morning Multi-Topic Brief, Sports Recap, Market Update, Tech Digest
 *     - Fixed illegible text and poor summarization in mission outputs
 * - V.02 Alpha: Missions refactor (page split into hooks/components, behavior preserved)
 * - V.01 Alpha: Reset baseline versioning to Alpha track
 */

export const NOVA_VERSION = "V.06 Alpha"
