# An empty event's cancel does not wait for a top-up that cannot fill it (2026-11-20)

Incident `08527ca7-f292-47e2-a208-edc86187a62b`, TournamentNeverStarted, 19:45:56 UTC.

## What happened

Three "Daily 25 Chip Freezeout" boards started at 19:00 UTC with nobody
registered: `63aa5773` (Poker Club 3f4fcf8f, a player's one-member club),
`f2f6408b` (Cert RH 58794518) and `fd43c3ee` (Crest Cert 1794950026440-vqxq6),
two of them certification fixtures from Nov 17 runs whose cleanup never
retired them. None of the three clubs has a horse member.

An empty registration-first event is cancelled 30 minutes past start, but only
after a past-start horse top-up has come back empty
(`tournament/emptyPastStartEvent.ts`). The engine was cut over at 19:05-19:08
UTC ("Deployment Recovery", release 26c2e749). The restart cleared every
in-memory top-up clock. The durable count only exists once a top-up has
settled, and none had settled in the five minutes after start. After the
restart every past-start board asked for a top-up at once through
`PAST_START_TOP_UP_CONCURRENCY = 4` slots. So the three cancels, due at 19:30,
landed at 19:46:10, 19:47:34 and 19:47:52. `fn_tournament_metrics` counts an
empty event as overdue from start + 40 minutes, so the gauge read 3 from 19:40
and the alert fired at 19:45:56.

The same thing happened on 2026-10-25 (`501008e1`). That fix took the cancel
call off the top-up queue, but the cancel's precondition was still waiting on
that queue.

## Root fix

The top-up draws only from the host pool (`clubMemberIdsForTournament`: the
host club's members, or the union's). A pool with no horse can never be filled
by it. When an empty event's cancel is due on every count except the empty
top-up, the discovery pass now reads once whether that pool holds any horse
(`TournamentRecurringService.hostPoolHasHorse`, cached five minutes per event,
and an unreadable pool is not cached). If the complete read finds no horse,
the cancel goes ahead at 30 minutes, whatever state the top-up queue is in.
A pool that has a horse, or that could not be read, still waits for the top-up
as before, so a club whose horses can fill the event still plays it.

Nothing else in the predicate changed: an entrant, an unread roster, a
finalized pool, a seat-first board or less than 30 minutes past start each
still refuses the cancel.

## Pinned

`server/src/tournament/anEmptyPastStartEventIsCancelled.test.ts`, section "an
empty past-start event whose pool has no horse".

## Residue

The two certification fixtures (Cert RH 58794518, Crest Cert
1794950026440-vqxq6, plus Preset Crest Cert 179495002644) still hold active
daily schedules. They are drained by the operator-run Cert Residue Sweep
(`cert-residue-sweep.yml`). With this fix their daily empty boards cancel at
30 minutes and no longer page.
