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
 *
 * - V.12 Alpha: Runtime skill routing efficiency and continuity upgrades
 *     - Added starter operational skills: `pickup` and `handoff` for fast context rehydration and deterministic task transfer.
 *     - Runtime skill discovery now parses optional `metadata.read_when` hints and includes them in prompt-time skill selection.
 *     - Added short-lived runtime cache for discovered skills to reduce repeated per-turn filesystem scans.
 *     - Skills API now supports optional frontmatter key `metadata` (with `read_when`) and returns hint metadata in skill summaries.
 *     - Starter skill seeding now uses catalog versioning so newly added starter skills propagate safely to existing users.
 *
 * - V.11 Alpha: User-facing Skills manager and starter template rollout
 *     - Added Settings -> Skills editor for creating and updating user `SKILL.md` files directly.
 *     - Added validated skill API flow (list/read/create/save) with enforced frontmatter and verification sections.
 *     - Added starter skill templates (`nova-core`, `research`, `summarize`, `daily-briefing`) with one-click install.
 *     - Runtime now discovers both workspace and per-user skills for prompt-time skill selection.
 *
 * - V.10 Alpha: Global background persistence and hydration stabilization
 *     - Added app-level persistent background layer to prevent custom video flash/reset on route changes.
 *     - Fixed hydration mismatch by deferring background layer rendering until client mount.
 *     - Removed duplicate page-level background state/effects from home, missions, and chat flows.
 *
 * - V.09 Alpha: Analytics baseline module and nav integration
 *     - Added new /analytics route with modular analytics architecture.
 *     - Implemented frosted-glass analytics modules, spotlight effects, and D3 charts.
 *     - Added rotating settings wheel with module visibility controls and persistence.
 *     - Wired Analytics entry points into Home and Chat right-rail module controls.
 *     - Updated sidebar hub labeling to recognize Analytics Hub context.
 *
 * - V.08 Alpha: Chat refactor and Brave integration
 *     - Refactored chat-shell-controller from 1688 lines to 616 lines.
 *     - Extracted logic into reusable hooks: useConversations, useIntegrationsStatus,
 *       useMissions, useChatBackground.
 *     - Removed dead code: nova-chat-module.tsx, redundant chat-shell.tsx wrapper.
 *     - Added Brave API integration across all pages (home, chat, integrations).
 *     - Brave API key stored encrypted, user-configured via Integrations UI.
 *
 * - V.07 Alpha: Chat workspace responsiveness and shell/header overhaul
 *     - Reworked chat shell into responsive 3-column desktop layout:
 *       Sidebar -> Chat -> Mission/Integrations.
 *     - Added central chat header with animated orb, live status, and version badge.
 *     - Restored orb animation/hover behavior with live presence indicator.
 *     - Removed container styling around Nova responses for cleaner module blending.
 * 
 * - V.06 Alpha: Consolidated data cleanup, mission run-trace, and NovaChat UX stabilization
 *     - Added NovaChat mission output channel with pending-queue handling and cleanup.
 *     - Mission outputs can reliably create/open Nova conversations from run-trace CTA.
 *     - Added per-step real-time run-trace streaming with true start/end timings.
 *     - Fixed run-trace auth/401 stream issues using fetch-based SSE parsing.
 *     - Step timer reflects real execution duration; step icons update live.
 * 
 * - V.05 Alpha: Multi-fetch fixes
 *     - Fixed multi-fetch execution so all fetch steps run and accumulate results.
 *     - Sources display stacked (one per line) instead of inline.
 *     - Improved quote extraction for one clean quote with attribution.
 * 
 * - V.04 Alpha: Output formatting improvements
 *     - Improved AI prompts with strict section formatting rules.
 *     - Added topic-specific report formatting for scores, markets, and quotes.
 * 
 * - V.03 Alpha: Multi-topic mission architecture
 *     - Added prompt topic detection: sports, markets, crypto, quotes, tech, news.
 *     - Missions create separate fetch steps per detected topic.
 *     - Enhanced search queries with date-aware and site-filtered strategies.
 *     - AI prompts now generate structured multi-section summaries.
 *     - Added templates: Morning Multi-Topic Brief, Sports Recap,
 *       Market Update, Tech Digest.
 *     - Fixed illegible text and weak summarization in mission outputs.
 * 
 * - V.02 Alpha: Missions refactor (page split into hooks/components, behavior preserved)
 * 
 * - V.01 Alpha: Reset baseline versioning to Alpha track
 */

export const NOVA_VERSION = "V.13 Alpha"
