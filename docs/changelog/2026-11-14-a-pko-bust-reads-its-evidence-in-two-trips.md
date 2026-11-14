# A PKO bust reads its evidence in two trips (2026-11-14)

Incidents #3 (bust backlog) and #2 (frozen tables) on Midnight Free Buy (NLH)
b6d94533, a 496-entry PKO. Rebuys closed at 01:30 CST; from 01:30 to 01:58
CST busts arrived at 20-34 a minute, were recorded at about 13 a minute, and
waited a median 440 s (570 s max). Unrecorded busts blocked the synchronized
break (`source_roster_disagrees:bust_unrecorded`, 19 lines at 01:30-01:43) and
held their chairs. The frozen tables were that event's tournament tables
18, 33 and 54, not PLO cash feeders as first reported.

## Evidence (read-only)

- Production rows: no rebuy prompt was opened after 01:30 (7 of 355 eliminated
  candidates carry one), so the rebuy-decision window did not hold the batch.
- Inspector run 43618446252 (PR #10829), window 07:28-07:58Z, focus b6d94533:
  360 `Eliminated` and 360 `BOUNTY (pko)` lines, one claim failure (01:29:40),
  no evidence deferral, no write failure, no scheduler stall.
- Engine-01 Prometheus, 01:30-01:50 CST: elimination scheduler queue depth 0
  and oldest wait 0 throughout (admission is not the limit);
  `eliminatePlayer` used 886 ms of every second of the sweep lane at a 3.9 s
  mean, 13.5 calls a minute. No other step exceeded 70 ms/s.
- pg_stat_statements: the knockout door averages 127 ms and the payer 200 ms.
  The rest of each bust's ~2.6 s (median) is about 13 sequential PostgREST
  trips of ~200 ms. Busts must be recorded one at a time in hand order (PKO
  watermark), so trips per bust set the event's ceiling.

What was first read as "passes of 2-3 busts" is the same serial loop: the
4-22 s gaps are slow `eliminatePlayer` calls (the 3.9 s mean against a ~2.6 s
median), not pass boundaries.

## Fix

`loadPersistedBountyEvidence` sent four dependent-looking reads in a row. The
live-seat veto needs only the user id and now travels with the candidate; the
atomic receipt and the hand need only the candidate's identity and now travel
together. Four trips become two, about 0.4 s of every PKO bust. Checks run in
the same order on the same rows; nothing is written; the door re-proves under
its lock. Ordering, the PKO watermark, simultaneous-bust rules, bounty
attribution, payout idempotency and horse/human treatment are unchanged.

Expected ceiling after the fix: about 2.2 s per bust, roughly 27 a minute at
the measured trip latency, against the 20-34 a minute this event produced at
its peak. The remaining per-bust trips (door, obligation proof, payer, settled
marker, names, broadcasts) are each load-bearing; the next step if a larger
event outruns the loop is overlapping the next bust's reads with the current
bust's settlement.

Law: `server/src/tournament/aPkoBustReadsItsEvidenceInTwoTrips.law.test.ts`
(fails on the previous code, passes now).
