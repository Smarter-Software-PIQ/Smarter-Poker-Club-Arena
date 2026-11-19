# omahaPublicBetSizeInLightning: authority for the live switch

PLO Strategy lane, 2026-11-19. NOT EVALUATED. Evidence NOT MET: the option stays OFF.

## What it does

A scope option. `omahaBetSizeByPublicState` (horsePublicBetSize.ts, HorseLogic.omahaBetSizeByPublicStateRule) reads its game through `HorseLogic.publicBetSizeInGame`, which refused every Lightning decision (`gs.publicMemoryDomain.speed === 'lightning'`). With this option on, that one refusal is lifted: when `omahaBetSizeByPublicState`'s OWN switch is on, the size of the Horse's own postflop bet or raise in Lightning PLO4/PLO5 cash is chosen from public information only, exactly as at a table (the same public spot draws the same size from the same public stream). Every consumer of the public size (the quiet size the priced and plan rules ask for) goes through the same game test, so it opens for them together and for nothing else.

What it does NOT do: it switches the public size on nowhere by itself (with `omahaBetSizeByPublicState` off it changes nothing); it never decides a bet against a check, a call or a fold (the size chooser cannot: aBetSizeIsPublicInformationOnly.law.test.ts); it changes no other rule's scope (not the priced families of `omahaPricedInLightning`, not the slowplay mix of `omahaSlowplayMixInLightning`, not the re-raised lane of `omahaReraisedPositionInLightning`).

No receipt-validator change. The chooser's wager is still a bet, a raise or the all-in the legalizer makes of a commitment size; the validator admits a wager_rules step that ends in a bet, a raise or an all-in at any speed, so the decision path can emit nothing in Lightning that was not already admitted (proved in the test below with no gate passed).

Scope: PLO4 and PLO5 cash, pot limit, one board, high only, no bomb pot, uncapped wagers, postflop, in the Lightning pools. Default OFF in source (read `=== true`). Off or unset, Lightning stays outside the public size and every decision is exactly as before. On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaPublicBetSizeInLightning docs/horse-option-authority.d/omahaPublicBetSizeInLightning.md sha256 <digest>`). Rollback: switch row off (about 30 s).

## The finding it answers

PLO lane, lightning-013U37/CHECKPOINT.md "Lightning scope resolution" (serving f3e99378ccbb): `publicBetSizeInGame` is gated out of Lightning by a speed test. The measured winning human plays the Lightning pools, so the public size, where it is switched on at the tables, changes nothing where he plays. The lead (session 01TLQer7J) asked for one default-off scope option per gated scope so each can be evaluated alone.

## The owner's orders it rests on (verbatim)

- 2026-11-17 11:49 America/Chicago: "there should not be any blanket rules, you need to coordinate and re write any and all "blanket rules" to be fully adaptable to real time decisions, a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."
- 2026-11-15 (the public size itself, see omahaBetSizeByPublicState.md): "HE GETS THEM TO FOLD WHEN HE WANTS A FOLD, AND GETS A CALL WHEN HE WANTS A CALL"

This option decides nothing by itself: it only opens a place where an existing rule may act. The rule it opens is a size chooser from public state whose constants are a builder's choice, NOT MEASURED, and not a priced comparison (omahaBetSizeByPublicState.md, Limits). It changes how much is wagered, never whether; whether that stands under the no-blanket-rules order in Lightning is for the evaluation and the owner's review, and is stated here so it is not read as settled.

## Receipts

omaha_public_bet_size_in_lightning_scope_seen (HorseDataLedger.ts; at most once per decision): the public size read the Horse's own postflop bet or raise in a Lightning pool and its game held because this option is on. The public size keeps its own receipts (omaha_public_bet_size_applied, \_committed, \_unchanged, \_nut_class_kept, \_illegal_kept); in Lightning they fire only under this option.

## Tests

HorseOmahaScopesInLightning.test.ts, on two recorded public states (PLO5 cash hand 59416584: a turn decision first to act, a flop decision facing a bet) with 60 private hands each, moved into a Lightning pool: off (unset, false, a non-boolean, the option alone, the other scope option) the whole decision is identical, wall-clock stamps aside; on outside Lightning the whole decision is identical; on in Lightning the action is the option-off action (or the all-in of a commitment size), the amount is the size the same spot draws at a table, the scope receipt fires once, and the validator with no gate admits every decision; on the recorded PLO4/PLO5 cash decisions (horseComplaints fixtures) off in Lightning and on at a table are the same decisions, and each scope option opens only its own rule. HorseBetSizeByPublicState.test.ts and aBetSizeIsPublicInformationOnly.law.test.ts unchanged and passing. Server tsc 0.

## League

The league deals no Lightning domain. Refused matchup `plo5_omaha_public_bet_size_in_lightning` (HorseLeague.ts UNMEASURABLE_MATCHUPS, the public size on in both arms). Inert there by construction; this matchup was NOT run through runMatchup (no league run was allowed while it was built): its refusal cites the sibling plo5_omaha_priced_in_lightning measurement (0 of 300 pairs diverged) and says its own 300-pair run is owed. The real evaluation is the paired Lightning harness (server/src/lightning/LightningPairedEval.test.ts, a switch card on the live base, E1) under the pre-written bar: PLO lane evidence plo-handoff-review-01a1cbbd/ltgscopes-01TLQer7J/PASS-BAR.md and card-omahaPublicBetSizeInLightning.json, written before any run.

## Evidence rows

- Mechanism, scope, visibility (receipt), tests, byte-identical off: MET (above).
- Replay of the real audited decisions (fixed / unchanged / newly wrong): NOT RUN.
- Value in Lightning: NOT MET. NOT EVALUATED: no Lightning result exists for this option. The Lightning harness's opponents are Horses, which do not read bet sizes; a harness result can show only that the public sizes do not cost chips there.
- Do not switch on without a WIN under the pre-written bar.
