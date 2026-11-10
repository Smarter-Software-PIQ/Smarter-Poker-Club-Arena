# A colliding migration version would have skipped Dan's seating fix for ever

2026-11-10. Found while delivering an unrelated change: `main` was red on
`Client Unit Tests`, and the assertion was `migrationVersionUniqueness`.

## What was wrong

Two pull requests merged four minutes apart both took version `20261110160345`:

| PR     | merged | file                                                                   |
| ------ | ------ | ---------------------------------------------------------------------- |
| #10373 | 11:12  | `..._lightning_blinds_and_button_go_to_the_longest_waiting_player.sql` |
| #10368 | 11:16  | `..._table_seats_live_partial_indexes_keep_a_real_row_estimate.sql`    |

CLAUDE.md 4.5 describes this precisely, including the part that matters more
than the red check: Supabase keys `schema_migrations` on the version, so of two
files sharing one, the second is silently never applied.

Production had recorded `20261110160345` under #10368's name. #10368 is fully
applied and its live proof passes (`table_seats.left_at` attstattarget = 1000).

#10373 is a daily-maintenance window migration, so it is not applied on merge:
`scripts/ci/install-window-migrations.mjs` installs it inside the 04:00 freeze,
and it builds its queue as

```js
queued = declared.filter((f) => !versions.has(f.slice(0, 14)) && ...)
```

`f.slice(0, 14)` is the 14 digit version, and that version was already in
`schema_migrations`. So #10373 was filtered out of the queue. It would have sat
on `main` looking queued, been skipped by the 03:30 run every night, and
reported nothing. The work it carries is Dan's 09:52 Chicago seating
complaint ("I was SB 3 hands in a row"), so the visible symptom would have been
that an owner reported unfairness stayed in production with a merged fix.

## What was read before changing anything

Production, read only: `lightning_pool_slot` has no `hands_since_button`
column, and `fn_lightning_match_plan` carries no `BY RECENCY (20261110)`
marker. None of #10373 had been applied, so nothing was half done and the
renumber strands nothing.

## The fix

The version moved, the SQL did not. `20261110160345` stays with #10368, which
production is recorded under. #10373's file is renumbered to `20261110175018`,
reserved with `scripts/reserve-migration-version.sh` rather than typed by hand.
The executable SQL is byte identical: the md5 of the file's non comment, non
blank lines is `0cd32cd1661e24f08c56626b023f43d0` before and after, and all
five directive lines (`@install-window`, `@locks`, three `@live-proof`) are
preserved. Dan's fix is now genuinely queued for the next 03:30 window.

One trap worth recording: the first draft of the renumbered header explained
the move in prose that used the literal `@install-window` token a second time,
and `validateWindowMigration` refused the file because an install window
declaration must be exactly one line. The validator was right and was not
weakened; the prose was reworded.

## The rename has a second half (CLAUDE.md 10.86 rule 4)

A migration's version is not only a filename. `scripts/dev/test-lightning-matcher-parity.sh`
line 550 loads this migration by exact filename with `psql -f`, to prove the
TypeScript matcher port decides what `fn_lightning_match_plan` decides on the
same snapshot. Renaming the file broke that load, and the first push of this
change turned `Accounting transactions (PostgreSQL 17) shard 3/7` red on the
step named for that proof. The harness reference is updated here, in the same
change as the rename.

Four provenance mentions of the old version are updated with it, so a reader
who looks the version up does not land on the unrelated table_seats migration:
`server/src/lightning/LightningPositionFairness.test.ts`,
`server/src/lightning/ANewPlayersFirstLightningHandIsTheBigBlind.law.test.ts`,
`scripts/dev/fixtures/lightning-position-fairness-parity.sql`, and the #10373
changelog's own filename line. The table_seats migration and its changelog keep
`20261110160345`, which is the version production recorded them under.

## Verified

`migrationVersionUniqueness`, `a-window-migration-waits-for-the-daily-break`
and `aMergedMigrationIsInstallable`: 3 files, 1122 tests, all passing locally.
No threshold, test or check was weakened. Nothing was applied to production by
this change; the renumbered file installs through its normal window route.
