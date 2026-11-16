# Hold'em next package: the review notes (receipts, the commit-path test, one proof line)

**Date:** 2026-11-16
**Area:** Horse brain (no-limit hold'em), decision worker tests, option switch proof

## What changed

Nothing a player can see, and no decision changes. Three counters and two tests close the notes Hand Analysis left on the Hold'em next package (#11033).

- `holdemPersonaPostflop` now counts all four places its scales act: the flop check-trap and the turn takeaway already had counters; the dry-board range c-bet (`holdem_persona_postflop_cbet_seen`) and the flop check-raise into a stabber (`holdem_persona_postflop_check_raise_seen`) now have theirs.
- `tournamentUtilityStackScaledMargin` has its own counter (`tournament_utility_stack_scaled_margin_seen`): each tournament decision selected by the utility comparison with the margin in force.
- The decision worker has a full commit-path test for the live-switch case: a switch row turns `holdemProfileCompletenessCap` on, a FAST decision issues a plan batch, and the table's commit of that batch is applied. It fails on the code before the request-identity fix.
- The option switch database proof now installs the evidence-record migration with a non-style option already on, and checks that row survives.

## Limits

The counters fire only while their option is on; all of these options are off by default. The commit-path test fixes the wager to a legal bet so that a plan batch is issued; the reads it watches are the real decision's.
