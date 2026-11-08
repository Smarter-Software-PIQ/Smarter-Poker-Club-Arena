# 2026-11-07 - The Written Rule Follows The Merge That Dispatches

#9994 moved `dispatch-merged-migrations.sh` out of the disabled Agent Autopilot into its own workflow, `dispatch-merged-migrations.yml`, so every same-repository merge into main dispatches the migrations it added, whoever merged. PUBLISHING.md, CLAUDE.md section 11 and the law entry still said only the autopilot's merges dispatch and "after any other merge, dispatch it yourself" - the rule that left #9952's `20261107210000` uninstalled after its merge on 2026-11-07 until a hand dispatch.

All three now describe the merge-event workflow, say a daily-window file is queued and never sent early, and limit a hand dispatch to a file the run's summary names as not sent. `tests/a-merged-migration-is-dispatched-by-its-merger.law.test.ts` refuses the old wording in any of the three.
