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
 * - V.32 Alpha: Spotify playback/device activation + home hydration stability polish
 *     - Hardened Spotify home playback handling for open-but-idle desktop app state by auto-activating an available device before retry.
 *     - Reduced Spotify boot/control noise by soft-failing expected device-unavailable and token-not-ready states.
 *     - Added launch warmup/cooldown guards to prevent repeated play/random spam while Spotify is initializing.
 *     - Stabilized Home module hydration to prevent schedule/orb flash-pop render artifacts on boot and page switches.
 *
 * - V.31 Alpha: Chat handler modularization + migration overhead cleanup + production safety fixes
 *     - Refactored runtime chat execution into focused modules (`execute-chat-request`, `prompt-context-builder`, `tool-loop-runner`, `direct-completion`, `response-refinement`, `prompt-fallbacks`) to reduce coupling and improve maintainability.
 *     - Added fast-lane context-enrichment skip path to reduce avoidable per-turn latency overhead on lightweight chat turns.
 *     - Fixed Claude streaming delta emission accounting to prevent rare missing final assistant-message delivery in HUD.
 *     - Added write-queue map cleanup in mission/notification persistence paths to prevent unbounded in-memory growth across many scoped files.
 *     - Removed repeated legacy fallback overhead by pruning empty legacy `missions` / `notification-runs` directories after migration and reducing legacy read fallbacks post-migration.
 *
