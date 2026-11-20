# omahaMadeHandBetIsPriced: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago. Build: sites-013U37 (plo-handoff-review-01a1cbbd/sites-013U37/DESIGN.md, PASS-BAR.md). Evidence NOT MET: the option stays OFF.

## What it does

PLO4/PLO5 cash, turn and river, nothing to call: in the spot where the made-hand defence checks a wager (a hand a possible straight or flush beats does not bet into the fresh turn card out of position; no thin river value bet), the wager is priced beside the check against every live opponent, whatever his label. It stands when it is priced at least at the check, else it is checked. The same answer is used by the outermost re-check (`omahaWagerIsChecked`).

Scope: PLO4 and PLO5 cash, one board, high only, no bomb pot, not Lightning, not fixed limit (`omahaPricedInScope`). It acts where the rule it replaces acts; out of scope, and with the option unset or false, every decision is exactly as before.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaMadeHandBetIsPriced docs/horse-option-authority.d/omahaMadeHandBetIsPriced.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-17 11:49 America/Chicago: "there should not be any blanket rules, you need to coordinate and re write any and all "blanket rules" to be fully adaptable to real time decisions, a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."
- 2026-11-17, earlier the same day: the size of the bet must not make or break a decision.

## The rule it replaces

`omahaBeatenMadeHandDefense` (off-only in the live switch) and `omahaMadeHandDefenseVsValueLeader` (`omahaBeatenNoBet` in `omahaMadeHandDefenseRules`, HorseLogic.ts; HorseOmahaMadeHandDefense.ts): the bet half decides by hand category and, for the second, by the measured value-leader label. Their raise half is priced by `omahaTurnRiverRaiseIsPriced` (outermost) and is not changed here.

That rule stays in source and keeps deciding while this option is off: it is live production behaviour.

## The priced comparison

`omahaPricedSitesMadeHandBet` (HorseOmahaPricedSites.ts) on `omahaPricedBet`: the proposed wager row beside the check, the card-impact response model against every live opponent.

The opponent read comes through one interface (`omahaPricedReadOfUser`, HorseOmahaPricedWiring.ts): the pooled read without its labels, and the per-street, per-texture cells through `omahaPricedSetStreetRatesSource` when that read is delivered. No prior, bluff share or bet-rate factor is computed in HorseOmahaPricedSites.ts: they are those of `omahaPricedBet` / `omahaPricedCardImpactRead` (HorseOmahaPricedRules.ts), so a fix there (the opponent-kind prior of the priced2 build) reaches this option with no edit. Every opponent range is drawn from the cards the Horse does not hold. A spot that cannot be priced keeps the engine decision with an `_unpriced_kept` receipt.

## Receipts

omaha_priced_site_made_hand_bet_kept, \_checked, \_unpriced_kept (HorseDataLedger.ts).

## Tests

HorseOmahaPricedSites.test.ts (off and out of scope change nothing; each answer is the priced comparison; unpriced spots keep the decision; whole decisions with every site on are legal and fail no rule), HorseOmahaNoBlanketRule.law.test.ts (the site is registered; with the priced options on its legacy receipt does not decide).

## Evidence rows

- Mechanism, scope, visibility (receipts), tests: MET.
- Replay on audited real decisions (PASS-BAR section 1): FAIL (pooled over audit2 no read, audit2 winner read, Nov 16 winner read: 3 fixed, 5 newly wrong; judge +159 bb). Archive plo-handoff-review-01a1cbbd/sites-013U37/REPLAY-20261118.md.
- League (PASS-BAR section 2): NOT RUN (sequenced after the opponent-kind prior fix).
- Overall: NOT MET. Do not switch on.

## Batch integration 2026-11-18 (PLO option batch, agent/plo-batch-013U37/feat/omaha-option-batch)

**OFF-ONLY** (ploFailed in HorseOptionSwitch.ts): the replay on audited real decisions FAILED its bar (sites-013U37/REPLAY-20261118.md: pooled 3 fixed, 5 newly wrong; judge +159 bb, n 14). Do not switch on.

League cards (HorseLeague.ts, declared, not run): plo4_omaha_made_hand_bet_is_priced and plo5_omaha_made_hand_bet_is_priced: the live options of 2026-11-16 in both arms, arm A adds omahaMadeHandBetIsPriced.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: LEGACY (as of 2026-11-19 this file records a replay in prose only; it was not written by the scorer's --row, so the scorer commit and the validity of its arms' option sets are not recorded. A row needs a new run)
