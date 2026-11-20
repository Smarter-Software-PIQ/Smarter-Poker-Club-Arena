# tests/new-hands-prune-while-the-retained-prefix-is-rescanned.law.test.ts

Hand-history retention keeps a forward-only frontier cursor beside its rescanning pass cursor, so newly eligible horse hands prune within minutes of the eight-day boundary while the pass re-reads retained rows (a 30-35 hour rescan stopped all pruning before, 2026-11-18). A frontier still two hours behind is recorded in the alert store. Pinned in migration 20261118061009, in any later redefinition of `sp_prune_hand_history`, and by the native fixture `scripts/ci/fixtures/hand-prune-frontier.sql`.
