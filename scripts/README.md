# Scripts Organization

This folder contains executable project scripts grouped by domain and purpose.

## Structure rules

- Use `scripts/<domain>/` when the domain has ongoing ownership and multiple script types.
- Keep general cross-domain scripts in shared folders (for example `scripts/smoke/`).
- Inside a domain folder, separate by purpose when useful (for example `scripts/coinbase/smoke/`).

## When to create a top-level domain folder

Create `scripts/<domain>/` only if at least one is true:

1. The domain has scripts beyond smoke tests (for example migrations, maintenance, rollback).
2. The domain has multiple smoke suites and clear ownership boundaries.
3. The domain is expected to grow and needs stable discoverability.

If none apply, keep scripts in shared folders.

## Smoke test definition

A smoke test is a fast, high-signal check that verifies a critical path is alive.

Smoke tests should:

- Catch obvious regressions quickly.
- Validate core behavior, not every edge case.
- Be safe to run frequently.
- Stay focused and reasonably short.

Smoke tests are not full regression or exhaustive integration suites.

## Smoke placement policy

- Never place smoke tests directly in `scripts/smoke/` root.
- Place general smoke tests in `scripts/smoke/<category>/`.
- Place domain-specific smoke tests in `scripts/<domain>/smoke/` when that domain has a top-level folder.
- If a new category is needed, create it and document it in `scripts/smoke/README.md`.

## Current example

- `scripts/coinbase/` includes operational scripts and Coinbase-specific smoke tests under `scripts/coinbase/smoke/`.