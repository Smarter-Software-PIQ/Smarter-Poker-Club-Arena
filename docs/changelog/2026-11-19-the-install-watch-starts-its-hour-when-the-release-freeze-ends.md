# The install watch starts its hour when the release freeze ends (2026-11-19)

Production Alerts fleet, incident `migration-watch-blind-to-release-freeze`.

## What happened

#11319 (2026-11-18) made Dispatch Merged Migrations hold every ordinary
migration merged between 23:45 and 04:15 America/Chicago until 04:15
(`RELEASE_SCHEMA_FREEZE_CHICAGO`), so the 00:07 Backup copy still equals
production when the 03:30 selector certifies the night's engine.

On the first night, nine files merged inside that freeze and were held by
design. `fn_ca_merged_migration_install_watch` measured its hour from the
merge, and between 06:40Z and 07:40Z it paged the owner nine times as
critical. Each page said "Dispatch Apply Merged Migration for it". Following
that instruction stales the certificate, and the 04:00 cutover then keeps
serving the old engine. The affected alerts are 445153, 445160, 445175,
445176, 445189, 445190, 445199, 445213 and 445214.

## The fix

Migration `20261119090911` makes these changes:
- It adds `smarter_private.fn_ca_release_schema_freeze_end(ts)`. It returns
  the end of the freeze containing `ts`, or NULL. It reads Chicago wall time
  under IANA rules, so it is right on both sides of DST.
- It adds `smarter_private.fn_ca_install_watch_freeze_hold_end(merged_at)`. It
  returns that freeze end when the file's first hour touches the freeze.
- It amends the watch so that the hour of such a file starts at the freeze
  end. The amendment uses a guarded `replace(pg_get_functiondef(...))` with an
  md5 preimage of `3ebd1409...`. A merge at 00:22 Chicago is now quiet at
  01:22, and it pages at 05:15 if it is still not installed. A daytime merge
  keeps its hour from the merge. The pause hold from `20261117165416` is
  untouched.

## Proof and guards

- **Native proof:** `scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py`.
  The new "release freeze" cases fail on the live definition and pass with the
  fix. Run with `MIGWATCH_PRE_FREEZE=1` to reproduce the false page.
- **Invariant law:** `tests/the-install-watch-reads-the-release-freeze-the-dispatcher-holds.law.test.ts`.
  The SQL freeze bounds must equal the dispatcher constant, and every instant
  the migration asserts must agree with `inReleaseSchemaFreeze`.
- **CI:** `.github/workflows/a-merged-migration-left-uninstalled-is-paged.yml`.
  It now also runs when the dispatcher or this migration changes.
- **Detection:** unchanged. The watch remains the recurrence route, and its
  rows carry `target_task_id`.
