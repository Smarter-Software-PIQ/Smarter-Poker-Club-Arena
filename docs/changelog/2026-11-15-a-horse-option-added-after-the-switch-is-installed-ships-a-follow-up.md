# A Horse option added after the switch is installed ships a follow-up migration (2026-11-15)

Owner: Hold'em Strategy (writer of the every-option switch registry by overwatch handoff A, inbox 2026-11-15
16:07:28Z / 16:11:21Z).

## The problem

The option switch's database whitelist (the three CHECK constraints of `public.ca_horse_style_switch` and
`public.fn_ca_horse_option_switch_states`) was written only inside migration `20261114072215`, and
`server/scripts/gen-horse-option-switch-sql.ts` rewrote that file in place. Once `20261114072215` is installed its
bytes may never change again (an installed migration and its file agree). So every later head that adds a ledger
option (or moves one to off-only) would have had two choices, both wrong: fail
`everyUpgradeHasALiveSwitch.law.test.ts`, or edit an installed migration.

## The rule now

The database whitelist is the NEWEST migration under `supabase/migrations` (by version) that carries the
`-- registry:plain-options:begin` marker. `20261114072215` stays the first one and is never rewritten. A change to the
registry ships as a NEW follow-up migration, generated from the registry, that re-asserts the lists:

- the three CHECK constraints are dropped (if they exist) and re-added with the same text, only the lists changed;
- `fn_ca_horse_option_switch_states` is replaced, same body shape, only the lists changed; grants restated;
- one transaction, `lock_timeout` 3 s, idempotent (installing it twice changes nothing);
- it NEVER fixes data: if a row already in the table would break the new lists (an option the registry no longer
  has, or `on` for an option that is now off-only), it raises with the row named and installs nothing. Turn that row
  off or clear it first with `fn_ca_horse_option_switch_set` / `fn_ca_horse_option_switch_clear` (audited);
- it adds no table, column or row and switches nothing. Registering an option enables nothing.

The pure parts live in `server/src/engine/HorseOptionSwitchMigrationLists.ts` (shared by the generator and the law).

## How to add a Horse option after the switch is installed

One command, one new file. From `server/`, after your ledger flag is in `HorseDataLedger.ts` (and after merging main,
so your follow-up is the newest):

```
npx tsx scripts/gen-horse-option-switch-sql.ts --follow-up <YYYYMMDDHHMMSS>_horse_option_switch_<what>
```

It writes `supabase/migrations/<that name>.sql` and sets the option lists of
`scripts/ci/test-horse-option-switch-evidence-postgres.sh`. It refuses an existing file, a version that is not later
than the newest list migration, and a registry that already equals the newest lists.

- `--check` exits 1 when the newest list migration or the proof script lists differ from the registry (writes
  nothing). The law gives the same message, naming the `--follow-up` command.
- With no argument it rewrites the newest list migration in place ONLY when that is your own follow-up that
  `origin/main` does not hold yet (for example after merging main brought in another lane's follow-up: give yours a
  later version, or regenerate it). It refuses `20261114072215`, any file that is not the newest, and any file on
  `origin/main` (git unreadable counts as on main).
- Two lanes adding options at once: the second to merge merges main, deletes its own unmerged follow-up and runs
  `--follow-up` again with a later version, so the newest file always carries every option.

## Proof

- `server/src/engine/HorseOptionSwitchMigrationLists.test.ts`: (a) a ledger option missing from the newest list fails
  with the message naming `--follow-up`; (b) a generated follow-up equals the registry, keeps the base constraint and
  function shapes, is idempotent and never fixes data; (c) the base, an older follow-up and any file on main are never
  rewritten; the newest marker-bearing file is the whitelist; the proof script lists are written from the registry.
- `everyUpgradeHasALiveSwitch.law.test.ts` reads the lists from the newest list migration (base assertions on functions,
  grants and the read-back unchanged), and checks that a follow-up re-asserts the lists and nothing else.
- `scripts/ci/test-horse-option-switch-evidence-postgres.sh` installs the base and then every follow-up in version order
  (plus any file in `OPTION_SWITCH_FOLLOW_UPS`), and installs the newest one twice to prove it is idempotent. With
  `OPTION_SWITCH_MIGRATION` set (the guard-less variant) the repository's follow-ups are not applied, so they cannot
  put the guard back.

No migration is added by this change, and no option, default or row changes.
