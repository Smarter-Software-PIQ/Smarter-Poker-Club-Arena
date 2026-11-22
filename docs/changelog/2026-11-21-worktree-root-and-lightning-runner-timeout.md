# 2026-11-21: a worktree root is proved writable, and the Lightning runner timeout is configurable

Two tooling defects that cost agents time on the night of 2026-11-20.

## scripts/agent-workspace.sh picked a root it could not write

`/Volumes/SmarterWork/agent-work` is root-owned and read-only on the owner's
Mac; every lane already works under `agent-work/shared-capacity/`. The script
checked the SSD root with `-w`, fell through to `~/Documents/.agent-trees`
(the boot disk, forbidden while the SSD is attached), and the checkout then
died later with a bare "Permission denied". Every agent had to discover
`AGENT_WORKTREE_ROOT` and set it by hand.

Root fix: `choose_agent_worktree_root` proves each candidate by creating and
removing a probe file. Order: `AGENT_WORKTREE_ROOT` (refused by name when not
writable), `agent-work/<repo>`, `agent-work/shared-capacity/<repo>`; the boot
disk only when no SSD is attached. When no candidate can be written the script
refuses at once with one message naming `AGENT_WORKTREE_ROOT`. Selection now
runs after the origin/main handover, inline, because the handover runs main's
copy from a temporary path. The machine-wide checkout lock and every other
guard are unchanged.

Pinned by `tests/unit/agentWorktreeRootIsProvedWritable.test.ts`, which runs
the real function against temporary directories (an unwritable candidate is a
path through a regular file, so it holds as root too).

## LightningPairedEval runner: a fixed two-hour timeout

The runner `it` carried `7_200_000` ms. A per-test timeout beats vitest's
`--testTimeout`, so `--testTimeout=0` changed nothing and a declared 90-cell
run in one process died at about 60 cells.

Root fix: `LIGHTNING_EVAL_TIMEOUT_MS` (unset keeps two hours, `0` means none,
anything other than a whole number is refused before the run), parsed by
`lightningEvalRunnerTimeoutMs` in `LightningPairedEval.test-support.ts` and
pinned in `LightningPairedEval.test.ts` without running an evaluation.
Documented in `server/src/lightning/LIGHTNING-PAIRED-EVAL-README.md`.
