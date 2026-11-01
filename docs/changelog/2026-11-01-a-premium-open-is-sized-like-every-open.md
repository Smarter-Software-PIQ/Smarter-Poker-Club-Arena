# A premium open is sized like every other open (2026-11-01)

Follow-up to V74 (#9116, `HorseNlhOpenSize.ts`). Rule 2 of the hold'em
premium rules turns a premium's limp or check in an unopened pot into an open.
It raised to a fixed 3bb plus 1bb per limper, while every other open draws
its size from V74's card-blind band. On a cents table a premium therefore
opened to an exact, recognisable number, which is a hand-strength sizing tell
(the owner's constraint is that open sizes never depend on the hand).

Rule 2 now takes the open from the same V74 draw (`openRaiseTo`, built in
`HorseLogic.holdemPremiumOpenRaiseTo` from seat, depth, format, antes, table
size, limpers and the straddle). The fixed 3bb remains only as the
V74-ablated (`v74NlhOpenSizes: false`) arm. Rule 2's other sizes are
unchanged: 3x over one raise and 2.3x over a 3-bet.

Tests: `HorseHoldemPremiumAggression.law.test.ts` checks that an AA limp on a
0.05/0.10 table becomes a 0.25-0.40 open with a spread of sizes, and that the
ablated arm returns 0.30. Related suites: 56 files, 1,297 tests pass.
