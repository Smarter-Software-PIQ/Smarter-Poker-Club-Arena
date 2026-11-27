# PLO shadow reads its direction, and several shadow rows read apart (2026-11-27)

**Why.** A PLO shadow trial recorded only same/changed. Nobody could tell from the counters whether a changed
re-decision was a fold that would call (what the over-fold fixes are for) or a call that would fold, or on which
street and against which size. The per-decision receipts were only in the engine-host journal. Shadow trials also ran
one at a time. The engine never needed that: a decision re-decides at most one option in shadow. The limit was there
because the stage's skip, breaker and latency counters had shared names.

**What.**

- A changed staged PLO4/PLO5 re-decision counts `option_shadow_<option>_dir_<from>_to_<to>_seen`, the same counter
  hold'em has, plus its street x size cell, `option_shadow_<option>_cell_<street>_<size>_<from>_to_<to>_seen`. The size
  is the wager faced as a share of the pot before it, read the way the bet read reads it: under 0.4, 0.4 to 0.7,
  0.7+, a raise, unread, unopened, or preflop. Each counter also has a `_person_seen` subset. On Lightning every PLO
  receipt counter is counted again under `fmt_l_`.
- Each stage skip, slow re-decision, breaker trip and re-decision time is now also counted under the option it belongs
  to: `option_shadow_<option>_stage_*` and latency scope `option_shadow_stage_redecide_opt_<option>`.
- `OPTION_SHADOW_STAGE_MAX_ROWS = 3`. The switch tool lets a second or third non-style row into shadow only when every
  serving release has been seen timing per-option re-decisions.
- `scripts/ops/shadow-read-report.mjs` prints the direction table, the cells, the Lightning split, the option's own
  stage counters and its own re-decision time. It no longer counts engine-host flush identities (receipts with no
  decide latency) as workers.

**Unchanged.** The acted decision: the new counters run after the answer is sent, only for a changed staged PLO
receipt. Hold'em counters keep their names. Budgets, the Horse-only cap and the breaker are unchanged. Law:
`aListedOptionInShadowStageNeverChangesTheActedDecision.test.ts`, which now also covers three rows in shadow.
