# A Browser Binds Once Per Account (2026-11-26)

## What Was Wrong

Production logged 134 `duplicate key value violates unique constraint "ca_browser_bindings_pkey"` errors in the 24 hours to 21:45 UTC on 2026-11-26, all from `ca_claim_active_login` called by the Club Arena client at smarter.poker. They came from two browsers, 107 from one and 27 from the other, each already bound to one account, when a second account (an account exempt from single-device enforcement) signed in on the same browser.

## Why It Broke

`ca_browser_bindings` was keyed on `browser_token` alone, while every reader looks a binding up by `(browser_token, user_id)`. When the second account had no binding of its own, the claim auto-enrolled the browser with a plain INSERT, and the first account's row already held that token. The client read the refusal as a transport failure and retried on every auth event, so one browser produced over a hundred errors.

`ca_resolve_pairing` had the opposite fault: its `ON CONFLICT (browser_token)` rewrote `user_id`, so approving a second account's pairing silently moved the first account's binding to it. The first account then had to pair the same browser again.

## The Change

**File:** `supabase/migrations/20261126220630_a_browser_binds_once_per_account_so_switching_accounts_never.sql`

- The primary key becomes `(browser_token, user_id)`. Existing rows are unique under it because every token has exactly one row today.
- `ca_claim_active_login`, `ca_register_new_device` and `ca_resolve_pairing` are replaced from their live bodies with grants kept. Each binding insert is `ON CONFLICT (browser_token, user_id) DO UPDATE SET device_id, last_seen`, and none rewrites `user_id`. The claim's `last_seen` refresh now filters by `user_id`, so one account's sign-in never touches another account's binding.
- No other object references the table (no foreign key, view, policy or trigger), and `ca_list_devices` and `ca_request_pairing` already read by `(browser_token, user_id)`.

## Hardening

`tests/unit/aBrowserBindsOncePerAccount.test.ts` reads the latest definition of the key and of each writer across every migration. It fails if the key goes back to `browser_token` alone, if a binding insert lacks `ON CONFLICT (browser_token, user_id)`, if a conflict rewrites `user_id`, or if the claim refreshes `last_seen` without the account filter. All four cases fail with the migration removed.

Each redefined function has a `-- @probe-for:` block that runs it before COMMIT as a signed-in caller with no live session; the first also proves one browser holds a row per account and the conflict target finds the caller's own row. `scripts/ci/rehearsal-auth-schema.sql` now carries `auth.sessions` in production's shape, which plpgsql_check on the rehearsal copy needed to resolve `ca_claim_active_login`.

The migration was rehearsed on a local PostgreSQL 16 with the production state (account A bound to a browser, exempt account B signing in on it). Before: the same `ca_browser_bindings_pkey` error. With the key left on `browser_token`, the first probe refuses and the migration rolls back. After: B gets its own binding and device, a repeat claim reuses it, and A's binding is untouched.

## Verify

```sql
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.ca_browser_bindings'::regclass and contype = 'p';
-- PRIMARY KEY (browser_token, user_id)
```

Postgres logs after the install should show no `ca_browser_bindings_pkey` errors.
