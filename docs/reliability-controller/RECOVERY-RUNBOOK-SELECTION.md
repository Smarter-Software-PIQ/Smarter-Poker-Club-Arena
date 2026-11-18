# Recovery Runbook Selection (Reliability Controller, engine recovery track)

Finding, 2026-11-11 13:30 UTC: **no incident class meets the bar for a controller recovery action. Nothing executable is shipped.** `smarter_private.reliability_runbooks` stays empty, `mutation_paused` stays true, and `smarter_private.reliability_tick` is not redefined.

Read-only SELECTs against project kuklfnapbkmacvwxktbh. Ownership facts come from `RECOVERY-OWNERSHIP-MAP.md` and `CLASS-CATALOG.md`; paths are relative to the repo, `S/` = `server/src/`.

## The bar

A class qualifies only if all four hold:

1. It actually opened often since install, and it paged the owner or stayed open.
2. A narrow mechanism that already exists in the engine would fix the fault.
3. Nothing else already owns that recovery.
4. The action is not a money, settlement, release, restart or tournament-hold action.

## What opened since install

Install to read: 2026-11-10 07:25 UTC (first observation) to 2026-11-11 13:30 UTC. 235 incidents, 2,354 observations.

| Class / alertname                                                                            | Incidents | Paged | Outcome                                                                                                                 | Fails rule | Why                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------- | --------- | ----- | ----------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| stats / `postHandTasks.hand_history_failed`                                                  | 58        | 57    | All recovered on producer resolve plus the 30 min quiet window (median 91 min)                                          | 2, 4       | 56 of 58 opened in one episode, 2026-11-10 14:32 to 15:55, together with `DatabaseWriteRetriesExhausted` and `PokerSettlementBlocked`: a database-side episode. The engine's own step retry (`S/engine/ServerTableEngineSettlement.ts` `runStep`, `STEP_RETRY`) and payload retry already own a re-attempt. No narrow engine action fixes a database that is not accepting writes.                       |
| money_integrity / `ServerTableEngine.authoritative_hand_semantic_refusal`, `..._unreachable` | 81        | 79    | Recovered, same episode                                                                                                 | 4          | Money class. Catalog: detect, link, escalate only.                                                                                                                                                                                                                                                                                                                                                       |
| table_liveness / `TableStoppedDealing`                                                       | 33        | 0     | All recovered, median 2 min, max 5 min                                                                                  | 3          | Owned by the table watchdog and the zombie reaper (`S/engine/ServerTableEngineTurns.ts` `runTableWatchdog`, `S/GameServer.ts` 8846-8990). Map rule: Never.                                                                                                                                                                                                                                               |
| horse_decision_delivery / `HorseBrainVariantSilent`                                          | 5         | 0     | All recovered on their own in 8 to 35 min (plo8, flh, flo8, plo5, plo6; 04:32 to 11:02 UTC)                             | 1, 2, 3    | Warning only, never paged. All in the overnight trough, where the rule's own description names "its tables may have closed" first. Decision shards are not per variant, so a shard restart does not target the symptom. A failed shard is already replaced by `S/engine/horseDecision/lane.ts` (`SHARD_REPLACEMENT_LIMIT`), and the map records no external replace path; adding one would duplicate it. |
| unclassified / `LightningHandHost.post_commit_obligations_pending`                           | 2         | 0     | Both converged by themselves in 3 and 17 min (`fn_resolve_settled_financial_alerts`: "post_commit_completed_at is set") | 1, 3       | The alert itself names the owner: "the outbox row remains authoritative and the projection worker is its successor". Pending envelopes older than 15 s at read time: 0. The startup drain (`S/lightning/LightningPostCommitRecovery.ts`) is deliberately the only drain under the 2026-10-31 operator policy (no recurring repair loop).                                                                 |
| tournament_lifecycle / `GameServer.tournament_dark_after_rebuild`                            | 1         | 0     | Closed                                                                                                                  | 1, 3       | This alert is the engine reporting that its own rebuild (`rebuildManagersOfDarkTournaments`) already ran and did not help; `S/tournament/repeatedRecoveryLedger.ts` then backs off on purpose. A controller rebuild would be the repeat that guard refuses. Pre-install storms (2026-11-01 to 11-05, 11-08: about 2,900 inbox rows) show rebuilds not fixing that fault.                                 |
| Each remaining class                                                                         | 1 each    | mixed | mixed                                                                                                                   | 1, 4       | One incident each, or money, release, database, digest or external-host classes with no engine action.                                                                                                                                                                                                                                                                                                   |

`HorseDecisionFallbacks` reached the inbox twice in 14 days (2026-11-09, 11-10) and opened no incident since install.

## The command channel

`public.ca_engine_operator_commands` does not fit as a database-to-engine recovery channel today:

- It is a durable reservation and audit ledger written by `fn_ca_engine_operator_command`. The CHECK constraint allows only `floor` and `maintenance`.
- The engine does not poll it for work. Floor commands reach the engine through `ca_operator_floor_hold` state, and the engine reads `maintenance` rows only at a break announcement (`S/maintenance/OperatorCommands.ts` `readQueuedMaintenance`).
- Using it for recovery would need a new domain plus a new engine poller. That poller would be a new recurring mechanism, and no class above justifies one.

## When to revisit

Reopen this selection only when a class meets rule 1 in production: it repeats and it pages or stays open, and its root cause has been looked at first. Owner rule: fix defects at the root and never compensate with a repair loop. A runbook is right only for a fault that is transient by nature and whose existing narrow fix has no owner. A runbook added then must follow the executor rules in the controller handoff: versioned rows, `disabled | observe | enabled`, a bounded, fenced, idempotent command key per incident attempt, every attempt appended to `reliability_incident_events`, resolution only by producer evidence, escalation on exhaustion, `mutation_paused` honoured, and no command in the :55 to :00 freeze.
