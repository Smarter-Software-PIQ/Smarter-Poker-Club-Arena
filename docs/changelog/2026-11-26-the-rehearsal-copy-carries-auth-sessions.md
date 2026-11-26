# The Rehearsal Copy Carries auth.sessions (2026-11-26)

## What Was Wrong

The schema copy that `window-migrations-install-before-merge.yml` restores for its rehearsal had no `auth.sessions`. Production has it, and the device functions read it (`fn_ca_live_session_id`, `ca_claim_active_login`). So a migration that redefines a device function could not pass before merge: plpgsql_check refused `ca_claim_active_login` with 42P01, and the migration's required `-- @probe-for:` block failed on the copy for the same missing relation. PR #12134 (the `ca_browser_bindings_pkey` fix) is held by it.

## The Change

**File:** `scripts/ci/rehearsal-auth-schema.sql`

`auth.sessions` is added with `CREATE TABLE IF NOT EXISTS`, in production's shape as read read-only on 2026-11-26. The one omission is `aal`: its `auth.aal_level` type may be missing from the image, and no application object reads it. The copy holds no sessions, so a probe on it always sees a signed-out caller. The image's own table wins if it has one.

## Why A Separate Pull Request

The gate runs the default branch's scripts (pull_request_target). This file has to be on main before the migration's gate can see the table.
