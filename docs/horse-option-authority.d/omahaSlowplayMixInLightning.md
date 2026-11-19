# omahaSlowplayMixInLightning: authority for the live switch

PLO Strategy lane, 2026-11-19. NOT EVALUATED. Evidence NOT MET: the option stays OFF.

## What it does

A scope option. `omahaStrongHandSlowplayMix` (HorseOmahaStrongHandSlowplayMix.ts) reads its game through `inGame`, which refused every Lightning decision (`gs.publicMemoryDomain.speed === 'lightning'`). With this option on, that one refusal is lifted: when `omahaStrongHandSlowplayMix`'s OWN switch is on, its two mixes (a final raise facing a bet with a nut-class hand becomes the exact call at the spot's frequency; a flop bet with a set on a very dry flop becomes a check at the spot's frequency) are made in Lightning PLO4/PLO5 cash exactly as at a table: the same public spot, the same frequency, the same single draw from the derived stream (the strategy stream is read, not advanced). The worker receipt validator admits the mix's two conversions in a Lightning pool only under the decision's own option (`omahaSlowplayMixInLightningGateCandidates`, built as the omahaPricedInLightning gate is), in the mix's own spot, with a nut-class hand and for the exact chips of the call.

What it does NOT do: it switches the mix on nowhere by itself (with `omahaStrongHandSlowplayMix` off it changes nothing); it changes no other rule's scope (not the priced families of `omahaPricedInLightning`, not the public bet size of `omahaPublicBetSizeInLightning`, not the re-raised lane of `omahaReraisedPositionInLightning`); it adds no rule, no size and no frequency of its own.

Scope: PLO4 and PLO5 cash, pot limit, one board, high only, no bomb pot, in the Lightning pools. Default OFF in source (read `=== true`). Off or unset, Lightning stays outside the mix and every decision is exactly as before. On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaSlowplayMixInLightning docs/horse-option-authority.d/omahaSlowplayMixInLightning.md sha256 <digest>`). Rollback: switch row off (about 30 s).

## The finding it answers

PLO lane, lightning-013U37/CHECKPOINT.md "Lightning scope resolution" (serving f3e99378ccbb): there is one Lightning path, the speed is set only by the host, and `omahaStrongHandSlowplayMix` is gated out of it by a speed test (HorseOmahaStrongHandSlowplayMix.ts inGame). The measured winning human plays the Lightning pools, so a mix that is switched on at the tables changes nothing where he plays. The lead (session 01TLQer7J) asked for one default-off scope option per gated scope so each can be evaluated alone.

## The owner's orders it rests on (verbatim)

- 2026-11-17 11:49 America/Chicago: "there should not be any blanket rules, you need to coordinate and re write any and all "blanket rules" to be fully adaptable to real time decisions, a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."
- 2026-11-15 14:13 (the mix itself, see omahaStrongHandSlowplayMix.md): "ITS OK FOR HORSES TO JUST CALL".

This option decides nothing by itself: it only opens a place where an existing rule may act. The mix it opens is a mixed frequency whose constants are a builder's choice, none measured (omahaStrongHandSlowplayMix.md); that limit is unchanged in Lightning and is part of what the evaluation has to answer.

## Receipts

omaha_slowplay_mix_in_lightning_scope_seen (HorseDataLedger.ts; at most once per decision): the mix read a final raise or flop bet in a Lightning pool and its public spot held because this option is on. The mix keeps its own receipts (omaha_strong_hand_slowplay_call, omaha_strong_hand_slowplay_check); in Lightning they fire only under this option.

## Tests

HorseOmahaScopesInLightning.test.ts: the scope (Lightning outside both spots unless the option is on; a table the same either way); off (unset, false, a non-boolean) the mix changes no Lightning decision and no stream position; on outside Lightning nothing changes; on with the mix off, and the other Lightning scope options alone, nothing changes; on in Lightning the mix makes only its raise -> call (exact chips) and its flop bet -> check, with the scope receipt; the validator refuses the turn raise -> call and the flop bet -> check of a Lightning decision without the option and admits them with it, never for other chips or a hand that is not nut class, and the omahaPricedInLightning gate does not admit them; the candidate gates; on the recorded PLO4/PLO5 cash decisions (horseComplaints fixtures) off in Lightning and on at a table are the same decisions. HorseOmahaStrongHandSlowplayMix.test.ts unchanged and passing. Server tsc 0.

## League

The league deals no Lightning domain. Refused matchup `plo5_omaha_slowplay_mix_in_lightning` (HorseLeague.ts UNMEASURABLE_MATCHUPS, the mix on in both arms). Inert there by construction, and measured 2026-11-19 by running the refused matchup through runMatchup: 0 of 300 pairs diverged (run seed 20261119, status inert; archive plo-handoff-review-01a1cbbd/stack0400-01TLQer7J/measure/). The real evaluation is the paired Lightning harness (server/src/lightning/LightningPairedEval.test.ts, a switch card on the live base, E1) under the pre-written bar: PLO lane evidence plo-handoff-review-01a1cbbd/ltgscopes-01TLQer7J/PASS-BAR.md and card-omahaSlowplayMixInLightning.json, written before any run.

## Evidence rows

- Mechanism, scope, visibility (receipt), tests, byte-identical off: MET (above).
- Replay of the real audited decisions (fixed / unchanged / newly wrong): NOT RUN.
- Value in Lightning: NOT MET. NOT EVALUATED: no Lightning result exists for this option.
- Do not switch on without a WIN under the pre-written bar.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)
