# 2026-11-15: later layers keep the style read (Hold'em)

Executed reproductions on the serving source (a796551420a5) showed decision
layers that run after the hold'em opponent-style options undoing or bypassing
them while their receipts still fired. Each correction below acts only while
its named option is on, so the existing live switch still turns it off; with
the options off every decision is byte-identical to the commit before
(pinned in the new tests with the exact-replay identity and the RNG position).

## Shipped

- **Rule 1, styleTightReRaiserRespect vs the VPIP-floor cheap call-down**
  (`HorseLogic.vpipFloorCallDown`, `decidePreflopV7Glue`). A preflop fold the
  tight opener / re-raiser respect produced (the same intent without that read,
  rewound, is not a fold) is kept from the call-down unless the horse's own
  windowed VPIP is within one hand of its floor (rate < floor + 1/window).
  Receipt `style_tight_respect_fold_kept_from_floor_seen`. Lightning hold'em is
  untouched: its snapshot carries no `vpipFloor`, so the call-down never acts
  there.
- **Rule 2a, vs the V87 limp / iso-raise branch** (`HorsePreflop`). The
  suited-connector limp-reraise bluff is not taken against a raiser the tight
  read respects; the hand calls the iso-raise. The premium-pair value
  limp-reraise is unchanged.
- **Rule 2b, vs the V87 26 to 35bb reshove** (`HorsePreflop`). Bluff and blocker
  reshoves are dropped against a credibly tight 3-bettor; value reshoves are
  unchanged; the tournament utility still runs afterwards.
- **Rule 3, styleFoldBluff vs styleBigBetHonesty** (`HorseLogic` V64 river
  bluff-raise gate). With both on, the fold-bluff multiplier cannot open the
  gate against a river bet the honesty predicate
  (`HorseOpponentStyle.bigBetRespect > 0`) calls credibly value. Receipt
  `style_fold_bluff_held_by_big_bet_honesty_seen`.
- **Rule 4, styleValueBettorNotManiac** (`HorseMind.readExploit`,
  `HorseLogic.maniacCallDown`). The newer exploit read's maniac call-down
  widening is removed for a value bettor, and the postflop maniac call-down
  stands aside on his bets (hold'em family). The receipt
  `style_value_bettor_not_maniac_seen` fires once per read, where the effect
  applies.
- **Rule 5, fold-to-bet counted twice**: no behavior change; a test pins the
  consumer caps (1.3 in HorseLogic, 1.35 in `flopTurnReadFactor`).
- **Rule 6, per-decision read receipt** (journal only, accepted from the
  Human-vs-Horse lane). `HorseDecision.preflopReadReceipt`
  (`PreflopReadReceipt`, version 1) on every preflop decision facing a raise:
  layers heard, base bars (style and maniac reads taken out, rewound
  counterfactual) and final bars, strength, branch; the maniac price
  arithmetic writes consumer `maniac_price` with its required equity and width.
  Bounded (four decimals, at most 16 layer names, under 512 bytes in the
  tests). Not part of the execution witness.

## Tests

`aTightRaisersFoldIsNotBoughtBackByTheVpipFloor`,
`aLimperDoesNotBluffReraiseATightRaiser`,
`aTightThreeBettorIsNotReshovedWithABluff`,
`aFoldBluffReadDoesNotBluffRaiseAnHonestBigBet`,
`aValueBettorIsNotCalledDownAsAManiac`,
`theFoldToBetBoostStopsAtItsConsumerCaps`,
`aPreflopDecisionFacingARaiseCarriesItsReadReceipt` (server/src/engine). Each
conflict test fails on the commit before and passes after.

## Deliberately not changed

- Omaha's priced-refusal tag path, the Omaha tight block and any Lightning-only
  block.
- The premium-aggression precedence over the tight re-raiser read (declared
  blanket precedence).
- The doubled fold-to-bet multiplier itself (capped by its consumers).
