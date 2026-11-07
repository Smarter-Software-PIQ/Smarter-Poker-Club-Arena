# Opportunity-Scoped Opponent Decay With A Style-Shift Release (Item 12)

Decision Readiness Phase 3, Item 12. #9632 wired `decayAndAddOpportunityScoped` and then withdrew it (commit 89dc7bb), because with it on a maniac who turns into a nit stopped reaching postflop spots. His postflop statistics froze, and the horses kept reading him as a maniac, which contradicts `HorseManiacPressure.law.test.ts`.

## The Rule Now Live

`HorseMind.observeExploitHand` and `mergeSandboxExploit` pass `opportunityScoped = true`. The decay rule in `HorseOpponentExploit.ts` has three parts:

1. **Fast window.** The fast window (8-hand half-life) ages every hand, gated or not. It is the recency detector.
2. **Long window.** A long-window statistic conditioned on an opportunity (RFI, 3-bet, fold to 3-bet, bet when checked to, fold to bet, river call) keeps its weight on a hand that offered no such spot. A rare sample does not evaporate.
3. **Style-shift release.** `styleShiftReleased` fires when any fast-window rate (PFR, or any fast-mirrored gated statistic with at least 3 fast samples) differs from its long-window rate by at least 0.2. While it holds, every long-window gated statistic ages at the fast rate, so a read built on the old style cannot outlive the style.

## The Ruling

The registered law pins were measured on the same seeds:

- A maniac who calms down is read within 25 hands. Passes in hold'em and PLO4; PLO4 failed with scoped decay alone.
- A nit who turns maniac is read within 12 hands. Passes in hold'em; PLO4 measured 14.

The two extra PLO4 hands are what Item 12 costs: the nit's pre-switch evidence is the sample it keeps. Meeting 12 would need a 0.05 gap with a 1-hand sample. Instrumented over the harness, that releases on about 45% of all updates for stable players, against about 5-7% at the shipped 0.2 / 3, so most of Item 12's benefit would be lost.

Put to Dan on 2026-11-06, he chose "Ship it; allow 14 in PLO4". The PLO4 pin is 14 and hold'em stays 12.

## Not In This Change

The durable profile (`fn_horse_exploit_add`, migration 20261023183513) still decays every counter per completed hand. A reload therefore imports per-hand-decayed rows, which is what production does today. A v2 SQL contract (per-stat opportunity clocks, plus a back-fill rule for legacy rows) is the follow-up. It must arrive as a migration from protected main.

## Proof

- `server/src/engine/HorseStyleShiftRelease.test.ts`: what the rule keeps, ages and releases.
- `HorseManiacPressure.law.test.ts`: all 19 tests pass.
- `HorseOpponentMemory`, `HorseOpponentExploit` and `HorsePlanFingerprintActivation` tests pass.
