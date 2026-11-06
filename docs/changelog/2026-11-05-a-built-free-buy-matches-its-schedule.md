# A Built Free Buy Matches Its Schedule (2026-11-05)

Owner rule: "A built event must match its schedule", and unstarted horse-only
wrongly-shaped events are rebuilt.

## What Was Wrong

On 2026-11-04 the Midway Union's scheduler built several rotation dates in
the previous (PKO) format, beside later dates built correctly in the same
second (#9515 fixed the source). Read from production on 2026-11-06 00:45 UTC with
the two shared format functions:

| Event | Schedule | Built | State |
| --- | --- | --- | --- |
| Afternoon Free Buy 2026-11-05 (74ba8130) | aiof | pko | running, one human registered |
| Prime Time Free Buy 2026-11-05 (1d115ff4) | mystery | pko | registering, 203 horses, no human |
| Morning Free Buy 2026-11-05 (930eee14) | regular | pko | completed |

Every date from 2026-11-06 on is built in its schedule's format. The
scheduler never revisited a date whose spawn key was claimed, so a wrong build
stood until it ran.

## The Fix

1. `20261106004812` (daily maintenance install window, because `CREATE
   TRIGGER` takes SHARE ROW EXCLUSIVE on `tournaments`): an AFTER ROW trigger,
   `zzzzzzzzzzz_a_built_midway_free_buy_matches_its_schedule`, refuses to
   insert, or to reshape, an unstarted Midway Free Buy whose format
   (`fn_ca_midway_free_buy_format`) differs from the one its own schedule slot
   names (`fn_ca_midway_free_buy_slot_format`). Those are the same two
   functions the digest watch reads, so the rule is written once. A refused
   build releases its spawn claim and pages the missed occurrence through the
   scheduler's existing path, and the next pass builds it again from the
   schedule. Started events are never touched.
2. `20261106004622` (installs immediately): `fn_ca_rebuild_midway_free_buy_to_its_schedule`.
   Under the cancellation lane and the event's row lock, and only when the
   format differs, the event is ANNOUNCED or REGISTERING, unstarted, more than
   20 minutes from its start, every registration is a horse and it holds a
   spawn claim, it cancels the event through `atomic_cancel_tournament` (every
   entry refunded with its receipt, the Midway promo head included, exactly
   as for a human) and releases the spawn claim in the same transaction.
3. `ScheduledTournamentService.rebuildWrongShapedMidwayOccurrences`, called
   inside each Midway schedule's own sync pass right after the time conform
   and before the spawn loop, asks for that rebuild for a claimed date whose
   built format differs (`shouldRebuildMidwayOccurrence`). A rebuilt date
   leaves the claimed set, so the same pass spawns it in the schedule's shape
   and the pre-start ramp registers the field again. A refusal (a human is
   registered, too close to start) is asked again at most every 10 minutes.

No event id appears anywhere, there is no cron, sweep or repair job, and a
human's registration always keeps the event as built.

## Tests

- `tests/a-built-free-buy-matches-its-schedule.law.test.ts` (law, registered in
  `docs/laws.d/`).
- `server/src/tournament/midwayFreeBuyRebuild.test.ts` (the pure predicates).

## Note

The Prime Time Free Buy of 2026-11-05 (1d115ff4) starts at 02:30 UTC on
2026-11-06, before this engine change can be released at the daily 04:00
Chicago window, so it runs as built.
