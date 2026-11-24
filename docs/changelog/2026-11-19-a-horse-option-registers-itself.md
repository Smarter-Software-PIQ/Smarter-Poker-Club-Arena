# A Horse option registers itself: the whitelist is rows, not a re-asserted list (2026-11-19)

Owner: Horse Decisions lane (session 01TLQer7J). Migration `20261124055958_a_horse_option_registers_itself.sql`.

## The problem

The database whitelist of the Horse option switch was literal name lists: three CHECK constraints on
`public.ca_horse_style_switch` and the body of `public.fn_ca_horse_option_switch_states`. A CHECK cannot be added
to, only replaced, so since 2026-11-15 every pull request that registered one option, or moved one to off-only,
carried a generated migration re-asserting ALL the names (about 560 lines; over 1,325 lines by 2026-11-22), and the same lists in the PostgreSQL
proof script. "The newest such migration is the whitelist."

Migrations install in merge order. With several such pull requests open, whichever merged second had to
regenerate against the first and re-run an hour of checks, and a stale one silently un-locked every option the
first had locked (blocking review finding B1 of 2026-11-19, `REVIEW-6b5bd653e69-01TLQer7J.md`). Three lanes lost an
afternoon to it.

## The rule now

The whitelist is the ROWS of `public.ca_horse_option_whitelist`: one row per option, its kind (`style` or
`plain`) and `locked_by`, the migrations holding it off-only (`off_only` is "locked_by is not empty").

- `ca_horse_style_switch_option_is_registered` is a FOREIGN KEY to the whitelist: an unregistered option cannot be
  written by any writer, and a registered option with a switch row cannot be removed.
- `ca_horse_style_switch_on_cites_authority` and `ca_horse_style_switch_state_fits_option` are enforced by one
  AFTER INSERT OR UPDATE row trigger, same rules, same names in the errors: on for a non-style option cites its
  own authority; shadow and canary only for a style option; on never for an off-only option.
- `fn_ca_horse_option_switch_states` reads the row: same signature, same answers, same grant.
- A pull request registers ITS OWN options, one line each:
  `SELECT public.fn_ca_horse_option_register('<option>', 'plain' | 'style', <off-only>, 'none' | 'on_shadow' | 'shadow', '<its migration>');`
  Idempotent, and two such migrations give the same whitelist in either install order.
- OFF-ONLY IS MONOTONIC. Registering can add a hold and never lifts one (`false` is "I do not hold it", not
  "nobody does"). A hold is lifted only by `fn_ca_horse_option_unlock(option, ARRAY[every holder], migration)`,
  which raises when it does not name every holder, and an option is removed only by
  `fn_ca_horse_option_unregister`. A guard trigger on the whitelist refuses any other UPDATE, DELETE or TRUNCATE
  that would do either. The law fails for an un-lock or a removal not listed in `OPTION_SWITCH_APPROVED_UNLOCKS`.
- The whitelist migration carries NO LIST. Its seed reads the installed CHECK constraint, classifies each name with
  the installed states function, refuses unless the two name exactly the same options, and refuses unless what it
  read is exactly the lists of the last full-list migration (one fingerprint line). The database and the law start
  from the same whitelist, or nothing is installed.

Unchanged: every switch row and audit row; `fn_ca_horse_option_switch_set`, `_clear`, `_record_evidence`,
`_effective`, the old style setter, and the serving-registry guard of #11391
(`fn_ca_horse_option_registry_publish`, `fn_ca_horse_option_registry_refusal`) are not redefined; every grant. The
engine is untouched: no TypeScript that serves a hand changes.

## What a lane does now

    node scripts/new-migration.mjs "horse option register <what>"            # repository root
    npx tsx scripts/gen-horse-option-switch-sql.ts --register <that file>    # server/

The file holds only that lane's options (about ten lines of SQL). Nothing is regenerated when another pull request
merges first. `--follow-up` is gone, and a new full-list follow-up fails the law: installed after the whitelist it
would put the literal lists back over the rows (and `fn_ca_horse_option_register` then refuses, saying so).

## The law and the proof

