# Tools Module Structure

## Purpose

This folder is split by responsibility so runtime wiring and tool behavior are easy to find.

## Subfolders

- `core/`
  - Policy, protocol, registry, and executor logic.
  - Owns shared tool typing and conversion helpers.
- `builtin/`
  - Local/runtime tools (file, exec, memory, coinbase tool adapters).
- `web/`
  - Network-facing tools and SSRF guard logic (`web_search`, `web_fetch`, net protection).
- `runtime/`
  - Runtime loader/bridge used by chat/runtime infrastructure (`createToolRuntime`).
- `docs/`
  - Local structure and maintenance docs for this module.

## Rule

Do not add loose files directly under `src/tools`; place each new module in one of the subfolders above.
