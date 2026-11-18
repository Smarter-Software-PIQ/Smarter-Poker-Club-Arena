# Hand Memory Domain Missing

Use this runbook for `HandMemoryDomainMissingOnCashShowdown` in the
`horse-opponent-memory` group of `infra/monitoring/alert-rules.yml`. The alert
reports a defect. It never repairs, backfills, retries a hand, restarts the
engine or changes what is written.

## What fired

For 15 minutes running, some cash hands that reached showdown were accepted
by the atomic hand commit with no valid `hand_history.public_memory_domain`,
with at least 50 learnable cash showdown hands in the 30-minute window. The
rule reads physical cash tables (`mode="cash"`) and Lightning pools
(`mode="lightning"`) together: one share over one floor.

`logHandHistory` (`server/src/services/supabase/handHistory.ts`) writes the
column only when the producer's value passes `publicMemoryDomainIsValid`, and
omits it otherwise. The trigger `fn_horse_exact_accept_hand` (migration
`20261106091733`) returns without learning when the stored domain is not
valid, so every such hand is lost to the exact opponent memory. The correct
share is 0.

A Lightning hand's row is built by `LightningHandHost.handRow` and committed
by `fn_lightning_settle_hand` through the same door
(`fn_ca_commit_hand_settlement`), so the same trigger fires on it. The trigger
files it as a cash hand under its own domain (speed `lightning`).

## The counters

Counted once per accepted hand by
`server/src/services/supabase/handMemoryDomainSignal.ts`, always on:

| Series                                   | Labels                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `poker_hand_memory_domain_logged_total`  | `mode` (cash, tournament, lightning), `reached_showdown` (true, false), `learner_scope` (supported, unsupported_variant) |
| `poker_hand_memory_domain_missing_total` | `mode`, `reached_showdown`, `reason` (absent, invalid, unsupported_variant)                                              |

- `absent`: the producer passed null or nothing. On 2026-11-07 to 2026-11-12
  this was `postHandTasks` reading the hand's blind snapshot after the
  controller had been cleared (finding HVH2D-EXE-002, repaired by #10631).
- `invalid`: the producer passed a value the validity check refuses (wrong
  keys, version, speed or ante).
- `unsupported_variant`: the hand's variant is outside the nine the trigger
  learns. Exempt: the alert reads neither this reason nor that scope.

## Where A Hand Is Counted

Every accepted hand reaches the trigger through one of three boundaries, and
each counts it once:

| Boundary                                                                  | Hands                                                   | `mode`           |
| ------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------- |
| `logHandHistory`, after the atomic commit accepts the hand                | A physical cash or tournament table                     | cash, tournament |
| `LightningHandBackend.settle`, on the accepted `fn_lightning_settle_hand` | A Lightning pool hand                                   | lightning        |
| `resumeRetainedHandSubmission`, when the door answers `financial_handoff` | A retained hand the replacement engine's call committed | cash, tournament |

No hand passes two of them. A Lightning hand is never retained. A resume call
that finds the hand already committed answers `financial_handoff: false` and
counts nothing. The resume answer carries no row facts, so that boundary reads
the four columns the trigger reads back from the stored row
(`server/src/services/supabase/handMemoryDomainReadback.ts`): one primary-key
read per handed-off hand, not awaited.

## The Limit

A retained hand is counted only by the one resume call whose transaction
commits it. It is in neither series when:

- that call's answer was lost, or its post-commit work finished on a later
  call (the later call sees the hand already committed);
- the read-back of the stored row failed or found no row;
- the original engine's commit did land and that process stopped before its
  count ran.

Each of these undercounts both the numerator and the denominator by the same
hand; none can count a hand twice. Retained hands are a small share of volume
(a successor settled 30 in the 2026-10-03 stall), so the alert's share is not moved by them.
Tournament hands are counted and are not read by this rule. The counters
restart with the engine.

## Read

```promql
sum by (mode, reached_showdown, reason) (increase(poker_hand_memory_domain_missing_total[30m]))
sum by (mode, reached_showdown, learner_scope) (increase(poker_hand_memory_domain_logged_total[30m]))
```

Then find what the producer passed, by `mode`:

- `cash`, `tournament`: `ServerTableEngineSettlement.postHandTasks` builds the
  value with `publicMemoryDomainFromRules` from the hand's blind snapshot.
- `lightning`: `LightningHandHost.handRow` builds it the same way from the
  Lightning hand's own controller.

Compare the serving engine release with the last release where the share was 0.

## What it does not mean

No money, settlement or hand record is wrong. Hands already written without a
domain stay as they are; the trigger never infers a domain for an old hand.
The fix is in the producer and ships through the normal engine release.
