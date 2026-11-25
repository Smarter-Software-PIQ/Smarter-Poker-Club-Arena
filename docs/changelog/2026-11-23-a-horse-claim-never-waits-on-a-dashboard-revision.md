# A horse claim never waits on a dashboard revision (2026-11-23)

## What happened

At 06:40:02.530 UTC on 2026-11-23 the daily prune (cron
`ca-diamond-prune-history-daily`, `40 6 * * *`) and the horse claim tick (cron
`ca-horse-claim-due-minute`) deadlocked, and Postgres cancelled the prune. Its
650 abandoned mission rows (351 players) were left for the next day's run. It
is the only deadlock naming either function in the Postgres log from
2026-11-16 to 2026-11-23 (read in 24-hour slices).

## Cause, read from the log

The ERROR row names both sides:

```
Process 1164027: SELECT public.fn_ca_diamond_prune_history();
Process 1164029: SELECT public.fn_ca_horse_claim_due(500)
```

and the prune's own line names where it waited:

```
while inserting index tuple (206,21) in relation "daily_challenge_dashboard_revisions"
INSERT INTO public.daily_challenge_dashboard_revisions ... ON CONFLICT (user_id) DO UPDATE ...
bump_daily_challenge_dashboard_revision() line 22
DELETE FROM public.user_daily_challenges WHERE NOT completed AND created_at < ...
fn_ca_diamond_prune_history(integer,integer,integer) line 29
```

`daily_challenge_dashboard_revisions` holds one cursor row per player.
`bump_daily_challenge_dashboard_revision`, an AFTER ROW trigger on
`user_daily_challenges` and on `profiles.diamonds` (among others), upserts it
at line 22, so whoever bumps a player's row holds it until COMMIT. Both crons
bump many players in one transaction, in different orders:

- the prune's DELETE (line 29) bumps every player it deletes a row for, in the
  order the rows come off the table;
- `fn_ca_horse_claim_due` pays up to 500 horse rewards in one run, in
  challenge-row id order, and each claim's UPDATEs bump that horse's row inside
  the claim, by waiting.

The prune held horse A's row and waited for horse B's, which the run had
bumped; the run then reached A's claim and waited for A's row.

It is a lock-order cycle on that table. The claim never waits on a challenge
row or a profile; those are taken SKIP LOCKED since 2026-09-24 and 2026-10-15.

## The change

`20261123071151` edits the live horse claim once (md5 `cc2313be...` ->
`88cfc5b8...`). Right after the profile row, it now takes the horse's revision
row too, `FOR NO KEY UPDATE SKIP LOCKED`. That is the mode the trigger's
`ON CONFLICT DO UPDATE` takes, so nothing inside the claim upgrades. A horse
whose row someone holds is skipped exactly like a busy profile: not claimed,
not deferred, not counted, and still the oldest reward owed a minute later. A
horse with no row yet is claimed as before; its first bump creates the row.
The claim can no longer wait on a revision row, so it cannot close this cycle
with the prune or with any other writer that bumps several players at once.

Unchanged: every reward, amount, journal reference, refusal and deferral, and
every bump. Each change to a player's missions still raises that player's
revision by one in its own transaction. That is all the readers use:
`useDailyMissionRealtimeCatchUp` refreshes when the durable cursor is newer
than the revision on screen, and `get_daily_challenge_dashboard_v3` returns
it. The prune, the trigger and the claim body are not touched.

The prune still bumps its players in table order while it holds them, and
any other writer that bumps several players in one transaction keeps its own
order. None of them appears in a deadlock in the log for the week read; this
change removes only the one pair that did.

## Proof

`scripts/dev/prove-a-horse-claim-never-waits-on-a-dashboard-revision.py` runs on
a throwaway PostgreSQL 16 with production's own text. The horse claim, the
bump trigger, the prune and the claim body are each md5-checked against
production (`scripts/ci/fixtures/daily-mission-revision-lock-order/live-20261123.json`).

| case                                                 | before                                    | after                                       |
| ---------------------------------------------------- | ----------------------------------------- | ------------------------------------------- |
| claim run pays B, prune deletes A's and B's old rows | deadlock detected, prune cancelled        | no deadlock; prune commits; A paid next run |
| the same work one transaction at a time              | rewards, journal, prunes, revisions 8 / 8 | identical                                   |
| a horse with no revision row yet                     | claimed, row created at 2                 | identical                                   |

Before the fix, the local deadlock carries production's own context line
(`while inserting index tuple ... daily_challenge_dashboard_revisions`).

## Law

`tests/a-horse-claim-never-waits-on-a-dashboard-revision.law.test.ts` rebuilds
production's horse claim, applies the edit and pins:

- the order: advisory lock, profile, revision row, claim;
- every row lock in the run is tried;
- the lock mode matches the trigger's upsert;
- the block writes nothing;
- no later migration takes the row back by waiting.
