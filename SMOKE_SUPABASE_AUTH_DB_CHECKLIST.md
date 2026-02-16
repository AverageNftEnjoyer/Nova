# Supabase Auth + Database Smoke Test Checklist

Date: 2026-02-16  
Scope: New-account isolation, onboarding defaults, and cross-user data leakage

## Launch

- [ ] Start Nova desktop (`C:\Nova\Nova.vbs` or `node nova.js` from `C:\Nova`)
- [ ] Confirm HUD loads and login screen is reachable

## Test Accounts

- [ ] Create Account A (fresh email)
- [ ] Create Account B (different fresh email)
- [ ] Keep credentials saved for repeated login/logout checks

## Auth Flow

- [ ] Account A can sign up and log in
- [ ] Account A can log out cleanly
- [ ] Account B can sign up and log in
- [ ] Account B can log out cleanly
- [ ] Re-login to Account A succeeds
- [ ] Re-login to Account B succeeds

## New Account Default Experience (Must Be True For Each Fresh Account)

- [ ] User is sent through onboarding flow (not dropped into prior personalized state)
- [ ] Boot animation is enabled by default
- [ ] Default visual theme is violet/purple with floating-lines background
- [ ] Integrations menu starts empty/unconfigured (waiting to be filled)
- [ ] No prior chats/history appear
- [ ] No prior personalization/profile values appear
- [ ] No prior notification/app settings appear

## Cross-Account Isolation (Critical Regression Check)

- [ ] Set distinct values in Account A (profile name, settings toggles, chat message)
- [ ] Sign out and log in as Account B
- [ ] Verify Account B does **not** inherit Account A values
- [ ] Set distinct values in Account B
- [ ] Sign out and log back into Account A
- [ ] Verify Account A and Account B each keep only their own values

## Integrations Isolation

- [ ] Configure at least one integration in Account A (test value only)
- [ ] Log into Account B
- [ ] Verify integration status/secrets are not prefilled from Account A
- [ ] Save a different integration state in Account B
- [ ] Re-check Account A is unchanged

## Database/RLS Validation (Supabase SQL Editor)

- [ ] In `threads`, `messages`, `memories`, `thread_summaries`, `tool_runs`, records are scoped by `user_id`
- [ ] No Account B data is returned when authenticated as Account A (and vice versa)
- [ ] RLS policies on all above tables are enabled and enforced
- [ ] `integration_configs` rows are isolated per `user_id`

## Local Development Leakage Checks

- [ ] Inspect browser localStorage/sessionStorage for non-user-scoped keys carrying state across users
- [ ] Verify account switch updates active user identity key before loading settings/history
- [ ] Hard refresh after account switch still shows correct user-specific state

## Pass/Fail Gate

- [ ] PASS only if zero cross-account leakage is observed
- [ ] FAIL immediately if any new account inherits prior account data
- [ ] If FAIL: capture account IDs, leaked fields, and exact reproduction steps

## Notes

- Potential leakage hotspot to watch: chat history keying (`hud/lib/conversations.ts` uses global localStorage keys).
