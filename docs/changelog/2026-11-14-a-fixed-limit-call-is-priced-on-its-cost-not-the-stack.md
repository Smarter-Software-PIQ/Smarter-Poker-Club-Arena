# A fixed-limit call is priced on its cost and the action behind, not as a stack commitment (opt-in)

Fixed-Limit lane, 2026-11-14. New `HorseDecideOpts.fixedLimitCallIsNotACommitment`, read only as `=== true` (default off). Diagnosis: agent evidence `fixed-limit-01Gw7aDr/L-ADAPTATION-DIAGNOSIS.md` section 3; implementation record: `N-ADAPTATION-FIX.md` section F2.

## The defect

HorseLogic's commitment test (`committedLegacy`, and the V66/V86/V87 recomputation) reads a stack-to-pot ratio under 1.2, or 30 percent of the stack already in, as "the money is in" and prices the call in the committed branch: pot odds plus 0.02 plus the V20 multiway bar `commit20` (up to 0.12) plus raised-class shades. A multiway fixed-limit pot outgrows a 50-big-blind stack by the river, so every one-bet river call there was priced as a stack-off. In the lane's diagnostic harness (flo8, six seats, against scripted maniacs; diagnostic only, the harness is not validated against production) every river fold took that branch, at a mean required equity of 3.4 times the price.

## The change

With the option on, a fixed-limit call is never committed: there is no stack-to-pot or invested-share term in fixed limit. The call goes to the V38 river or flop/turn verdict, priced by `HorseFixedLimitCallPrice.ts` on its incremental cost and the remaining action of the street:

- a closing call (no live player left to act behind, the street capped, or the caller all in after calling) at the bare call plus rake, `toCall / ((pot + toCall)(1 - rake))`;
- otherwise above it: with `p = 1 - (1 - 0.12)^playersBehind` and expected further wagers `e = unit (p + p^2 + ... + p^wagersLeft)` (at most the stack left), `(toCall + e) / ((pot + toCall + 2e)(1 - rake))`.

The excess over the bare price is a shade on the equity the verdict is handed, the way the V61/V65/V66 shades are. The next street's wager is not added: the flop/turn verdict prices later streets with its own realization factor; the river has none. The per-player raise rate 0.12 is an assumption, not a measurement (evidence row 4 is open), which is one reason the option stays off.

## Receipts

`fixed_limit_call_not_a_commitment_seen` (the stack test would have committed the call) and `fixed_limit_call_priced_remaining_action_seen` (a call priced above the bare call), both in HorseDataLedger. The league cannot deal fixed limit, so the option is a refused matchup (`UNMEASURABLE_MATCHUPS`) with its reason.

## Tests

`server/src/engine/AFixedLimitCallIsNotACommitment.law.test.ts` (docs/laws.d entry): the closing call is the bare call plus rake and a call with players behind and wagers left is above it (formula pinned, no stack term); the players left to act and the wagers left are read from a real HandController street, including a capped one; on a real table the first caller with players behind is priced above the bare call and the closing caller is not; facing one river bet, flo8 at six and four seats and flh at four seats continue or fold the same at 40 chips as at 1,000; with the option off the short stack folds calls the deep stack makes.
