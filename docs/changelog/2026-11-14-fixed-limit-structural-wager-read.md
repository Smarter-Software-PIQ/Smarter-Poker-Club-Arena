# Fixed limit: the wager signal is structural (three opt-in options, default off)

Date: 2026-11-14. Lane: Fixed-Limit specialist (SPEC-FL-01, SPEC-FL-02, SPEC-FL-03). Prototype.

## What

- New pure module `server/src/engine/HorseFixedLimitWagerRead.ts`: the wagers
  of a street counted from the public history (`streetWagerSignal`), the
  full-bet read mark (`fixedLimitFullBetRead`), `noLowPossible`,
  `nutLowBlockersHeld`, the hi-lo nut-low river bet rule
  (`hiLoNutLowRiverBets`) and the one-bet value-raise rule
  (`fixedLimitOneBetValueRaise`, bar `FIXED_LIMIT_ONE_BET_RAISE_BREAK_EVEN`
  = 0.60).
- Three HorseDecideOpts options, each read as `=== true` (default OFF):
  - `fixedLimitRiverFullBetRead` (SPEC-FL-01). Fixed limit, river, facing a
    wager, no measured over-bluffer read: the wagerer's range read is marked
    a full bet (a raise as a raise). Hold'em: the contact sampler takes its
    own ceiling (0.9 contact, four draws; a raise wants two pair or better).
    Omaha high, and hi-lo only on a board where no low is possible: the
    aggressor tier steps as for a pot-sized bet and the made-hand stratum is
    drawn exactly (`placeOmahaPressureCombo`) instead of by bounded
    rejection. Hi-lo heads-up: the weak-high cap keeps the low half
    (`hiLoRiverLowHalfFloor` now also answers for fixed limit under this
    option). Receipt `fixed_limit_river_full_bet_read_seen`.
  - `fixedLimitHiLoNutLowRiverBet` (SPEC-FL-02). Fixed-limit hi-lo cash,
    heads-up, river unbet or checked to hero: the river-bluff module's
    `freeroll` (nut low, no high) bets every time instead of 55 percent,
    except into a station with the bare nut low. Receipt
    `hilo_nut_low_freeroll_bet`.
  - `fixedLimitRiverOneBetValueRaise` (SPEC-FL-03). Fixed-limit hold'em,
    river, exactly one wager to answer, street not capped: the value-raise
    bar is 0.60 plus the multiway and domination terms, with no
    stack-to-pot adjustment and no raise-frequency draw. The one-pair river
    raise ban, the war gate and the danger gate stay. Receipt
    `fixed_limit_river_one_bet_value_raise`.
- Options and receipts are registered in `HorseDataLedger.ts` (V94); the
  module is bound in `HorseReferenceDecisionSources.ts`; the league refuses
  the three questions with a reason (`UNMEASURABLE_MATCHUPS`: it deals no
  fixed-limit betting).
- Off is byte-identical: no extra random draws and no receipts. Measured over
  12,690 seeded decisions (nlh, plo4, plo8, flh, flo8) against the
  origin/main sources: the same action, amount and think time at every node.

## Why

Every bettor read is keyed on bet size, and a fixed-limit bet is 0.1 to 0.33
of the pot and never 20 big blinds, so each read sat at its weakest setting.
With the opponent-intelligence layer on (the production default), heads-up
on K-9-4-7-2 a river bettor's sampled range was about 37 percent no-pair
hands and bottom pair was priced at 0.35 against a price of 0.20; an
independent count against the top 35 percent of holdings plus 5 percent
bluffs gives 0.08. Live: bottom-half hands calling a river bet heads-up won
3.8 percent (n=581); two pair calling on a no-low flo8 river three-way or
more won 4.0 percent (n=480).

## Evidence

- `/Volumes/SmarterArchives/agent-evidence/extreme-archive/fixed-limit-01Gw7aDr/K-DIAGNOSIS-AND-PROTOTYPE.md`
  (root-cause lines, instrumented equities, before/after tables), `probes/out/`.
- Laws: `AFixedLimitRiverBetIsReadAsAFullBet.law.test.ts`,
  `AFixedLimitNutLowBetsTheRiverHeadsUp.law.test.ts`,
  `AFixedLimitStrongHandRaisesOneRiverBet.law.test.ts`; unit and identity
  cases in `HorseFixedLimitWagerRead.test.ts`.

## Limits

- Fixtures and a mechanism only. No league result: the fixed-limit duplicate
  league of the lane's evaluation protocol is not built, and the nightly
  league cannot deal fixed limit.
- River only. Flop and turn reads, the overcaller's range, the preflop
  3-bet and cap bands and the `callRespect` offset are not changed.
- The three-way flo8 two-pair fixtures land at the price (equity 0.07 to
  0.09 against 0.095) and fold 13 to 15 seeds of 20, not all.
- A strong multi-street line now folds second pair in a large pot (pot 40,
  4 to call, opponent 3-bet preflop, called a turn raise and led the river:
  17 folds of 20). After one river bet in a pot of 32 or 34 it still calls.
- No runtime switch delivers these options; the range-consumption receipt
  does not record the new read marks.
- Default OFF. Turning any option on needs its own evaluation and a
  `docs/horse-default-on.d/<option>.md` evidence file under the
  HorseDefaultOnNeedsEvidence law.
