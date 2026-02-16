# USER Template

<!--
This file is loaded into every conversation. The AI will use this info
to personalize responses. Only include what you're comfortable with.
Everything here stays local on your machine.
-->

## Basic Info

- Name: [[Your Name]]
- Location: [[City, Country]]
- Language preference: [English]
- Timezone: [[e.g., America/New_York]]
- Preferred units: [[metric | imperial]]
- Date format: [[YYYY-MM-DD | MM/DD/YYYY]]

## Work & Projects

- Role: [[e.g., Full-stack developer at a startup]]
- Team context: [[solo | small team | enterprise org]]
- Current projects:
  - [[Project A: short description, current phase, target date]]
  - [[Project B: short description, current phase, target date]]
  - [[Project C: short description, current phase, target date]]
- Tech stack:
  - Languages: [[TypeScript, Python, Go, etc.]]
  - Frameworks: [[Next.js, React, FastAPI, etc.]]
  - Infra: [[AWS, GCP, Docker, Kubernetes, etc.]]
  - Data: [[Postgres, Redis, Supabase, etc.]]
- Work hours: [[Local start time - end time]]
- Focus windows: [[Times to avoid interruptions]]

## Preferences

- Communication style: [[direct and concise, skip fluff]]
- When I say "fix it": [[edit files directly and verify]]
- When I ask for code:
  - Language default: [[TypeScript | Python | etc.]]
  - Style preference: [[functional | OOP | mixed]]
  - Type strictness: [[strict | practical]]
  - Testing expectation: [[unit tests always | only when requested]]
- When I ask for research:
  - Depth: [[quick scan | thorough]]
  - Output: [[sources + summary, no wall of text]]
  - Source bias: [[official docs first]]
- Decision style: [[give recommendation first, then tradeoffs]]
- Pet peeves:
  - [[Don't re-explain basics already known]]
  - [[Don't over-caveat obvious points]]
  - [[Don't suggest tools outside current stack unless asked]]

## Context

Things to always remember:
- [[Health/diet constraints if relevant]]
- [[Family/personal context you want respected]]
- [[Product, startup, or long-term initiative name]]
- [[Deadlines, launch windows, or recurring commitments]]

Accounts and services:
- GitHub: [[@username]]
- Cloud: [[AWS | GCP | Azure]]
- CI/CD: [[GitHub Actions | CircleCI | etc.]]
- Monitoring: [[Datadog | Grafana | etc.]]
- Project management: [[Linear | Jira | Notion | Trello]]
- Messaging stack: [[Slack | Discord | Email]]

## Collaboration Defaults

- Preferred update cadence during multi-step work: [[every step | major milestones only]]
- Risk tolerance for autonomous changes: [[low | medium | high]]
- Confirmation threshold for destructive actions: [[always ask]]
- Preferred fallback behavior when blocked: [[make best assumption and continue]]
- Review mode default: [[strict bug/risk review first | balanced]]

## Environment Snapshot

- Primary OS: [[Windows | macOS | Linux]]
- Preferred terminal: [[PowerShell | bash | zsh]]
- Package manager defaults: [[pnpm | npm | yarn]]
- Runtime versions to assume: [[Node v22+]], [[python3]]
- Common local paths:
  - Repos root: [[path]]
  - Scratch/output directory: [[path]]

## Guardrails for Personalization

- Never infer sensitive personal details beyond what's written here.
- If context appears stale, ask once whether to update this file.
- For recurring preferences, suggest adding them to MEMORY.md.

## Customization Notes

- Keep high-signal facts near the top.
- Delete placeholder lines you don't need.
- Revisit monthly and trim stale context.
