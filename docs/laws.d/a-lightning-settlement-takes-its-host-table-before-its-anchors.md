# tests/a-lightning-settlement-takes-its-host-table-before-its-anchors.law.test.ts

A Lightning settlement takes its host table before its anchors. Cash-outs and sit-outs lock the tables row and then the seat; fn_lightning_settle_hand locked every anchor seat and only then, through the shared commit core, its host tables row FOR UPDATE, and the two deadlocked three times on 2026-11-25/26. Migration 20261126233138 takes the host tables row FOR UPDATE (the commit core's own mode, so never an upgrade) inside step 5's BEGIN block, before the first anchor; no amount, receipt or refusal changes.
