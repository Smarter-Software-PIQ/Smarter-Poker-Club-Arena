# Hand Memory Domain Missing

Use this runbook for `HandMemoryDomainMissingOnCashShowdown` in the
`horse-opponent-memory` group of `infra/monitoring/alert-rules.yml`. The alert
reports a defect. It never repairs, backfills, retries a hand, restarts the
engine or changes what is written.

## What fired

For 15 minutes running, some ordinary cash hands that reached showdown were
accepted by the atomic hand commit with no valid
`hand_history.public_memory_domain`, with at least 50 learnable cash showdown
hands in the 30-minute window.

`logHandHistory` (`server/src/services/supabase/handHistory.ts`) writes the
column only when the producer's value passes `publicMemoryDomainIsValid`, and
omits it otherwise. The trigger `fn_horse_exact_accept_hand` (migration
`20261106091733`) returns without learning when the stored domain is not
valid, so every such hand is lost to the exact opponent memory. The correct
share is 0.

## The counters

Counted once per accepted hand in
`server/src/services/supabase/handMemoryDomainSignal.ts`, always on:

| Series                                   | Labels                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `poker_hand_memory_domain_logged_total`  | `mode` (cash, tournament), `reached_showdown` (true, false), `learner_scope` (supported, unsupported_variant) |
| `poker_hand_memory_domain_missing_total` | `mode`, `reached_showdown`, `reason` (absent, invalid, unsupported_variant)                                   |

- `absent`: the producer passed null or nothing. On 2026-11-07 to 2026-11-12
  this was `postHandTasks` reading the hand's blind snapshot after the
  controller had been cleared (finding HVH2D-EXE-002, repaired by #10631).
- `invalid`: the producer passed a value the validity check refuses (wrong
  keys, version, speed or ante).
- `unsupported_variant`: the hand's variant is outside the nine the trigger
  learns. Exempt: the alert reads neither this reason nor that scope.

Lightning hands are not logged through this path and are not in these series.
A hand a replacement engine completes through
`resumeRetainedHandSubmission` is not counted on either side.

## Read

```promql
sum by (mode, reached_showdown, reason) (increase(poker_hand_memory_domain_missing_total[30m]))
sum by (mode, reached_showdown, learner_scope) (increase(poker_hand_memory_domain_logged_total[30m]))
```

Then find what the producer passed: `ServerTableEngineSettlement.postHandTasks`
builds the value with `publicMemoryDomainFromRules` from the hand's blind
snapshot. Compare the serving engine release with the last release where the
share was 0.

## What it does not mean

No money, settlement or hand record is wrong. Hands already written without a
domain stay as they are; the trigger never infers a domain for an old hand.
The fix is in the producer and ships through the normal engine release.
