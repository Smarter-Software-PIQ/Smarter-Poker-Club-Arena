# 2026-11-08 - A Backup Fixture Identity Is Readable By GoTrue

## What failed

Every Backup Engine certificate since #10008 (7980972ec, 02:06 UTC) failed its rollback rehearsal to 391f7bc0d57c: `server/standby/player-reconnect.mjs` threw "Backup fixture identity initialization failed 500" on `PUT /auth/v1/admin/users/<id>`, so `probe.mjs` reported "predecessor unavailable". The isolated clone's GoTrue logged the cause:

- before #10027: `Scan error on column index 3, name "confirmation_token": converting NULL to string is unsupported`
- after #10027 (2f9515372): `Scan error on column index 33, name "updated_at": unsupported Scan, storing driver.Value type <nil> into type *time.Time`

The seed inserted only `id, aud, role, created_at` (plus, since #10027, the token strings). On the refreshed clone 1,095 of 1,097 users had a NULL `updated_at` and 35 a NULL `created_at`; GoTrue scans both into non-pointer `time.Time`.

ac3440ad7 (02:24 UTC) did not pass the rehearsal: its run was superseded by a newer push, planned nothing and certified nothing. No commit after 7980972ec carried a certificate before this fix.

## Fix

- `server/standby/standby-engine.sh`: the seed sets `created_at` and `updated_at` to `COALESCE(created_at, now())`, and the conflict branch fills either if NULL. Fixture version 2.
- The admission check and `backup-engine.yml`'s refresh selection require `authFixtureVersion == 2`, so the version-1 copy now on the host is refused and rebuilt by the next run instead of being certified.

## Proof

- The exact seed SQL, run against the clone's 1,097 users inside a rolled-back transaction: 0 NULL `created_at`, `updated_at` or `confirmation_token` afterwards.
- On the clone, the rehearsal's own admin PUT for a user with both timestamps NULL returned 500; after setting them, 200.

Law test: `tests/a-backup-fixture-identity-is-readable-by-gotrue.law.test.ts`; `tests/dr-posture.test.ts` refuses a version-1 copy.