* - V.30 Alpha: Calendar + Home overhaul with Google Calendar integration
 *     - Overhauled the Missions Calendar page UX and layout (week/day/month alignment, header behavior, mini-calendar interactions, and sidebar profile/settings module).
 *     - Overhauled Home page visual/system modules for a cleaner Nova OS presentation and improved workflow accessibility.
 *     - Added and hardened Google Calendar integration flow across integrations and calendar surfaces, including synced event rendering.
 *
 * - V.29 Alpha: Mission workflow reliability + builder/runtime alignment
 *     - Refined mission generation/build flow and mission graph validation to reduce invalid graph states before execution.
 *     - Hardened mission execution/output dispatch and executor paths for more deterministic run behavior.
 *     - Updated mission canvas/base-node UX flow to better align node editing, modal behavior, and run actions.
 *     - Extended mission versioning and check coverage around graph validation and build lifecycle paths.
 *
 * - V.28 Alpha: Gmail runtime hardening + 3D orb interaction/visual refinement
 *     - Added Gmail runtime tool suite in `src/` with safe-fail auth/scope handling, per-user context enforcement, and chat-loop integration.
 *     - Added sensitive Gmail action guardrails with explicit confirmation requirements and server-side HUD op-token consumption for send/draft paths.
 *     - Added Gmail runtime parsing compatibility for optional user-scoped integration config shape and isolation-focused tests.
 *     - Upgraded Home orb to 3D pipeline and refined animation behavior: no hover-coupled motion, richer speaking-state pulse dynamics.
 *     - Removed ring overlays and outer glow layers from the orb visual stack; kept particles as a separate non-clipping outer layer.
 *     - Locked orb/particle color rendering to the user-selected orb palette path (no hardcoded cyan/white fallback path in active orb rendering flow).
 *
 * - V.27 Alpha: Home visual polish + mission key stability fix
 *     - Scoped the orb-gradient title treatment so only the assistant name is gradient-rendered while "Hi, I'm" remains theme text.
 *     - Reworked space background planet variety toward a more realistic look (surface archetypes, subtler glow/motion, less repetitive crater treatment).
 *     - Added rare bottom-to-top launch rocket event with subtle spin for occasional cinematic motion.
 *     - Fixed duplicate React key warnings in mission template tags by making chip keys unique per template/tag/index.
 *
 * - V.26 Alpha: Mission builder workflow UX overhaul (frosted glass)
 *     - Reworked mission canvas visual system with tokenized React Flow theming and refined controls/minimap treatment.
 *     - Upgraded node palette and node config panel hierarchy to match workflow-editor ergonomics from reference design patterns.
 *     - Polished mission node cards, edge/grid styling, and top toolbar density while preserving drag/drop/connect/save/run behavior.
 *     - Added phased implementation tracker artifact: `tasks/mission-builder-ux-overhaul-phases-2026-02-23.md`.
 *
 * - V.25 Alpha: NovaChat pending resiliency + mission idempotency hardening
 *     - Hardened `/api/novachat/pending` polling against spam with single-flight fetch control, 429 recovery backoff+jitter, Retry-After compliance, and stale-request aborts.
 *     - Added cross-tab pending-poll lease coordination so one tab owns user+conversation scoped polling at a time.
 *     - Added durable mission-build idempotency storage (user-scoped locked store) to prevent duplicate mission creation under retries/spam.
 *     - Added end-to-end idempotency key propagation from chat/runtime and missions UI to mission-build API.
 *     - Added stable HUD processing/retrying status badge with countdown (`Retrying in Ns`) aligned to existing popup toast styling.
 *     - Added resilience smoke coverage for pending poll scope isolation, Retry-After parsing, backoff behavior, and mission idempotency lifecycle.
 *
 * - V.24 Alpha: Discord production hardening + personality PnL commentary
 *     - Hardened Discord delivery with strict webhook validation, redaction, retry/backoff+jitter, timeout handling, dedupe, concurrency caps, and per-user isolation safeguards.
 *     - Added Discord security controls: encrypted webhook storage at rest, masked client responses, and rate-limited integration probe endpoint.
 *     - Added Discord regression gate (`smoke:src-discord-delivery`) and wired it into release readiness checks.
 *     - Added personality-aware Coinbase PnL commentary for strong moves (>=10%) with user-scoped assistant tone/name behavior from settings context.
 *     - Applied anti-false-trigger and latency protections for PnL commentary (minimum notional/transactions, freshness guard, threshold buffer, persona cache).
 *     - Added deterministic fake-data PnL personality smoke coverage and scheduler-delivery assertion for notification payload inclusion.
 *
 * - V.23 Alpha: Coinbase integration completion 
 *     - Completed Coinbase phase gates across storage isolation, quality coverage, and rollout controls.
 *     - Finalized deterministic smoke coverage for Coinbase-enabled flows with strict user scoping.
 *     - Hardened production behavior for sync UX, telemetry diagnostics, and fallback quality safeguards.
 *     - Cleared release blockers for degraded fallback responses and latency gate compliance.
 *
 * - V.22 Alpha: ChatKit integration completion (phases 1-5) with live gate evidence
 *     - Added ChatKit foundation with deterministic config validation, feature flags, and user-scoped telemetry events.
 *     - Implemented shadow-mode evaluation and controlled low-risk serving with hard fallback to existing runtime flow.
 *     - Added structured multi-step workflow orchestration (`research -> summarize -> display`) bound to skill docs under `skills/`.
 *     - Added release-gate chain and runbook artifacts with PASS evidence report at `archive/logs/chatkit-phase5-gate-report.json`.
 *     - Validated full ChatKit smoke chain end-to-end with live gate mode enabled (`datasetMode: live`).
 *
 * - V.21 Alpha: Nova conversation intelligence and reliability upgrade
 *     - Upgraded Nova's multi-turn continuity so context, preference handling, and response intent stay stable across longer conversations.
 *     - Strengthened fast-path routing architecture to reduce false activations and improve first-pass answer accuracy.
 *     - Added production-grade conversation quality benchmarking (30-turn scripted eval) with score deltas for memory, safety, routing, readability, and latency.
 *     - Hardened handoff/state orchestration so message flow remains deterministic under real-time HUD interaction and rapid turn sequences.
 *
 * - V.20 Alpha: NLP spelling/autocorrect quality + override UX polish
 *     - Added gold-corpus NLP evaluation coverage and guardrail script wiring for regression tracking.
 *     - Improved preprocessing reliability across typo-heavy prompts with safer expectation matching and protected-span handling.
 *     - Added user-facing NLP edit hint UX for risky rewrites, including settings toggle and frosted-glass popup styling.
 *     - Added one-click resend protection for NLP suggestion actions to prevent rapid duplicate queue spam.
 *     - Updated NLP override button order/labels for clearer intent ("Use suggested" left, "Keep interpreted" right).
 *     - Removed initial streamed-text blur effect for cleaner, more polished response rendering.
 *
 * - V.19 Alpha: scalable request scheduling and queue orchestration
 *     - Added centralized HUD request scheduler with bounded queueing and explicit concurrency controls (global, per-user, per-conversation).
 *     - Added queued-request supersession by conversation so stale queued turns are canceled when newer turns arrive.
 *     - Added workload lanes (`fast`, `default`, `tool`, `background`) with weighted fair dispatch to protect interactive responsiveness.
 *     - Added scheduler metrics to system-metrics responses for live observability (queue depth, lane backlog, counters).
 *     - Updated gateway busy handling to track true in-flight HUD work safely under concurrent scheduling.
 *
 * - V.18 Alpha: runtime latency optimization pass (without capability loss)
 *     - Added safe fast-lane classification for trivial turns so optional heavy context layers are skipped when unnecessary.
 *     - Gated tool-loop orchestration by per-turn intent, preserving tools for tool-needed prompts while reducing overhead on simple chat.
 *     - Switched tool runtime initialization to lazy-on-demand so non-tool turns avoid upfront runtime setup cost.
 *     - Added memory-recall guardrails (intent gating + timeout) to prevent memory embedding work from delaying lightweight requests.
 *     - Parallelized optional enrichment tasks (web preload, link preload, memory recall) with bounded latency budgets.
 *     - Added session/transcript in-process caches with file-change invalidation to reduce sync disk churn while preserving session semantics.
 *     - Added persona/skills prompt caching and one-time legacy pruning to avoid repeated per-turn filesystem scans.
 *     - Coalesced HUD assistant stream deltas per animation frame to reduce render-state churn during streaming responses.
 *
 * - V.17 Alpha: mission generation + output engine generalization
 *     - Reworked mission topic detection to better parse mixed-intent prompts (including typo-tolerant motivational/news requests).
 *     - Improved fetch-query derivation from cleaned user intent instead of raw conversational scaffolding.
 *     - Upgraded AI mission prompt synthesis to be request-aware and dynamic across domains.
 *     - Replaced hardcoded mission output rewriting with a generic model-first normalizer.
 *     - Removed forced mission title/date wrapper from outputs by default (optional via `NOVA_MISSION_OUTPUT_INCLUDE_HEADER`).
 *     - Simplified mission quality fallback to narrative-first behavior so outputs read like NovaChat responses.
 *
 * - V.16 Alpha: dynamic weather response normalization and runtime resiliency
 *     - Reworked weather summarization to be location-agnostic and query-agnostic (supports "weather in X", "X weather", ZIP-based queries, and result-title fallback extraction).
 *     - Removed raw link/source dump behavior from weather fast-path output in favor of concise, human-readable recap lines.
 *     - Added dynamic temperature extraction (high/low/current) with unit inference from search snippets.
 *     - Hardened runtime tool-loop recovery when providers return tool calls without final text, with safe fallback reply generation.
 *     - Added websocket broadcast null-guard to avoid runtime crash when gateway state is unavailable.
 *
 * - V.15 Alpha:memory relevance/compression and security regression net completion
 *     - Improved memory recall compaction with query-aware salient sentence extraction and duplicate suppression under token pressure.
 *     - Added long-thread memory benchmark coverage to ensure critical facts survive noisy context.
 *     - Added security regression net smoke suite (`smoke:src-security-regression`) for durable guardrail verification.
 *     - Expanded `smoke:src-release` to include security, memory, routing arbitration, and plugin isolation gates.
 *     - Added phase-20 release notes artifact: `tasks/novaos-phase20-release-notes.md`.
 *
 * - V.14 Alpha: 10-phase hardening and release-readiness completion
 *     - Completed Phase 10 hardening with a production release gate (`smoke:src-release`) that runs build + eval + mission + scheduler + transport + tools + HUD build.
 *     - Added release-readiness smoke checks (`smoke:src-release-readiness`) covering script wiring, launcher stability, env documentation coverage, and release-note/version integrity.
 *     - Added final release notes artifact: `tasks/novaos-phase10-release-notes.md` with rollout checklist and rollback plan.
 *
 * - V.13 Alpha: `src/` runtime cutover + stability patch set
 *     - Standardized Nova runtime boot path to `nova.js` -> `src/runtime/core/entrypoint.js` (replacing legacy `agent/` launch flow).
 *     - Expanded `src/` runtime parity and smoke coverage for provider, session, transport, tools, memory, and shell wiring.
 *     - Removed stale `src/index.ts` one-off harness and cleaned upgrade module index references.
 *     - Fixed Home -> Chat first-send duplication by tightening pending message dedupe (message id + content checks).
 *     - Added STT auth fallback to user-scoped OpenAI integration when global key is missing (401 mitigation for voice loop).
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

export const NOVA_VERSION = "V.32 Alpha"
