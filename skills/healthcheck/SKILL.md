---
name: healthcheck
description: Host hardening and operational health workflow for security posture checks and safe remediation planning.
user-invokable: false
metadata: { "read_when": ["User asks for security audit, hardening, host exposure check, or system posture review."] }
---

# Healthcheck Skill

## Activation
- Use this skill when the user asks for machine hardening, exposure review, or security posture checks.
- Require explicit confirmation before any state-changing command.

## Workflow
### 1. Scope
- Identify OS, access method, and whether the user wants read-only audit or guided remediation.

### 2. Execute
- Start with read-only checks for listening ports, firewall state, update posture, and backup/encryption status.
- Summarize risk by severity (critical, high, medium, low).
- If requested, prepare a stepwise remediation plan with rollback notes.

### 3. Verification Before Done
- Clearly mark read-only findings versus planned changes.
- Confirm commands are OS-appropriate before proposing execution.
- Do not claim a control is enabled without evidence from command output.

## Completion Criteria
- User gets a prioritized risk summary plus concrete next steps.
- Safety constraints and rollback considerations are explicit.
