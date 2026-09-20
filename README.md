<p align="center">
  <img src="hud/public/images/nova.svg" alt="NovaAIO" width="120" height="120">
</p>

<h1 align="center">NovaAIO</h1>

<p align="center">
  <strong>A local-first AI agent desktop app: chat, voice, automations, and agent tasks in one place.</strong>
</p>

<p align="center">
  <!-- TODO: swap in a real hero screenshot or a short GIF of the home screen -->
  <img src="docs/screenshots/hero.png" alt="NovaAIO home screen" width="900">
</p>

<p align="center">
  Windows desktop app &nbsp;·&nbsp; Electron + Next.js 16 + React 19 &nbsp;·&nbsp; Node.js agent runtime &nbsp;·&nbsp; TypeScript
</p>

---

## Overview

NovaAIO is a personal AI assistant that runs on your own machine. You talk to it by text or voice, and it can do real work: read your email, check your calendar, search the web, run scheduled automations, track crypto and prediction markets, and run long agent tasks in the background.

I built it to answer a simple question: what does an AI assistant look like when it isn't a chat box in a browser tab, but a proper desktop application with tools, memory, a scheduler, and guardrails? Everything is stored locally. API keys are encrypted at rest, and no account or hosted backend is required.

**Status:** Alpha (V.62). Actively developed and used daily by the author.

---

## Screenshots

<!-- TODO: add screenshots to docs/screenshots/ using the file names below -->

| Home | Chat |
| :---: | :---: |
| <img src="docs/screenshots/home.png" alt="Home dashboard" width="440"> | <img src="docs/screenshots/chat.png" alt="Chat with tool use" width="440"> |
| Configurable dashboard with weather, schedule, notes, agent tasks, and live modules | Streaming chat with tool calls and approvals |

| Missions | Agent Tasks |
| :---: | :---: |
| <img src="docs/screenshots/missions-canvas.png" alt="Mission workflow canvas" width="440"> | <img src="docs/screenshots/agent-tasks.png" alt="Agent tasks module" width="440"> |
| Visual workflow builder for scheduled automations | Run, pause, and stop background agent tasks with cost tracking |

| Integrations | Voice |
| :---: | :---: |
| <img src="docs/screenshots/integrations.png" alt="Integrations page" width="440"> | <img src="docs/screenshots/voice-orb.png" alt="Voice mode" width="440"> |
| Connect Gmail, Calendar, Telegram, Discord, Spotify, and more | Wake-word activation and spoken replies |

---

## What It Can Do

### Conversational assistant
- Streaming chat with tool use, conversation history, and per-user context isolation.
- Works with **OpenAI, Anthropic (Claude), Gemini, and Grok**. Provider fallback and routing preference (balanced, latency, cost, quality) are configurable.
- Persona files (`SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`) let you shape how the assistant talks and what it knows about you.

### Voice
- Wake-word activation. The wake word follows whatever name you give the assistant.
- Text-to-speech through Fish Audio with switchable voices.

### Missions (automation workflows)
- A visual canvas built on React Flow with 30+ node types across triggers, data, AI, logic, transforms, and outputs.
- Missions run as a dependency graph with parallel branches.
- A job ledger with idempotency keys and retry handling keeps scheduled runs from double-firing or getting lost.
- Deliver results to Telegram, Discord, Slack, or email.