- `server/src/engine/HorseOptionSwitchMigrationLists.ts` computes the whitelist a database holds after installing
  main: the frozen lists of the last full-list migration (`OPTION_SWITCH_LAST_LIST_MIGRATION`) plus every writer
  call of every migration. `everyUpgradeHasALiveSwitch.law.test.ts` requires it to equal the registry, requires
  every migration that names a whitelist writer or the table to be a plain register migration, and pins the
  whitelist migration by shape.
- `aSwitchListIsNeverStale.law.test.ts` and `switchListFreshAtMerge.ts` still enforce the frozen chain of historical
  full-list migrations, accept commuting `--register` migrations without requiring a re-asserted full list, and
  refuse any stale branch that still carries a new full-list migration once the whitelist migration is on main.
- `HorseOptionSwitchMigrationLists.test.ts`: two register migrations in either order give the same whitelist; a
  stale one lifts no hold; an un-lock names every holder.
- `scripts/ci/test-horse-option-switch-evidence-postgres.sh` (required `accounting_postgres` job) no longer carries
  option lists. It proves the switch as installed over the frozen lists, then installs the whitelist migration
  twice over live rows and requires: the seeded rows are exactly the installed lists; no switch row, audit row,
  setter, reader or guard function changed; every row of the table keeps its rules from any writer; two register
  migrations commute in two copies of the database; every plain write that would lift a hold is refused.

## Rollback

