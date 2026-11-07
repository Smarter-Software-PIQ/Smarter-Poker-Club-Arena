# The Fast Call-Down Read (2026-11-07)

Branch `horse/fast-calldown-adaptation`. The river bluff layers added on 2026-11-06 and 2026-11-07 (heads-up baseline #9803, multiway #9842, out-of-position leads #9838) bluff more against a river folder and cut the bluffs against a credible station. The station read was built on slow windows, so a player who adapted to the extra river bluffing by calling more kept being bluffed.

## Measured Before

Harness: `server/src/engine/HorseFastCalldownRead.test-support.ts`. Heads-up hands observed exactly as the worker observes a completed hand (`HorseMind.observe` on the completed action stream, then `observeHandComplete`). The opponent folds 30 river bets, then calls every river bet. The bluff rate is the real `HorseLogic.decide` on the HorseV54RiverBluff river (air with a blocker, checked to hero, 240 seeds).

- The station flag (`isStation` or lifetime fold-to-river-bet under 35%):
  - never engaged in 40 straight river calls when every hand was a river spot;
  - took 28 calls with three blank hands between river spots;
  - took 23 calls after only 12 prior folds.
- The lifetime V23 river fold rate never decays. It kept the 1.6x folder factor for 6 calls and stayed above neutral for about 10.
- NLH heads-up, every hand a river spot, bluff rate by river call after the switch (unknown player 0.433, the folder 0.679):

| calls            | 1     | 2     | 3     | 4     | 5     | 6     | 7     | 8     | 12    |
| ---------------- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| before (ablated) | 0.679 | 0.679 | 0.675 | 0.629 | 0.592 | 0.546 | 0.496 | 0.450 | 0.421 |
| after            | 0.679 | 0.679 | 0.675 | 0.379 | 0.342 | 0.079 | 0.079 | 0.079 | 0.075 |

- With three blank hands between river spots, the ablated rate never fell below 0.388 (unknown 0.433) in 12 calls. With the read it is 0.096 from call 6.
- PLO4 heads-up (unknown 0.388, the folder 0.896):
  - every hand a river spot: ablated rates 0.892 / 0.904 / 0.738 at calls 4 / 6 / 8; with the read 0.321 / 0.087 / 0.096;
  - three blanks between: ablated 0.463 at call 6; with the read 0.063.
- Switching back to folding, the bluffs return on the first river fold after 12 calls (the rate matches the ablated brain from then on).

## The Change

`server/src/engine/HorseFastCalldownRead.ts`, a pure read with two recency windows:

1. **River-specific recency window.** `OpponentStats.rvOpps` / `rvCalls`, updated in `HorseMind.observe` at the V23 river point. It ages once per RIVER OPPORTUNITY (2.5-opportunity half-life), so blank hands do not dilute it. It is pooled and memory only: it is not persisted, the persistence writer maps explicit columns, and the boot hydrator's replay through `observe()` rebuilds it. A hydrate never erases it.
2. **Exploit fast window.** `fRiverCall` / `fRiverCallOpp` (8-hand half-life), the same counters `opponentRead` uses. These are present in live, sandboxed and durable rows.

The read has three outputs:

- **callingDown.** Either window's recent call rate is credibly above 0.55: P >= 0.8 under a Beta posterior with an even prior of strength 4 and at least 2.5 decayed opportunities. The bluff layers treat it exactly as a credible station: a fifth of the heads-up baseline (never zero), no bluff lead, and the multiway station factor 0.05.
- **callingMore.** The river window has risen 0.25 over the long rate. The long rate is the lifetime V23 rate, else the long exploit window, else even. It is shrunk with the same prior and evidence, so a short window's shrinkage is never read as a style change. While it holds, the heads-up baseline drops the long window's over-folder floor (V53) and caps a folder `bluffMod` at 1. Those reads describe the style the player has left.
- **riverFoldRate.** This is the fold-rate input the layers price with.
  - A recent rate 0.25 below the lifetime one replaces it.
  - A recent rate 0.25 above it lifts the lifetime rate only to the neutral 0.45. That releases a lifetime station without giving a short window a folder boost.

Without recent river evidence the read is null and every layer runs its exact previous code.

The read is wired into HorseLogic in two places:

- the heads-up baseline site, which also serves the out-of-position leads;
- the multiway site.

`riverFastCalldown: false` ablates it. Telemetry: `river_fast_calldown_station` and `river_fast_calldown_station_multiway`.

## Decisions

- **No "risen from the long rate" condition on callingDown.** A simulation over stable Bernoulli callers showed that it removed almost no false reads: a 50% caller is read as calling down 2.8% of the time without it and 2.4% with it. It also switched the read off and on for a player still calling every river, once his lifetime rate caught up.
- **An even prior, not the envelope mean.** The population river call mean differs by game and size (0.42 PLO4 heads-up, 0.43 short-handed hold'em, 0.51 heads-up hold'em), but the price of a bluff does not. Against those means, six calls were not yet credible in PLO4 or in a three-way pot.
- **Parameters.** Half-life 2.5, prior strength 4, edge 0.55 and credibility 0.8 were chosen on a grid. They give 7 opportunities to read in the pure simulation and 6 in the real harness. False reads come out at 0.4% / 2.4% / 5.3% for stable 40% / 50% / 55% callers.

## Not In This Change

- The legacy V23 bluffScale of the older river layers still uses the lifetime fold rate. The baseline, multiway and lead layers now own those spots.
- The recency window is pooled across games, like the V7 window. It is not scoped.

## Proof

- `server/src/engine/HorseFastCalldownRead.law.test.ts` (new law, `docs/laws.d/horse-fast-calldown-read.md`): the drop within 6 river opportunities in nlh and plo4 with and without blank hands, the ablated control, recovery within 6 folds, the lead and multiway layers, decision-for-decision neutrality for unknown players, null on no data, and no false read on a stable half-and-half caller.
- The existing engine laws pass, listed in the PR.

Engine change: it takes effect only after a later certified 04:00 America/Chicago release.
