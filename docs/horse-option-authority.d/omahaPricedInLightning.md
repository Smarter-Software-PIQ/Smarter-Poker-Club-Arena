# omahaPricedInLightning: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago. Evidence NOT MET: the option stays OFF.

## What it does

A scope option. Every priced PLO4/PLO5 cash option (the `*IsPriced` families of HorseOmahaPricedWiring.ts and the sites of HorseOmahaPricedSites.ts) acts only inside `omahaPricedInScope`, which refused every Lightning decision (`gs.publicMemoryDomain.speed === 'lightning'`). With this option on, that refusal is lifted: a priced option whose OWN switch is on also decides Lightning PLO4/PLO5 cash (the PLO5 1/2 Lightning pool is where the audited human plays). The two raise owners (`omahaTurnRiverRaiseIsPriced`, `omahaBigBetCallsArePriced`) read their turn and river spot through `omahaRaiseNeedsNutsScope`, which takes the same opening only from them; the categorical `omahaTurnRiverRaiseNeedsNuts` rule keeps its own reading and never acts in Lightning. The worker receipt validator admits the priced raise that became the call in a Lightning pool only under the decision's own option (`omahaPricedInLightningGateCandidates`, built as the priced-raise gate is).

What it does NOT do: it switches no priced option on; it changes no categorical rule's scope; it does not reach `omahaSmallBetIsPriced` (that option's scope, `omahaCardImpactScope`, never excluded Lightning: it already acts there), `omahaStrongHandSlowplayMix` (its own Lightning exclusion) or the F-02 re-raised lane (`omahaReraisedLaneUntouched`).

Scope: PLO4 and PLO5 cash, one board, high only, no bomb pot, not fixed limit, in the Lightning pools. Default OFF in source (read `=== true`). Off or unset, Lightning stays outside the priced scope and every decision is exactly as before. On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaPricedInLightning docs/horse-option-authority.d/omahaPricedInLightning.md sha256 <digest>`). Rollback: switch row off (about 30 s).

## The finding it answers

HORSE SWITCH lane (session 013U37bWhV), inbox 2026-11-18T20:08:21Z, read-only code finding at f3e99378ccbb: every `*IsPriced` option is gated out of Lightning (HorseOmahaPricedWiring.ts:92), so the priced turn/river raise (switched on 2026-11-18) changes nothing in PLO5 1/2 Lightning, while 11 of the 12 categorical rules gate on variant only and do act there. Correction recorded here: `omahaSmallBetIsPriced` is NOT gated out (its scope has no speed test; the same lane's PLAN.md F11 says so); the inbox line that lists it with the gated options is wrong on that point.

## The owner's orders it rests on (verbatim)

- 2026-11-17 11:49 America/Chicago: "there should not be any blanket rules, you need to coordinate and re write any and all "blanket rules" to be fully adaptable to real time decisions, a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."

## Receipts

omaha_priced_in_lightning_scope_seen (HorseDataLedger.ts; at most once per decision): a priced option that is on was consulted in a Lightning pool and the scope held because this option is on. Every priced family keeps its own receipts; in Lightning they fire under this option exactly as at a table.

## Tests

HorseOmahaPricedInLightning.test.ts, on every recorded PLO4/PLO5 cash decision of the horseComplaints fixtures moved into a Lightning pool, three seeds, the live categorical set on: off (unset and false) the eleven gated priced options change no Lightning decision; on, no decision outside Lightning changes; on with no priced option on, nothing changes; on with the priced options on, their receipts fire in Lightning (the same receipts as the same decision at a table) and decisions change; the receipt validator refuses the Lightning raise -> call without the option and admits it with it (and the option alone admits nothing). HorseOmahaPricedReceiptGate.test.ts unchanged. Server tsc 0.

## League

The league deals no Lightning domain. Refused matchup `plo5_omaha_priced_in_lightning` (HorseLeague.ts UNMEASURABLE_MATCHUPS, live Omaha set in both arms), as the default-off law requires. The real evaluation is the paired Lightning harness (server/src/lightning/LightningPairedEval.test.ts) on a live-base baseline: PASS-BAR in the PLO lane evidence (plo-handoff-review-01a1cbbd/lightning-013U37/PASS-BAR.md), written before any run.

## Evidence rows

- Mechanism, scope, visibility (receipt), tests, byte-identical off: MET (above).
- Replay of the real audited decisions (fixed / unchanged / newly wrong): NOT RUN. Which of the journaled PLO5 decisions were dealt in a Lightning pool is not determined.
- Value in Lightning: NOT MET. No Lightning result exists. The harness needs its live-base baseline extension first (its baseline is frozen to the seven style options of 2026-11-14 and its seed classes are closed; LightningPairedEval.test-support.ts :143, :221, :320).
- Do not switch on without a WIN under the pre-written bar.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)
