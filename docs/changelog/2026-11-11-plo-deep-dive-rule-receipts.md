# Original per-rule PLO deep-dive evidence

The shared `v87_deep_dive_discipline` counter cannot identify the Horse, decision
or specific #10455 pillar that ran. The original private decision journal now
captures bounded rule observations beside the existing range and plan evidence
on both FAST and DEEP paths. The policy, its thresholds and its random draws are
unchanged. Pillar 2 stays excluded by qualification; PLO8 retains its exclusions.

`HorseDeepDiveReceipt.ts` defines `horse-deep-dive-v1` and the rule-to-pillar map.
The receipt binds the canonical original request digest, original read-frame
digest and final decision action/amount. Each rule row distinguishes actual
consumer evaluation, qualifying local conditions and a local input or candidate
action change. Later policy owners can replace that choice: these counters do
not prove final causal effect, improved profit or complete fleet activation.
A missing row means the consumer was not observed, never an assumed invocation.
Missing capture, disabled policy, exceptions, malformed evidence and count
bounds remain explicit. The synchronous scope isolates nested calls and restores
itself on exceptions. No trace is sent in the worker IPC response or public
telemetry, and disabled journaling creates no collector.

A consumer must validate `horseDeepDiveReceiptIsValid`, require `observed` and
an effective enabled flag, and reconcile the original journal to execution and
an atomic accepted action before crediting a live observation. `evaluated`
alone does not establish eligibility; `eligible > 0` does. `changed > 0` only
establishes local application. Historical journals without this field remain
unknown for per-pillar invocation, and a source merge is not live acceptance.

Focused regressions cover actual preflop and PLO6 turn/river consumers, PLO8
exclusion, decision/RNG neutrality, FAST/DEEP original bindings, no IPC leakage,
missing/disabled/refused capture, nesting, bounded output and malformed or
cross-request/frame/action records. Normal engine checks, protected merge,
exact Backup certification, certified activation and original natural-hand
readback remain required for delivery. No migration is introduced.
