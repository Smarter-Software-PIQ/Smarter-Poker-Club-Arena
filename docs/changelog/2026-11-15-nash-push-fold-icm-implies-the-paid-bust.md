# nashPushFoldIcm implies the paid-bust valuation

Hand Analysis note D1 on #11008: `nashPushFoldIcm` prices its short-stack read through the bubble factor. With it on and `icmBustPaysPlace` off, the 2.1bb stack of hand 59441335 read the cap of 5 again, because a bust in a paid place was valued at zero.

`HorseLogic.decide` now opens the paid-bust scope when either option is true. Both stay default OFF, so an unset decision is byte-identical. `nashPushFoldIcm` is still off-only under the owner's preflop range hold; this only makes sure that lifting the hold cannot bring the cap back.

Pinned in `AShortStackJamPricesThePayJump.law.test.ts`: `nashPushFoldIcm` alone decides exactly as the pair, seed for seed.
