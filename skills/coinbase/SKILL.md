---
description: Deterministic Coinbase command skill for price, portfolio, transactions, reports, and status routing.
read_when: ["coinbase", "crypto", "price btc", "portfolio", "my crypto report", "weekly pnl"]
---

# Coinbase Command Skill

Use this skill when a user asks for Coinbase crypto data in chat.

## Command Aliases

- `price btc` -> live spot lookup (`coinbase_spot_price`)
- `portfolio` -> account balance snapshot (`coinbase_portfolio_snapshot`)
- `my crypto report` -> portfolio report summary (`coinbase_portfolio_report`)
- `weekly pnl` -> weekly PnL report summary (`coinbase_portfolio_report`)

## Normalization Rules

- Normalize common typo forms before intent parse, for example:
  - `portfolo` -> `portfolio`
  - `cryto` -> `crypto`
  - `wekly pnl` -> `weekly pnl`
- If a ticker is ambiguous, ask a clarification question before tool execution.

## Admin Command Categories

Runtime supports admin gating by category:

- `price`
- `portfolio`
- `transactions`
- `reports`
- `status`

Environment controls:

- `NOVA_COINBASE_COMMAND_CATEGORIES` (comma-separated allowlist)
- `NOVA_COINBASE_DISABLED_COMMAND_CATEGORIES` (comma-separated denylist)

If a category is disabled, return a clear policy message and do not call Coinbase tools.

## Safety and Scope

- Always require and propagate `userContextId`.
- Never mix one user's Coinbase state with another user.
- Return explicit safe-failure guidance when tool execution or auth fails.
