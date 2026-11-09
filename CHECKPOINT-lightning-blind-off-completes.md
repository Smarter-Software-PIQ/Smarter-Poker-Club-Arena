# Checkpoint: a Lightning blind off always completes (BUG-7C1347FF)

Lane branch `fix/lightning-blind-off-completes-20261109`. States are kept separate; nothing is claimed that was not observed.

## Scope

Hit And Run blind off in a Lightning pool: stop door, matcher legality, disconnect reaper, reconnect and re-entry, the hand host's fold of an absent seat, and the final cash-out and pool exit. Out of scope: any production data write, the reporting player's own rows (settled by the coordinator through the audited admin removal).

## Database change (this pull request)

- Migration `20261109224717_a_lightning_blind_off_always_completes.sql`: function images only, one transaction, md5 and anchor guarded, no `@install-window`.
- Tested locally on the exact candidate: `node scripts/qualify-lightning-blind-off.mjs` (PostgreSQL 16 here, 17 in CI): installed production images hash-equal to production; BEFORE the migration S1, S2, S4, S6 strand; AFTER each completes; S3, S5, S7 hold in both. `tests/a-lightning-blind-off-always-completes.law.test.ts` 8 of 8.
- Merged, installed, verified live: recorded in the delivery report and the follow-up to this file once observed.

## Engine dependency (separate pull request, not merged or staged by this lane)

`releaseLeavesHeldByClock` must read a Lightning anchor's held seats fresh before deciding. Dependency order: database first (safe with the serving engine), engine in any later certified cutover. Until it ships, a completed Lightning blind off is cashed out on the player's next Leave press or an engine restart.

## Read-only production sweep (2026-11-09 23:4x UTC)

Every live seat, human or horse, in a Lightning-mode Cluster with no open pool session and `hr_blind_off` or hands owed: one row, the reported seat `65fb6b94-a167-4f2b-9377-fe926ed182b5`, since settled by the coordinator.
