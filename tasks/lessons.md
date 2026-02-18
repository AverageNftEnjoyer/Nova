# Skill Overhaul Lessons

Use this pattern for every correction:
- Date:
- Correction:
- Preventive rule:
- Applies to:

## 2026-02-18
- Date: 2026-02-18
- Correction: Background mode mapping was inverted between floating lines and custom video.
- Preventive rule: Use one source of truth for enum-like settings (`userSettings`) and avoid fallback remapping from transient cache keys.
- Applies to: Background mode persistence, hydration, settings-to-render mapping.

## 2026-02-18
- Date: 2026-02-18
- Correction: Hydration mismatch occurred when server/client rendered different background-layer markup.
- Preventive rule: Client-only stateful visual layers must gate initial render on mount when SSR output cannot match.
- Applies to: Root-level visual layers and SSR hydration-sensitive UI.

## 2026-02-18
- Date: 2026-02-18
- Correction: Skill docs drifted from orchestration standards and became inconsistent across files.
- Preventive rule: Enforce a shared SKILL template with frontmatter, activation criteria, verification gate, and explicit completion criteria for every skill update.
- Applies to: `skills/*/SKILL.md` upgrades and future skill additions.

## 2026-02-18
- Date: 2026-02-18
- Correction: Strict sweep found missing explicit completion criteria sections and inconsistent activation wording across upgraded skills.
- Preventive rule: During rollout closeout, run a checklist pass that verifies `Activation`, `Verification Before Done`, and `Completion Criteria` headings in every upgraded skill.
- Applies to: Skill overhaul validations and future multi-skill migrations.