### Agent Tasks
- Queue background tasks against Claude, OpenAI, Gemini, or Grok.
- Play, pause, stop, and delete controls. Up to 5 tasks run at once.
- Priority levels, permission modes (default, accept-edits, plan-mode, don't-ask, bypass), and live token and cost tracking per task.

### Memory
- Hybrid retrieval that combines keyword and embedding search.
- Query expansion, MMR re-ranking to cut near-duplicate results, and temporal decay so recent memories rank higher.
- Markdown-backed, so you can read and edit what the assistant remembers.

### Integrations
| Category | Services |
| --- | --- |
| Communication | Gmail, Telegram, Discord, Slack |
| Productivity | Google Calendar, Spotify, YouTube |
| Markets | Coinbase, Polymarket |
| Research | Brave web search, page fetch and summarize |
| Voice | Fish Audio TTS |

### Skills
Skills are plain `SKILL.md` files the assistant discovers at startup. Included: daily briefing, research, summarize, weather, Spotify, Coinbase, day-in-history, session logs, healthcheck, and handoff/pickup for continuing work across sessions. Adding one means adding a folder and a markdown file.

---

## Architecture

NovaAIO runs as two cooperating processes, started together by a single launcher (`nova.js`), and packaged as a desktop app with Electron.

```
┌──────────────────────────┐        WebSocket         ┌──────────────────────────┐
│  HUD  (Next.js / React)  │ ◄──────────────────────► │  Agent Runtime (Node.js) │
│  localhost:3000          │      localhost:8765      │                          │
│                          │                          │  chat handler + routing  │
│  chat · home · missions  │                          │  tool loop + policies    │
│  agents · integrations   │                          │  memory · skills         │
│  Electron shell          │                          │  voice loop · scheduler  │
└──────────────────────────┘                          └──────────────────────────┘
             │                                                       │
             └──────────────► local storage (.nova-data, SQLite) ◄───┘
```

| Path | What lives there |
| --- | --- |
| `hud/` | Next.js app (App Router), React components, API routes, Electron shell |
| `src/runtime/` | Agent runtime: chat handler, request scheduler, voice and wake-word loops |
| `src/tools/` | Tool system, split into `core/` (policy, registry, executor), `builtin/`, and `web/` |
| `src/memory/` | Embeddings, hybrid search, chunking, MMR, temporal decay |
| `src/providers/` | LLM provider clients and runtime |
| `src/skills/` + `skills/` | Skill discovery and the bundled skills |
| `hud/lib/missions/` | Mission types, DAG executor, job ledger, scheduler |
| `scripts/smoke/` | Smoke and regression tests, grouped by area |

### Engineering decisions worth calling out

- **Bounded tool loops.** Every chat and agent tool loop has limits on step count, total duration, per-call timeout, and calls per step, all configurable. A runaway model can't spin forever.
- **Capability and risk policies.** Tools are gated by policy before they execute, and higher-risk actions can require approval from the HUD.
- **Network safety.** Web fetch goes through an SSRF guard that blocks requests to private and internal addresses.
- **Secrets handling.** Stored API keys are encrypted at rest. OAuth flows use signed state, comparisons are timing-safe, and API routes are rate limited per user and per IP.
- **Per-user isolation.** Runtime state, memory, and sessions are scoped by user, and there are tests that check the boundaries.
- **Reliable scheduling.** Missions are enqueued with idempotency keys and claimed with leases, so the scheduler can restart without duplicating runs.

---

## Tech Stack

| Layer | Tools |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS, Radix UI, React Flow, D3, GSAP, Three.js / React Three Fiber |
| Desktop | Electron, electron-builder (Windows NSIS installer) |
| Runtime | Node.js 20+, WebSockets, Vercel AI SDK |
| Storage | Local filesystem, SQLite (`better-sqlite3`), encrypted config |
| Validation | Zod |
| Testing | Playwright, custom Node smoke suites, `tsc` and ESLint |

---

## Getting Started

### Prerequisites
- Windows 10 or 11 (the launcher and installer target Windows)
- Node.js 20 or newer
- An API key for at least one LLM provider (OpenAI or Anthropic to start)

### Install

```bash
git clone https://github.com/AverageNftEnjoyer/Nova.git
cd Nova

npm install
npm run install:all      # installs the HUD dependencies
```

### Configure

```bash
copy .env.example .env
```

At minimum, set an LLM key and an encryption key:

```bash
# generate a 32-byte encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

```env
OPENAI_API_KEY=...        # and/or ANTHROPIC_API_KEY
NOVA_ENCRYPTION_KEY=...   # output from the command above
```

Integrations (Gmail, Telegram, Discord, Spotify, and so on) are optional and can be set up from the in-app Integrations page.

### Run

```bash
npm run dev      # development: launches the agent runtime and the HUD together
npm start        # production build of the HUD
```

Then open `http://localhost:3000`.

### Build the desktop app

```bash
cd hud
npm run electron:build:win
```

The installer is written to `hud/dist/`.

---

## Testing

The project leans on smoke tests that exercise real code paths instead of mocks.

```bash
npm run typecheck    # agent + HUD type checks
npm run lint         # ESLint for agent and HUD
npm test             # build + Node test suite
npm run smoke        # runtime smoke test
npm run smoke:audit  # audit and regression smokes
```

There are more than 130 targeted smoke scripts under `scripts/smoke/`, covering tool-loop guardrails, per-user isolation, routing, scheduler stability, the job ledger, and each integration domain. Browser-level checks live in `hud/tests/smoke/` and run with Playwright (`npm --prefix hud run test:smoke`).

---
