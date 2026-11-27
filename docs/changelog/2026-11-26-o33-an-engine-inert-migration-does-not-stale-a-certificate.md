# An Engine-Inert Migration Does Not Stale A Certificate (O33, 2026-11-26)

Lane: release custody. Pull request: this branch, `o33-an-engine-inert-migration-does-not-stale-a-certificate`.

## Why It Broke

The 1:00 PM CST cutover of November 26 was lost. The only candidate certified that day, `13bce958d4c3`, was refused at the 1:00 PM selection (issue #11599, comment at 12:30 PM CST): "Backup copy lacks installed migration 20261126011318, 20261126014018, 20261126014434, 20261126064723". Those four merged and installed at about 7:15 AM CST, after the certified copy was taken. Each is only:

```
BEGIN;
SET LOCAL lock_timeout = '3s';
SELECT public.fn_ca_horse_option_register('<option>', 'plain', false, 'shadow', '<file stem>');
COMMIT;
```

`fn_ca_horse_option_register` (`supabase/migrations/20261125234502_a_horse_option_registers_itself.sql`) writes one row of `public.ca_horse_option_whitelist`. Checked before the change:

- `git grep ca_horse_option_whitelist` over `server/src` at main and at `132ef19f0770`, excluding tests and `HorseOptionSwitchMigrationLists.ts` (a merge-time parser of migration files, not a database reader): no match.
- The engine reaches the database side only through `fn_ca_horse_option_switch_effective` and `fn_ca_horse_style_switch_effective` (its `rpc` calls; `fn_ca_horse_option_switch_set` and `_record_evidence` appear only in comments). Both use `fn_ca_horse_option_switch_states(s.option) @> ARRAY['canary']`, which is true only for a style option. A register call never changes the kind of an option that already has a switch row: a switch row requires the option to be registered first (foreign key), and the whitelist guard refuses any change of kind.

A copy lacking those rows therefore certifies the same engine. The judge still refused it, because every Club Arena version was compared.

## How It Was Fixed

`server/scripts/engine-release-installed-migrations.py`:

- `engine_inert(text)`: after whole-line `--` comments and blank lines are dropped, every line is exactly `BEGIN;` (first), `COMMIT;` (last), `SET LOCAL lock_timeout = '<n>s';`, or one literal-only call of `fn_ca_horse_option_register`, `fn_ca_horse_option_allow_shadow` or `fn_ca_horse_option_unlock` (all three write only the whitelist), with at least one call. Option names are `[A-Za-z][A-Za-z0-9]{0,62}`, migration names `[0-9]{14}_[a-z0-9]+(_[a-z0-9]+)*`. Anything else is not inert.
- `inert_versions(repo, control, *others)`: versions whose one file in control's tree is inert and which the exact target does not ship. Any git failure or invalid SHA returns an empty set.
- The selector (`judge`, called from `scripts/ci/select-daily-engine.py`) and `refresh-due` leave those versions out on both sides and say `left out as engine-inert: <versions>`.
- The certificate digest is unchanged. At cutover, `status` accepts production when removing some non-empty subset of the inert versions it holds gives exactly the certified digest (at most 10 are tried). `bounded_inert` turns the carve-out off in the selector and `refresh-due` when production holds more than 10, so the selector never accepts a copy the cutover cannot recognise.

## What Stops It Returning

`tests/an-engine-inert-migration-does-not-stale-a-certificate.law.test.ts` (registered in `docs/laws.d/`): the four real files classify inert; fourteen mutations (extra UPDATE, CREATE, non-literal and subquery arguments, unknown function, DO block, two statements on one line, trailing and block comments, a quote in a literal, no BEGIN, no COMMIT, no call, a different SET) classify not inert; the judge fixtures pass; and the premise is re-checked on every change (no engine reader of the whitelist, the known eleven database readers, the engine calls only the two effective reads, which use only the kind). If the premise changes, the law fails and the carve-out must be removed. `tests/operations/backup-installed-migrations.test.py` gains `EngineInertMigration` (six cases, including the 13:00 replay through the selector, a missing ordinary migration still refused, refresh-due, certified-digest and status). `tests/a-backup-copy-is-certified-by-what-it-holds.law.test.ts` pins the new judge call.

## Verification

- `python3 -B tests/operations/backup-installed-migrations.test.py`: 54 tests; the new class passes; the same 2 failures and 11 errors as unmodified main, all "git ls-tree failed" / "git grep failed" / "git log failed" from this clone lacking historic objects.
- `daily-engine-selection.test.py` and `step-down-past-held-migration.test.py`: OK.
- Vitest: the new law, `a-backup-copy-is-certified-by-what-it-holds`, `the-backup-day-ends-with-only-a-four-am-release`, `the-four-am-build-is-certified-against-the-frozen-copy`, `the-post-seal-backup-certifies-the-next-candidate`, `a-degraded-engine-can-still-be-replaced`, `a-held-migration-does-not-block-the-commit-below-it`, `a-sparse-checkout-holds-what-its-scripts-load`, `the-release-projection-names-only-release-files`, `unit/clientEngineReleaseRouting`, `law-registry`: all pass except the same 3 cases of `a-backup-copy-is-certified-by-what-it-holds` that fail on unmodified main in this clone (missing historic git objects).
- On main, `inert_versions` names the nine register files of November 26 and not `20261125234502` (which creates the table and functions).

## Live Proof

Pending: the first selection after merge that meets an inert version the copy lacks should read `left out as engine-inert: ...`, and its cutover `status` line should name the same versions.
