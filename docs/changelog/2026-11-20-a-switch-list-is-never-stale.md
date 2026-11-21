# A switch list is never stale (2026-11-20)

Antigravity Coordinator lane (session 01UxDLnH).

## The defect

Every Horse option switch list migration (`server/scripts/gen-horse-option-switch-sql.ts --follow-up`) replaces the
database's allowed-state lists wholesale. PR #11545 (Hold'em lane) was branched before PR #11538 merged. Its
regenerated list migration still listed `huBbDefendsUnreadToPrice` as off-only. Merged after 20261120210905 it
would have silently re-held an option the owner's delegate had just lifted, and its CI was green.

Why CI could not see it, read from `.github/workflows/ci.yml` and the `main` ruleset on 2026-11-20:

- pull request jobs check out `github.event.pull_request.head.sha`, the PR head, not the merge ref;
- the ruleset's required status checks have `strict_required_status_checks_policy: false`, so a branch behind main
  merges on checks that never saw main's newer file;
- ci.yml handles `merge_group`, but the ruleset requires no merge queue, so that path never runs.

Two list migrations merged close together could also install in either order: `apply-merged-migration.yml` runs
one job per file (concurrency is keyed on the file), with no ordering between files.

## The fix

Three guards, in `server/src/engine/HorseOptionSwitchMigrationLists.ts`:

1. **The chain.** Every list migration after `20261120210905_horse_option_switch_heads_up_big_blind_hold_lift`
   carries one `-- registry:follows: <file>` line naming the list migration it was generated after, which must be
   the list migration immediately before it by version. The list migrations at or below the anchor are pinned by
   version (`OPTION_SWITCH_PRE_CHAIN_VERSIONS`), so a hand-picked old version is refused too. Any tree holding both a
   lane's file and a list it never saw fails, whichever version is larger: main after a stale merge, and every
   later branch.
2. **Main.** On a pull request, a list migration the branch adds must be newer than every list migration on
   `origin/main`, and the branch must hold main's newest list migration. The server shards check out full history
   (`fetch-depth: 0`), so `origin/main` is current at run time. A pull request or merge group without the ref fails
   as UNKNOWN; elsewhere (a shallow release checkout) the check says it did not run.
3. **The database.** Each generated follow-up writes `-- registry-lists-version: <its version>` into the body of
   `fn_ca_horse_option_switch_states`, and its first DO block refuses to install when the installed function carries
   a newer stamp, before any ALTER. Proven on PostgreSQL 16 with every list migration on main installed: the older
   stamped list raised `switch list migration 20261121000001 is older than the installed list 20261121000002` and
   changed nothing. `scripts/ci/test-horse-option-switch-evidence-postgres.sh` asserts the same refusal once main
   holds a stamped list.

The generator writes the follows line on `--follow-up`, and the in-place rewrite of your own unmerged follow-up
resets it to the list migration now before it. Every failure message gives the remedy: bring main into your
branch, delete your list migration, regenerate it with `--follow-up`.

Law: `server/src/engine/horseDecision/aSwitchListIsNeverStale.law.test.ts`.

## What it does not close

Without strict required checks or a required merge queue, a PR whose checks ran before main gained a newer list
can still merge. Guards 1 and 3 then make it loud and harmless: the stale file refuses to install over the newer
stamp, and main's chain test fails until the stale file is deleted and regenerated. Enabling the merge queue
(ci.yml already runs every required job on `merge_group`) would refuse it before the merge. That is a ruleset
change and is not made here.
