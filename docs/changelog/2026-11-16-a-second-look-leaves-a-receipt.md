# A rule that acts only in the second look now leaves a count

2026-11-16, PLO6 lane (measurement only; no decision changes, and no change to the Phase 8 sentinel or the evidence-mode clocks: see "A second look is not the live decision").

## The gap

Every live Horse decision is answered by a first look. The decision worker may then take a deeper second look at the same turn, and the table can play the second look's action instead. The second look ran with the receipt counters off. So a rule that acted only in the second look left no count anywhere, and a zero on a rule's counter in `horse_brain_telemetry` did not show that the rule never decided a played action. On 2026-11-15 this forced the PLO6 lane to read the decision journal by hand to grade a counter that read zero.

## The change

The second look now decides with the counters on, inside a capture (`withSecondLookFireCapture` in `server/src/engine/BrainTelemetry.ts`):

- nothing is counted under its own name there, so every existing counter keeps its meaning: one count per first-look decision that fired it. Nothing is counted twice;
- the keys the second look fired are collected and, after the decision is made, counted once each as `second_look_<key>_seen` (the suffix is not doubled for a key that already ends in `_seen`);
- watchcounters and decision latency are not recorded inside the capture, as before; the read-time style receipts stay uncounted in the second look, as before.

Registered in `HorseDataLedger.ts` as the family `second_look_*`. No migration: the table is keyed by the feature name.

## How to read it

- `<key>` > 0: a first look fired the rule.
- `second_look_<key>_seen` > 0: a second look's evaluation fired the rule. This is not proof the second look's action was played; the decision journal records which action the table executed.
- Both zero: no live evaluation, first or second, fired the rule.

## A second look is not the live decision

In `HorseLogic.ts` "counters on" also stood for "this is the live decision" at a few places. A second look behaves at each of them exactly as it did when it ran with the counters off (`inSecondLookCapture()` in `BrainTelemetry.ts`, read as `teleLive` in the decision):

- the Phase 8 safety sentinel (process-wide state): a second look does not read its switch, does not feed it (`observe`) and its equity capture does not obey it. Its Phase 8 receipts are still collected;
- the evidence-mode clocks and budgets of phases 10 to 13 and the shadow utility budget (seven places that were `!tele`);
- the v53 preflop counterfactual, which a second look now runs for its receipt: the deep-dive collector is detached for it, so it adds nothing to the second look's deep-dive capture.

Every other telemetry-gated block in `HorseLogic.ts` (436 `if`s) only counts. `SecondLookIsNotLive.test.ts` holds that as a source law: a call in such a block must be a counting call or be listed there with its reason; `!tele` is refused; the sentinel may be read only behind the live test.

## Counters that step down, and how not to read the two families

- The receipts that are NOT telemetry-gated counted under their own name during a second look before; they now count under `second_look_`. Their own-name counters lose their second-look share from the first full day (a step, not a behaviour change): the receipts fired from `HorseMind.ts` (38 call sites, for example `opponent_memory_donor_*`, `omaha_ev_fold_model_priced`, `break_even_bluff_priced`), `upgrade10_*` from `HorseOpponentExploit.ts`, the receipts of `GtoPostflopV31.ts` and `HorseEval.ts`, and the PLO6 river fold and flat receipts (`v58_plo6_river_*`, `v59_plo6_river_unpaired_*`). The share is bounded by the share of decisions that get a second look.
- The two families are not comparable: a rule's own counter counts every fire; its `second_look_` counter counts once per second look that fired it. Do not divide one by the other.
- A key whose `second_look_` name would be longer than the writer's 128 characters is not counted under that name (one refused name drops its whole batch); the second look counts `second_look_receipt_key_too_long_seen` once instead.
- Replay: a replayed second look runs the same way (counters on inside the capture), so its collected keys are the second look's, not own-name counts.

## What did not change

No decision, no option, no switch. The second look receives the same options as before except the counter gate, which only decides whether a receipt is noted.

## Checks

`BrainTelemetry.test.ts` (capture collects and does not count; once per second look; a paused evaluation, a style read receipt, a watchcounter and latency add nothing; a decision is identical with the gate off, on, and on inside the capture). `workerRuntime.test.ts` (a rule reached only by the second look is counted under `second_look_`, the first look's count is not repeated). `HorseDataLedger.test.ts` (the family is registered and fired).

`SecondLookIsNotLive.test.ts`: a tournament postflop second look leaves the Phase 8 sentinel untouched and ignores a tripped one, while the first look feeds and obeys it; the whole decision (without its wall-clock fields) is the same with the counters off and on inside the capture on a tournament flop, an Omaha river and four preflop spots at five seeds; the length guard; the source law.
