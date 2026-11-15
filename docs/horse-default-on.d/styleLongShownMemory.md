# styleLongShownMemory (branch holdem/reads-responses-memory-20261115; pull request number at push)

This option is DEFAULT OFF (`opts.styleLongShownMemory === true`). This file is the evidence gathered so far and what is still owed.

## Mechanism

The style read's river size buckets (river first bets by size, shown, shown strong) may take a bucket from the opponent's durable shown river record (horse_exact_profiles.shown_river, migration 20261115144258) when the record holds more shown bets than the in-process 72-hour bucket; never the sum. Off, the read uses the 72-hour bucket only, as before.

## Input fidelity

The record is written forward only by fn_horse_exact_accept_hand from public showdown data (shown when listed, strong only for unmucked two pair or better), with a half-life of 40 shown river bets. No back-fill, no replay of history. Cash and tournament are kept apart by key.

## Value

Not measured. Owed: a declared evaluation against people. The problem it addresses is measured: one value-heavy account had 1 shown river bet in the 72-hour window against 13 in 14 days, and the read needs 3.

## Continuation

It changes only the evidence behind the existing value-bettor and big-bet honesty reads; their consumers are unchanged.

## Reach

Refused league matchup nlh_long_shown_river_memory: league hands have no pooled public rows or worker, 0 of 300 pairs diverged. Live reach depends on the record accumulating after the migration installs.

## Scope

Hold'em style read, exact rows only, through the live worker (FAST, DEEP and exact replay read the same buckets, read frame v16).

## Visibility

Receipts style_long_shown_memory_seen and style_long_shown_memory_older_seen. Ledger flag styleLongShownMemory.

## Limits

Forward-only, so the record starts empty at install. Off is byte-identical (tested in aShownRiverBettorThroughTheWorker.test.ts).

## Owner-ordered activation (2026-11-15)

Owner, 12:10 Chicago (verbatim, recorded in plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261115-1000-PLO-CHAT-VERBATIM.md): "NO YOU NEED TO LAUNCH EVERYTHING EVERY SINGLE THING WE IMPROVED AND BUILT AND TALKED ABOUT... GET IT ALL LAUNCHED AS SOON AS POSSIBLE FOR PLO AND HOLDEM, EVEN IF IT TAKES A COUPLE MORE HOURS TO GET IT DONE, IT HAS TO BE ALL TOGETHER, ACTIVATED, THEN WE CAN DO REAL TIME TESTING AGAINST HUMANS AND INSIDE YOUR TEST ARENA". 12:14: "IT DOESN'T NEED TO BE TESTED BY YOUR SIMULATION. JUST FULLY BUILT AND READY TO BE TESTED AGAINST HUMANS AND YOUR SIMULATION AFTER ITS LAUNCHED, ACTIVATED AND TURNED ON".

Status: OWNER-FORCED. Evidence rows above that say "not measured" are NOT MET; a live read against people is owed after activation. The source default stays OFF. The option is switched ON by a live switch row (fn_ca_horse_option_switch_set) once the build carrying it serves, and switched OFF in about 30 seconds by its owner (Hold'em Strategy) if harm is established; clearing the row returns it to the source default.