A rollback is a NEW migration, never a replay. Before any option is registered through the new path it holds the
statements of the last full-list migration (`20261122131322`): it drops the foreign key by name, re-adds the three
CHECKs and puts back the literal states function, then drops the row trigger and the table. The states body it
restores is a superseded one, so that migration must say so in its transaction
(`SET LOCAL ca.allow_function_rollback = 'public.fn_ca_horse_option_switch_states';`, the superseded-body law of
2026-11-18). After options have been registered through the new path, the lists of that rollback are written from
the registry of that day (the old generator is in git history at this commit's parent).

## 2026-11-20: Rebased Onto The Shadow And On_shadow Lists (Horse Decisions Lane, Tooling Helper)

The first version (commit 8325253b0de, base 9b2277fd3e2) knew three answers: style, off-only, off/on. Main has had five
since the shadow list (2026-11-18) and the on_shadow list (2026-11-19), and seven more full-list migrations. This rebase:

- reserves a new version (`20261120212506`) and freezes the lists at `20261120181452_horse_option_switch_river_current_nuts_call_floor`
  (346 options: 7 style, 55 off-only, 194 shadow, 87 on_shadow only, 3 off/on); 34 full-list migrations;
- adds the row's shadow level (`shadow text`: none, on_shadow, shadow), read by the states function and the row trigger;
  the seed classifies each installed option by the five answers of the installed states function;
- `fn_ca_horse_option_register(option, kind, off_only, shadow, migration)`: a registered option keeps the LOWER level,
  so register migrations still commute; `fn_ca_horse_option_allow_shadow(option, level, migration)` is the only widening
  and is approved by name (`OPTION_SWITCH_APPROVED_UNLOCKS`, `<migration>:allow_shadow:<option>`);
- the whitelist guard refuses a hold while the switch row is not off, and a narrower level under a row in a state the
  option would lose (shadow, on_shadow);
- generator: `--register <file> [--allow-shadow] [option ...]`.

## 2026-11-24: Re-Anchored On #11825 (46 Frozen Full-List Migrations)

Main merged PR #11825 (`b319a8eb0b5a`), whose full-list migration
`20261123071956_horse_option_switch_non_nut_raise_and_late_call.sql` follows Turn 5 and adds two PLO options default
OFF. Re-anchored on it:

- the frozen anchor is now `20261123071956` (46 full-list migrations, 367 options: 7 style, 360 plain, 75 off-only,
  202 shadow, 280 on_shadow), fingerprint `42fe91b250933682bd22383fcc3b6bd3`, derived with
  `optionSwitchListsFingerprint` from the file;
- the whitelist migration keeps version `20261124055958`, newer than every full-list migration on main, so the
  #11825 list (stamp `20261123071956`) still installs before it and refuses to install after it;
- the throwaway Postgres proof reads its frozen lists from the #11825 migration and its refusal and overwrite checks
  name `20261123071956`.

## 2026-11-24: Rebuilt On Main bf6fb356036e, Re-Reserved As 20261124055958

Rebuilt by the HORSE DECISIONS lead (Claude session 01BNteGZ) on fresh `origin/main` (`bf6fb356036e`), carrying only
this change's own files (the earlier build sat on an unmerged combination branch):

- the frozen anchor is unchanged: `20261122181616_horse_option_switch_turn5_antigravity_train.sql` is still the
  newest full-list migration on main (45 full-list migrations, 365 options: 7 style, 358 plain, 75 off-only, 200
  shadow, 278 on_shadow), and its fingerprint, derived again with `optionSwitchListsFingerprint`, is still
  `c8cca75e4b8a5e518e8cffb0e75c976b`;
- the migration is re-reserved with `scripts/new-migration.mjs` as `20261124055958`, newer than every migration on main
  (the old reservation was older than about thirty migrations merged since), so it is the newest switch migration
  on main when it merges and the older-first installer never sends it ahead of a newer file;
- the proof script keeps main's refused line.

## 2026-11-23: Re-Anchored On Turn 5 (45 Frozen Full-List Migrations)

Re-anchored by the HORSE DECISIONS lead (Claude session 01BbZPDk) on the Antigravity Coordinator's Turn 5
`20261122181616_horse_option_switch_turn5_antigravity_train.sql` (PR #11820), which merges and installs before this
migration:

- the frozen anchor is now `20261122181616` (45 full-list migrations, 365 options: 7 style, 358 plain — 75 off-only,
  200 shadow, 278 on_shadow, fingerprint `c8cca75e4b8a5e518e8cffb0e75c976b`); the whitelist migration kept its
  reserved version (re-reserved on 2026-11-24, below), which still installs after the anchor;
- the throwaway Postgres proof reads its frozen lists from the Turn 5 migration and its refusal and overwrite
  checks name `20261122181616`;
- `scripts/ci/test-horse-option-switch-evidence-postgres.sh` keeps every refused option merged since (#11741,
  #11824).

## 2026-11-22: Synced Onto Main 59d700196f6f (Turn 4B + #11763, 44 Frozen Full-List Migrations)

Synced onto `origin/main` (`59d700196f6f`):

- reserved the version this migration then carried (re-reserved on 2026-11-24) and advanced the frozen anchor to installed Turn 4B
  `20261122131322_horse_option_switch_turn4b_plo_replacements_and_locks.sql` (44 full-list migrations, 363 options:
  7 style, 356 plain — 74 off-only, 198 shadow, 277 on_shadow, fingerprint `d6f68f3b860b4817332fda57508c2f9e`);
- stamps its own version (`-- registry-lists-version: <version>`) in `fn_ca_horse_option_switch_states` so stamped historical
  full-list migrations (including `20261122131322`) refuse at install time to overwrite the row-based whitelist;
- updates `scripts/ci/test-horse-option-switch-evidence-postgres.sh` to include the three `#11763` refused
  multi-board options (`multiBoardFreerollIsPriced`, `multiBoardNonFreerollIsPriced`, `multiBoardBluffTrimIsPriced`).

## 2026-11-22: Synced Onto Main 3f0a9967d5f4 (43 Frozen Full-List Migrations, #11553 / #11668 Reconciled)

Synced onto `origin/main` (`3f0a9967d5f4`):

- reserves version `20261122052716` and advances the frozen anchor to
  `20261122035000_horse_option_switch_hud_consumer_and_b4.sql` (43 full-list migrations, 356 options:
  7 style, 349 plain — 58 off-only, 200 shadow, 286 on_shadow, fingerprint `731ad40b8e215a0403e7d3c9ab7c5335`);
- stamps `-- registry-lists-version: 20261122052716` in `fn_ca_horse_option_switch_states` so stamped historical
  full-list migrations refuse at install time to overwrite the row-based whitelist;
- reconciles `#11553` (`aSwitchListIsNeverStale.law.test.ts`) and `#11668` (`switchListFreshAtMerge.ts`) so they
  continue enforcing the frozen 43-migration full-list chain, accept commuting `--register` migrations without
  requiring a re-asserted full list, and refuse any stale branch adding a full-list migration once the whitelist
  migration is on main.
