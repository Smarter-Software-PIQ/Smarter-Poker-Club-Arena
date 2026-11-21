# holdemValueAndCallsArePriced reaches single-board tables

2026-11-20, Horse SWITCH lane (session_01UxDLnM4cwZVwdaVF3xHY2s), found while grading the option's league card.

- Defect: `holdemPricedOpponent` (HorseLogic.ts) returned 'out' when `gs.communityCards2 !== undefined`. Production
  (ServerTableEngineTurns.ts, LightningHorse.ts) and the league decision state (LeagueDecisionState.ts) set
  `communityCards2: []` on every single-board table, so the option could never act, even switched on. The law
  fixtures omit the field, so they passed. League card `nlh_holdem_value_and_calls_are_priced`: 0 receipts in 600 hands.
- Fix: a second board counts only when it has cards (`communityCards2?.length > 0`).
- Off path unchanged (the option is read `=== true` first). Default OFF; no switch row.
- Test: HoldemValueAndCallsArePriced.law.test.ts "production's single-board state ... is in scope; a dealt second board is out"
  (fails on the old line, passes on the new; 44/44).
