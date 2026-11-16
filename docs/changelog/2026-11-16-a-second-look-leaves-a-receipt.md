# A rule that acts only in the second look now leaves a count

2026-11-16, PLO6 lane (measurement only; no decision changes).

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

## What did not change

No decision, no option, no switch. The second look receives the same options as before except the counter gate, which only decides whether a receipt is noted.

## Checks

`BrainTelemetry.test.ts` (capture collects and does not count; once per second look; a paused evaluation, a style read receipt, a watchcounter and latency add nothing; a decision is identical with the gate off, on, and on inside the capture). `workerRuntime.test.ts` (a rule reached only by the second look is counted under `second_look_`, the first look's count is not repeated). `HorseDataLedger.test.ts` (the family is registered and fired).
