# tests/no-checkpoint-file-sits-at-the-repository-root.law.test.ts

On 2026-11-27 the repository root held 84 `CHECKPOINT*.md` files, one per
finished lane. No test, script or workflow read any of them; changelogs and
handoffs named them as the record of a lane's local evidence. They were moved
with their history to `docs/archive/checkpoints/`. The law refuses any tracked
root file whose name starts with `CHECKPOINT` (any case) and checks that the
archived set is still in `docs/archive/checkpoints/`, so a new lane writes its
checkpoint there rather than at the root.
