# Settlement History and Credit Admin wear #SmarterDesign (batch O2)

2026-11-28. Dan's order of 2026-11-27 ("THE SAME #SMARTERDESIGN UPGRADE TO
EVERY SINGLE PAGE") applied to two operator money pages that still printed
in the painted consoles.

## What changed

- **Settlement History** (`/settlement-history`): the arena workspace root,
  Back as a chrome key above the finance mast, the cycle count on the live
  line, the three totals on chrome readout tiles, the timeline and the cycles
  in chrome cases, one chrome ledger row per cycle, Retry lit on the error
  state.
- **Credit Admin** (`/credit-admin`): the same shell; the Credit Requests
  inbox as a chrome case with Approve lit; the exposure totals on readout
  tiles (the limit total takes a full row on a phone so it never breaks) with
  Export Shown Rows lit; Agents and Recent Credit Changes as chrome cases of
  chrome rows; Edit, Save (lit) and Cancel as chrome keys and the new limit in
  a dark well.

## What did not change

No figure, credit limit, rate, word, data hook, named region, control,
confirmation or accessible name. Both pages were pinned on main first
(`tests/components/settlementHistoryPageIsPinned.test.tsx`,
`tests/components/creditAdminPanelIsPinned.test.tsx`) in every state, and the
pins hold unchanged. The shared Credit Requests widget keeps its markup and
its look on the Super Agent Dashboard: its arena dress lives in Credit
Admin's own sheet, under that page's root.

## Left

Rate Audit is edited by open PR #12313. Agent Portal waits for #12359's
`TransactionLedgerView` `arena` prop and needs its `AgentInvoicesPanel`
console converted. Both converted pages keep the painted
`FinancialAdminScopeState` for their scope states until #12359 merges; then
pass `arena`.
