# New hands prune while the retained prefix is rescanned (2026-11-18)

**What was wrong**
- Hand-history retention stopped pruning new horse hands for 30-35 hours at a time.
- An hour after each pass started, `sp_prune_hand_history` restarted the pass from the oldest row so it could find hands whose guards had released.
- That rescan read every retained row before it could reach a newly eligible hand.
- When the rescan finished, the backlog was deleted back to back, at up to 3,200 s of database time an hour. By 2026-11-18 05:47Z the cursor was 26 hours behind its eight-day boundary.

**What changed** (migration `20261118061009`)
- A forward-only frontier cursor, `smarter_private.hand_history_prune_frontier`, now follows the boundary.
- Whenever it is more than five minutes behind, a page scans from it. The rescanning pass is otherwise untouched.
- The guards, the page size and the disposals are identical.
- A frontier that is still two hours behind is recorded as `HandHistoryPruneFrontierBehind` in the alert store.

**Proof**
- `scripts/ci/fixtures/hand-prune-frontier.sql`, run natively in CI shard 4.
- The law is `tests/new-hands-prune-while-the-retained-prefix-is-rescanned.law.test.ts`.
- Evidence is in `docs/production-alerts/evidence/retention-hand-history-prune-cursor-full-rescan/`.
