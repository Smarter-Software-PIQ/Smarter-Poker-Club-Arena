## Batch S1: the Settlement Center

| #   | Surface           | File                                    | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ----------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | Settlement Center | `src/pages/SettlementDashboardPage.tsx` | Two painted spade consoles became the arena workspace: Back a chrome key above the finance mast, the scope a chrome status line, the weekly workspace in a chrome case (its `WeeklyAccountingArena.css` dress now applies), the ledger in a second case under its section title. `TransactionLedgerView` and `FinancialAdminScopeState` gained an opt-in `arena` prop (chrome ledger rows, a lit Try Again or Retry key, the scope states on the mast); their other hosts keep their look. |

Every figure, word, region and control was pinned on main first
(`tests/components/settlementDashboardIsPinned.test.tsx`, eleven states) and
passes unchanged; the dress is held by
`tests/unit/settlementDashboardArenaDressIsScoped.test.ts`.

Union Statements was skipped: open PR #12313 (figures cut, never rounded)
edits `src/pages/UnionStatementsPage.tsx`. Financials still prints its Club
Chip Audit Trail on the painted ledger dress inside an arena case; passing
`arena` to its `TransactionLedgerView` converts it once a before/after is
approved.
