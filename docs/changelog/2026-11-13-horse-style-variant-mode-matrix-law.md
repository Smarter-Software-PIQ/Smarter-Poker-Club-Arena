# Every Horse Style, In Every Variant And Both Modes, Is Proven Through The Production Decision Path

Test only. No production source changes.

## Why

All 1,000 active Horses store the Hybrid style, so live play can never show that the other five supported styles (tag, lag, balanced, tricky, grinder) work. Before this law, none of the 108 style by variant by mode combinations was covered end to end with its upgrade counters (`HorseActionSpaceFreedom.law.test.ts` runs a Hybrid row through the worker in thirteen variant and mode cells, without counters): the per-decision upgrade counters (01 range posteriors, 02 card removal, 06 public timing) were asserted for one cell only (the brain called directly, grinder, Hold'em, cash), and no test ran a stored legacy style, or a remaining variant in a tournament, through the decision worker.

## What The Law Runs

`server/src/engine/HorseStyleVariantModeMatrix.law.test.ts` makes 216 real `DECIDE_FAST` decisions through `HorseDecisionWorkerRuntime` on flop states dealt by a real `HandController`:

- Production path: each stored style goes through `resolveHorseHybridProfile` (the call `ServerTableEngineTurns` and `LightningHorse` make) and then the worker, for nine variants and both modes. A stored legacy style resolves to grinder in cash and tricky in tournaments, exactly like a Hybrid row.
- Brain path: each of the six style names is passed to the brain directly, proving no style branch skips an upgrade.

Each decision must return a result with a valid receipt and no fallback; the action must be on the controller's menu, inside the raise bounds, and accepted by the controller; counters 01, 02 and 06 must fire where the manifest declares them; the tournament utility (07) must fire in tournaments and never in cash; cash-only upgrades never count in tournaments.

## What It Found

- No combination fails. No style or variant branch withholds an approved upgrade.
- A non-Hybrid stored style cannot reach the brain in production: the resolver replaces it. That is the owner's 2026-11-05 precedence, now held by a test.
- The remaining-variant pack refuses Pineapple tournaments (`pineapple_tournament_unapproved`); the law asserts that reason. The reference brain still decides there legally with 01, 02, 06 and 07.
- The card-removal scorer also runs in fixed-limit Hold'em and fixed-limit Omaha hi-lo, which the manifest does not list for upgrade 02. Execution is wider than the declaration, not narrower; recorded for the strategy lanes, not changed here.

## Limits

Flop spots, heads-up, first decision of the street. The single-mode upgrades (03, 07, 08) are checked for mode leakage. The occurrence-dependent both-mode upgrades (04, 05, 09, 10, 11) are not asserted here at all; their evidence is `HorseUpgradeEvidenceCounters.test.ts` and live counters. Decisions are sampled, not fixed: the worker seeds its own randomness from the decision key, so the action chosen can differ between runs while every assertion holds (56 of 216 differed between two runs in review; 31 of 31 runs passed). All six styles in a cell see the same flop (eight distinct flops), the hero is first to act, and only bet and check occur, so call, raise, fold and all-in legality are not exercised here. Removing the upgrade 02 fire fails 28 tests; making the resolver pass a stored style through fails the resolution assertions.
