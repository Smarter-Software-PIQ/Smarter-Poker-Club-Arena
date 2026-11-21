# 2026-11-20 The audited decision replay scorer reads pre-placed HVH48 audit nodes (`--placed`) and includes `^hu_` receipts

Authored by Horse Decisions helper `REPLAY-6` (`session_01UxDLnM`), rebased onto `#11533` and completed with `^hu_` receipt capture by HEADS UP (`29a711f2-6716-48c4-9782-680e8b603027`) per Antigravity Coordinator (`session_01UxDLnHu4P9fWx3X7Mp5FjM`) instructions (`2026-11-20T22:57:29Z`, `2026-11-21T00:23:51Z`). Offline operator/benchmark tooling only; no live engine decision, option default, migration or release-control file changes.

## What changed

- `server/src/benchmark/AuditedDecisionReplay.ts` and `server/src/benchmark/AuditedDecisionReplay.test.ts`: adds source `'placed'` (`placedDecisions(nodesJsonl)`), reading audited decisions already placed at their `(hand, seat, street, k)` node and scoring them verdict-only, counting a change away from a judged-bad action as `fixed` only when it matches `better` where the audit names the better action.
- `server/scripts/audited-decision-replay.ts`: adds `--placed <nodes.jsonl>`.
- `server/scripts/hvh48-audit-nodes.py`: offline node placer for the six HVH48 audit formats (`A`–`F`), enforcing a strict Horse-only card firewall (`horseHoleCards` restricted to `horses_here`).
- `server/scripts/audited-node-option-replay.ts`: offline per-node option-switch replay driver declaring sanitized base/candidate option sets for `audited-decision-replay.ts`, including `^hu_` (`hu_bb_defends_unread_to_price`, etc.) alongside `priced|value_share|multiway|plo6_facing|holdem_` rule receipts.
