# A Tournament Cost Is Priced Against The Pool That Will Be Paid

2026-11-12. Hold'em Strategy lane. Finding HVH2D-NLH-001 of the two-day Human
vs Horse study. Engine source: `server/src/services/TournamentBrainContext.ts`.
No migration. Applies to every tournament variant, because the context
builder is shared.

## What players saw

In an All-In-Or-Fold Afternoon Free Buy (500-chip guarantee, 1-chip rebuys),
two Horses folded AKo first in at 60 big blinds, 67 seconds apart, and the
whole table folded round to the big blind.

## Cause, from the production journal

The reference policy chose the jam both times. The tournament utility arbiter
replaced it with a fold (`policyGraph` node `tournament_utility`, before
all_in, after fold). Its jam candidate carried an option value of -34.45 pool
points, which is the bust probability (0.346) times about -99.6: the price of
the automatic rebuy after a bust.

The arbiter prices every cost as a share of the prize pool. The context
builder fed `tournaments.prize_pool` as that pool, and before finalization
that column holds only what entries have paid in so far: 1 chip. So a 1-chip
rebuy was 100% of the pool. The event paid its 500-chip guarantee, against
which the same rebuy is 0.2%.

## The correction

`deriveContext` now prices the larger of the collected pool and the advertised
guarantee (`tournaments.guaranteed_prize`) until the pool is finalized. A
finalized pool is read as written. A row with no readable guarantee prices
exactly as before. The recovery's prize contribution is reported as what it
adds to that paid pool: nothing while the collected pool is under the
guarantee, the part above it when the purchase crosses it, all of it after.

## Proof

`server/src/services/ATournamentCostIsPricedAgainstThePoolThatWillBePaid.test.ts`,
13 cases. The builder cases fail on the old builder (3 of 13 fail) and pass on
the new one. The decision cases replay the anonymised decision-time request
from the journal (seats and stacks only): with the feed as recorded the
arbiter folds, as production did; with the corrected feed the option value
falls from about -34 to under 0.05 in size and the jam stands.

## Limits

- The add-on branch of the arbiter still adds the full add-on cost to the
  pool when it values an add-on. Under an unmet guarantee that overstates the
  pool after the add-on by the add-on cost. It is a smaller effect in the same
  direction and is not changed here.
- The arbiter's estimate for this spot rests on 32 sampled outcomes. With the
  pool corrected, jam and fold are within a hundredth of a pool point on the
  recorded sample; the arbiter keeps the reference policy because it has no
  grounds to overrule it, not because the jam is shown to be better.
- Scope in the frozen two-day interval, eligible hands only: 10 free-buy
  tournaments with 4,082 rebuy-open Horse decisions, and 8 guaranteed paid
  events with 7,067. How many of those decisions the old pricing changed is
  not known beyond the exported originals.
- Not live until an engine release contains it.
