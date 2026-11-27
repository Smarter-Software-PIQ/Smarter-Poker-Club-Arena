# Over-fold scoreboard (live)

`scripts/ops/horse-overfold-scoreboard.mjs` (pure core `horse-overfold-scoreboard-lib.mjs`). Read-only.

The over-fold alarm (`horse-plo-overfold-gate.mjs`) gates Horse folds facing a **person's first bet**, table and
Lightning pooled. When no person plays (as after the over-fold fixes went ON on 2026-11-27) it has nothing to read,
and it never looked at raises, check-raises, bets over 1.1 pot or Lightning on its own. The scoreboard shows what the
**serving engine** actually folds on the hands it dealt, in every cell, facing people (the headline) and facing
Horses (information).

```
node scripts/ops/horse-overfold-scoreboard.mjs --since <ISO> [--until <ISO>] [--build <engine_build prefix>]
     [--people-days 14] [--json] [--out board.md] [--save-json rows.json] [--from-json rows.json]
```

- **Read**: every PLO4/PLO5 cash hand in the range (table and Lightning: `lightning_hand.hand_history_id`), with or
  without a person; `--build` keeps only hands one engine build dealt (`hand_history.engine_build`). People's own
  folds: hands with a person over the trailing `--people-days` (0 skips). Keyset pages, `SET TRANSACTION READ ONLY`.
  **No hole-card, showdown or winner column is selected.**
- **Cells**: game x table / Lightning (and pooled) x flop / turn / river x heads-up / 3-way / 4-way+ x facing a bet
  of <0.4, 0.4-0.7, 0.7-1.1, 1.1+ pot, a raise or a check-raise x bettor (person or Horse). Out of / in position are
  columns. Size of the faced aggression = the aggressor's added chips / the pot before his action.
- **Break-even**: per decision s/(1+s) heads-up, (s/(1+s))^(1/k) multiway (k opponents left).
- **People ceiling**: facing a person's first bet heads-up, the people prior table (the alarm's ceiling); otherwise
  people's own fold share in the same cell (people deciders only, never a HUD row), at least 30 decisions.
- **Flags**: 20 decisions per cell; OVER at 2 SE against either ceiling. Only **person**-bettor cells gate, at the
  multiple-comparison bar correctedZ(2, person tests); a gating cell whose owner fix (alarm owner map) is ON for the
  whole range is BREACH-CLASS. Horse-bettor cells never gate: a Horse's bets are not a person's range, so folding more
  to them can be right; their break-even column says only whether a pure bluff would print.
- **Fold-through**: every bet or raise into a Horse-only field, did every opponent fold on that street, against
  s/(1+s), with the bb value of a zero-equity bluff.
- **Exit**: 0 clean facing people, 1 a person cell gates, 2 no person cell has 20 decisions, 64 usage, 70 read failed.
- **Daily audit**: runs it over its range (`overfold-scoreboard`). Its regression rows are only the person cells the
  alarm does not already gate (raises, check-raises, Lightning cells); the summary lists every OVER cell.
