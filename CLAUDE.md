# CLAUDE.md - NovaAIO

## Project Overview

NovaAIO is a local-first desktop AI agent orchestration platform. Fully local, open-source, user-owned data.

## CRITICAL RULES

**🚨 NEVER COMMIT CODE** - Only user commits. Build, test, prepare - leave unstaged.

**API Integration** - Read official docs first. Never guess formats or parameters.

## Tech Stack

- **Frontend Framework**: Next.js 16 (App Router)
- **UI**: React 19, TypeScript, Tailwind CSS 4
- **Desktop**: Electron 44 (packaging for .exe distribution)
- **Storage**: Local filesystem + localStorage (no database)
- **State Management**: React hooks, WebSocket for real-time updates
- **Agent Orchestration**: In-memory task queue, filesystem persistence
- **Integrations**: Local-only configs stored in `.nova-data/` directory

## Build & Run Commands

```bash
# Development (web only)
cd hud
npm run dev

# Development (Electron desktop)
cd hud
npm run electron:dev

# Production build
cd hud
npm run build

# Build Windows executable
cd hud
npm run electron:build:win

# Smoke tests
cd hud
npm run test:smoke
```

## Directory Structure

```
hud/                    # Next.js frontend
  app/                  # Routes (home, chat, missions, integrations, agents)
    api/                # API routes (tasks, missions, integrations)
  components/           # React components (agents, chat, settings, ui)
  lib/                  # Libraries (agents, integrations, missions, settings)
  electron/             # Electron (main.js, preload.js)
  tests/smoke/          # Playwright tests
src/                    # Backend runtime
.nova-data/             # Local user data (gitignored)
.user/                  # User context files
```

## Key Configuration Files

- `hud/package.json` - Dependencies, scripts, Electron config
- `hud/electron-builder.yml` - Electron build configuration
- `hud/tsconfig.json` - TypeScript configuration
- `hud/tailwind.config.ts` - Tailwind CSS configuration
- `hud/playwright.config.ts` - Smoke test configuration
- `.gitignore` - Excludes `.nova-data/`, test results, builds

## Storage Locations

- `.user/user-context/{userId}/` - Per-user files (agent-tasks, home-notes, etc.)
- `.nova-data/integrations-{userId}.json` - Encrypted integration configs (API keys)
- `~/.nova-encryption-key` - Master encryption key (machine-specific, persistent)
- `localStorage` - User settings, preferences, orb color

## Security (API Keys & Secrets)

**Encryption**: AES-256-GCM with PBKDF2 key derivation (100k iterations)

**Master Key**: Auto-generated on first run, stored in `~/.nova-encryption-key` (600 permissions)

**Format**: `salt:iv:tag:ciphertext` (all base64)

**Storage**: All API keys encrypted before writing to `.nova-data/` files

**Persistence**: Keys survive app updates (stored in user home directory, not app directory)

## Code Conventions

**Files**: `kebab-case.tsx`, hooks: `use-{name}.ts`, API routes: `route.ts`

**TypeScript**: Strict mode, no `any`, interfaces for objects, types for unions

**Next.js 16**: Must `await params` in dynamic routes `const { id } = await params`

**Styling**: Tailwind CSS 4, `cn()` for conditionals, responsive `lg:` `xl:` `2xl:`

## Key Architecture

**Agent Tasks**: Max 5 concurrent, priority queue, cost tracking, file-based persistence

**Storage**: Local files (`.user/`, `.nova-data/`), encrypted secrets, no database

**Missions**: DAG workflow engine, ReactFlow canvas, job ledger scheduler

**Electron**: Window mgmt (min 1024x768), system tray, deep linking (nova://)

## Development Guidelines

**Before changes**: Read files, check patterns, verify types, test locally

**When adding features**: Types first → API → UI → tests → leave unstaged

**Responsive**: Min 1024x768, target 1920x1080, support 4K

**Error handling**: Proper status codes, user-friendly messages, log for debugging

## Version Management

Format: `V.XX Alpha (YYYY-MM-DD)` in `lib/meta/version/index.ts`

Current: **V.63 Alpha**

## Philosophy

This codebase will outlive you. Every shortcut becomes someone else's burden. Every hack compounds into technical debt that slows the whole team down.

You are not just writing code. You are shaping the future of this project. The patterns you establish will be copied. The corners you cut will be cut again.

Fight entropy. Leave the codebase better than you found it.

**Remember: Build, test, prepare. User commits. Always.**
