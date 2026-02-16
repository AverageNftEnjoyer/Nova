# Internal Checklist: User Isolation Fixes

Date: 2026-02-16  
Focus: Prevent cross-account leakage for chats, missions, and uploaded media assets

## Confirmed Regressions

- [x] New user sees previous users' chats
- [x] New user sees previous users' missions
- [x] New user sees previous users' custom MP4 background assets
- [x] New user sees previous users' custom boot music assets
- [x] New user boot animation default is correct
- [x] New user base/default settings are correct

## Fix Execution Plan

- [x] Scope chat localStorage keys by active user id
- [x] Scope boot music IndexedDB keys by active user id
- [x] Scope background video IndexedDB keys by active user id
- [x] Scope mission schedule API reads/writes by authenticated Supabase user id
- [x] Add server-side mission schedule record field for `userId`
- [x] Add one-time migration path for legacy unscoped chat keys
- [x] Add one-time migration path for legacy unscoped mission records
- [x] Add one-time migration path for legacy unscoped IndexedDB media records
- [ ] Run smoke test with Account A and Account B after code restart
- [ ] Verify old shared data is no longer visible cross-account
- [ ] Confirm no regressions in sign-in/sign-out/account switch behavior

## Smoke Verification Steps (Post-Fix)

- [ ] Sign in as Account A, create one chat, one mission, upload one MP4, upload one boot music file
- [ ] Sign out and sign in as Account B
- [ ] Confirm Account B starts with zero chats, zero missions, zero media uploads
- [ ] Add unique data in Account B
- [ ] Switch back to Account A and verify A-only data remains intact

## Agent Self-Run (2026-02-16)

- [x] Full lint executed with zero errors
- [x] Nova desktop services restarted after fixes
- [x] Code-level verification completed for chat, mission, and media user scoping
- [x] Auth handoff hardened to route all successful auth through `/boot-right?next=...`
- [x] Auth fetch bridge changed to read current Supabase session token per API call
- [x] Signup flow now attempts immediate sign-in and boot routing when allowed
- [x] Media stores now reject read/write without active user scope (prevents fallback global keys)
- [ ] Manual two-account UI smoke test (you will run)

## Notes

- Legacy chat keys (`nova-conversations`, `nova-active-conversation`) are migrated to user-scoped keys on first load.
- Legacy mission rows without `userId` are adopted by the first authenticated user with no scoped rows.
- Legacy unscoped media assets (`asset:*`, `active-id`) are migrated into the current user's scoped IndexedDB keys.
