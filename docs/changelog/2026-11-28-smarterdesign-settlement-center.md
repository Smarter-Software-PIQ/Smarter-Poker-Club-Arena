# The Settlement Center wears #SmarterDesign (batch S1)

`/settlement-dashboard` printed its weekly accounting and its chip ledger in
two painted spade consoles, the old style on a page (Dan, 2026-11-27). It now
wears the arena workspace, the same as the Settlement page beside it:

- Back is a chrome key above the finance mast; the mast names the club the
  finance scope chose and carries the summary behind the chrome "?".
- The scope (Club or Account) is a chrome status line under the mast.
- The weekly workspace sits in one thin chrome case, so the
  `WeeklyAccountingArena.css` dress from batch 5 now applies here too.
- The ledger sits in a second case titled Club Transaction Records (or Your
  Account Transactions) with Verified at its edge; the case is still the one
  region carrying that name.
- With no club chosen, Open Clubs (lit) and Open Unions are chrome keys.

Two shared components gained an opt-in `arena` prop, passed only here:

- `TransactionLedgerView`: each movement a chrome ledger row, Try Again a lit
  chrome key, the workspace's inks (`TransactionLedgerArena.css`).
- `FinancialAdminScopeState`: the checking, restricted and unverified answers
  on the finance mast, the message in a chrome case, Retry (lit) and Back as
  chrome keys (`FinancialAdminScopeArena.css`).

Union Operations, the Agent Dashboard, the Agent Portal, Financials,
Settlement History and Credit Admin do not pass it and keep their look.

Money screen rule: every printed figure, word, data hook, named region and
control was pinned on unchanged main first, in eleven states (club ledger
loaded, empty, failed, refused and in flight; no club chosen; account not
ready; finance scope loading, denied and in error), and every pin passes
unchanged (`tests/components/settlementDashboardIsPinned.test.tsx`). Every new
rule is scoped under `.arena-workspace`, with no hover, gradient, shadow or
radius of its own (`tests/unit/settlementDashboardArenaDressIsScoped.test.ts`).
The console contract and the scope law read the arena markup, and
`financial-admin-deep` checks the Settlement Center as an arena case.
`SettlementPage.module.css` had no other user and is removed.

Skipped: Union Statements, because open PR #12313 edits it.
