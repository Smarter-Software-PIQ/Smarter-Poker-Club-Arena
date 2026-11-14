# Owner-authorized off-cycle engine cutover, November 14

The owner authorized an off-cycle engine cutover at the earliest safe, qualified time instead of waiting for the routine 04:00 Chicago window. Production serves `533608409f2b05e702c9fbd097bcab48b9e59dad`; protected main is 72 commits ahead and carries #10683, #10750, #10768 and the merged Phase 1 strategy, activation and Lightning changes.

This books single-use window `2026-11-14-owner-offcycle-engine-0506z`: notice 04:40 UTC, admission 05:06 to 07:30 UTC (23:06 to 01:30 Chicago), predecessor `533608409f`, content minimum `566b7fcbd1`. It follows the fourteen-file shape in `docs/ENGINE-OWNER-WINDOW-CUTOVER-PLAYBOOK.md`; the predecessor pinned in the seal and the host transaction moves to the serving release. No guard, reserve, runtime strategy or SQL bytes change. Outcomes are recorded in the owning release checkpoint, not claimed here.
