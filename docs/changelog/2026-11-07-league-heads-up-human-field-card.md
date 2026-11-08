# League: a heads-up human-field card for hu_bb_defends_to_price

Date: 2026-11-07

## Why

`huBbDefendsToPrice` (#9936, default OFF) fixes a heads-up big blind that
folds 57.4% to a 71.3% small-blind open. Its only league card,
`hu_bb_defends_to_price`, is horse against horse and read
**+0.37 +/- 0.31 bb/100** over 2,000,000 hands: unresolved, against a small
blind that opens what horses open. The leak is about a human who opens most
buttons, and every human-field card was six-max (`humanFieldTwin` refuses
anything else; the calibrated NLH profile was fitted on six-max tables and,
dealt heads-up, folds 61% of its small blinds).

## What

- **Persona** `hu_wide_sb_aggressor_v1` (`HorseLeagueHumanField.ts`,
  profile from `humanFieldPersonaProfile` in `HorseLeague.ts`): the
  calibrated NLH profile with heads-up human tendencies, in the same way the
  river-bluff league's stations and folders override calibrated cutoffs
  (`rblmTendencyProfile`). Small blind first in: fold < 0.20, raise >= 0.30
  (plays 80%, opens 70%). Facing a raise: fold < 0.40, raise >= 0.85
  (defends 60%, three-bets 15%). Big blind over a limp raises 35%. Checked
  to, it bets at equity >= 0.35 / 0.42 / 0.50 on flop / turn / river (stabs
  most flops). Facing a bet postflop it keeps the calibrated cutoffs. It is
  a development persona, not a calibrated population; it is refused anywhere
  but the heads-up NLH calibrated field.
- **`LeagueMatchup.humanPersona`**: every field seat plays that persona. The
  stored `config_a` / `config_b` carry `humanPersona` next to
  `opponentPopulation`, so a row says what it was measured against. A
  persona without a human field is refused.
- **`hybridBaseline` on a human-field card**: now the hero horse's persona
  and dials in both passes (it was refused). The field never reaches
  HorseLogic, so it is unchanged. `productionStyles` stays mirror-only.
- **Card** `human_hu_bb_defends_to_price`, pushed onto `LEAGUE_MATCHUPS`
  after the six-max twins, so the nightly runner deals it, stores it and
  pools it like every other card: the mirror's arms (`a` flag on, `b` off),
  heads-up, 80bb, cash Hybrid hero, deal-seeded mood clock,
  `HUMAN_FIELD_PAIRS` (12,000) pairs, human-calibrated field playing
  `hu_wide_sb_aggressor_v1`. The dealer rotates every pair, so the hero
  plays the small blind and the big blind equally often.

The flag default is **not** changed. The owner's rule turns it on only after
the nightly league confirms it across runs.

## Local measurement

`runMatchup(human_hu_bb_defends_to_price, 31,250 pairs, seed)` on 32 seeds
(20261107 + 7919 i, i = 0..31), `EQUITY_GOVERNOR=off` as the league worker
runs, pooled by pair count:

| seeds      | hands     | bb/100 (A - B)     | divergent pairs |
| ---------- | --------- | ------------------ | --------------- |
| i = 0..15  | 1,000,000 | +2.07 +/- 0.95     | 6.95%           |
| i = 16..31 | 1,000,000 | +2.65 +/- 0.96     | 7.05%           |
| **all**    | 2,000,000 | **+2.36 +/- 0.67** | 7.00%           |

Arm A (flag on) +32.84 +/- 1.63 bb/100 against the persona, arm B +30.48
+/- 1.58. 0 illegal actions, 0 truncated streets. Positive and past two
standard errors in each independent half: against a wide-opening human the
big blind's price-based defence earns. This is one local run of a
development persona; the nightly card is the confirmation the switch-on
rule reads.

## Tests

- `HorseLeagueHumanFieldHeadsUp.test.ts` (new): the persona's cutoffs and
  that facing-bet nodes stay calibrated; refusal outside heads-up NLH
  calibrated and without a human field; the card's shape and stored config;
  a 300-pair run in which the hero plays both blinds on the Hybrid persona,
  the field raises > 60% first in and bets > 50% of flops checked to it,
  and the compute boundary accepts the result.
- `HorseLeagueHybridBaseline.test.ts`: a human-field card with
  `hybridBaseline` plays the hero on the cash Hybrid style and dials;
  `productionStyles` on a human-field card is refused.
- `HorseLeagueHumanField.test.ts`: the new card is on the expected human
  card list, its two arms diverge against the field, and the nightly runner
  sends it to the worker and stores it with its field and persona.
