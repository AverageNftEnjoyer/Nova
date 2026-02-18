#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_DIR="${1:-$HOME/.myagent/workspace}"
SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATES_DIR="$SOURCE_ROOT/templates"
SKILLS_SOURCE_DIR="$SOURCE_ROOT/skills"

log() {
  printf "%s\n" "$1"
}

make_dir() {
  local dir="$1"
  if [[ -d "$dir" ]]; then
    log "already exists, skipping directory: $dir"
  else
    mkdir -p "$dir"
    log "created directory: $dir"
  fi
}

copy_if_missing() {
  local src="$1"
  local dest="$2"
  if [[ ! -f "$src" ]]; then
    log "missing source, skipping: $src"
    return
  fi
  if [[ -f "$dest" ]]; then
    log "already exists, skipping file: $dest"
  else
    mkdir -p "$(dirname "$dest")"
    cp "$src" "$dest"
    log "created file: $dest"
  fi
}

log "Setting up workspace at: $WORKSPACE_DIR"

make_dir "$WORKSPACE_DIR"
make_dir "$WORKSPACE_DIR/memory"
make_dir "$WORKSPACE_DIR/skills"
make_dir "$WORKSPACE_DIR/skills/research"
make_dir "$WORKSPACE_DIR/skills/summarize"
make_dir "$WORKSPACE_DIR/skills/daily-briefing"

# Bootstrap templates
copy_if_missing "$TEMPLATES_DIR/SOUL.md" "$WORKSPACE_DIR/SOUL.md"
copy_if_missing "$TEMPLATES_DIR/USER.md" "$WORKSPACE_DIR/USER.md"
copy_if_missing "$TEMPLATES_DIR/AGENTS.md" "$WORKSPACE_DIR/AGENTS.md"
copy_if_missing "$TEMPLATES_DIR/MEMORY.md" "$WORKSPACE_DIR/MEMORY.md"
copy_if_missing "$TEMPLATES_DIR/IDENTITY.md" "$WORKSPACE_DIR/IDENTITY.md"

# Starter skills
copy_if_missing "$SKILLS_SOURCE_DIR/research/SKILL.md" "$WORKSPACE_DIR/skills/research/SKILL.md"
copy_if_missing "$SKILLS_SOURCE_DIR/summarize/SKILL.md" "$WORKSPACE_DIR/skills/summarize/SKILL.md"
copy_if_missing "$SKILLS_SOURCE_DIR/daily-briefing/SKILL.md" "$WORKSPACE_DIR/skills/daily-briefing/SKILL.md"

TARGET_USER_FILE="$WORKSPACE_DIR/USER.md"

# Prefer GUI editors for a better first-run experience.
# Falls back to $EDITOR env var, then skips auto-open.
if command -v code >/dev/null 2>&1; then
  log "Opening USER.md in VS Code"
  code --reuse-window "$TARGET_USER_FILE"
elif command -v cursor >/dev/null 2>&1; then
  log "Opening USER.md in Cursor"
  cursor --reuse-window "$TARGET_USER_FILE"
elif [[ -n "${EDITOR:-}" ]] && command -v "$EDITOR" >/dev/null 2>&1; then
  log "Opening USER.md in $EDITOR"
  "$EDITOR" "$TARGET_USER_FILE"
else
  log "No editor detected. Open this file manually:"
  log "  $TARGET_USER_FILE"
fi

log ""
log "Setup complete."
log "Customize next:"
log "1) $WORKSPACE_DIR/USER.md       — who you are, your stack, preferences"
log "2) $WORKSPACE_DIR/SOUL.md       — your assistant's name and personality"
log "3) $WORKSPACE_DIR/IDENTITY.md   — fallback identity (update name placeholders)"
log "4) $WORKSPACE_DIR/AGENTS.md     — tool and task execution rules"
log "5) $WORKSPACE_DIR/MEMORY.md     — cross-session persistent memory"
log "6) $WORKSPACE_DIR/skills/*/SKILL.md"
