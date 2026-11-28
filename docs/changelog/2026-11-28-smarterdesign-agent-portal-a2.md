# The Agent Portal wears #SmarterDesign (batch A2)

2026-11-28. Dan's order of 2026-11-27 ("THE SAME #SMARTERDESIGN UPGRADE TO
EVERY SINGLE PAGE") applied to the Agent Portal, plus three follow-ups left
by earlier batches.

## What changed

- **Agent Portal** (`/agent-portal`): the arena workspace root, Back as a
  chrome key above the finance mast, the wallet scope (Reading, Scoped,
  Closed, Unavailable) on the live line. Business, Play and Promo Wallet are
  chrome readout tiles with Transfer To Play lit; Credit Line and the
  Commission Ledger are chrome cases of chrome rows; My Transactions is a case
  around the ledger, which now takes the `arena` prop S1 added. The transfer
  dialog is a popup and keeps its painted console (#ClubArenaConsole).
- **Credit Invoices** (`AgentInvoicesPanel`): one chrome case, every invoice a
  chrome row, Pay Now and Retry lit. The Agent Portal is its only host, so it
  was converted outright and its module sheet removed.
- **Settlement History and Credit Admin**: their finance-access screens
  (checking, restricted, unavailable) pass `arena` to
  `FinancialAdminScopeState` and wear the workspace.
- **Community Search**: the index status words read Live Data, Partial Index
  and Recent Snapshot instead of all caps.

## What did not change

No figure, commission, invoice amount, word, data hook, named region,
control, confirmation or accessible name on the Agent Portal. It was pinned
on main first (`tests/components/agentPortalPageIsPinned.test.tsx`) and the
pins hold. Two pin updates are deliberate: the Search status words, and the
scope-state frame words that moved into the mast and live line.

## Left

The Friends page panels (`FriendActivityFeed`, `FriendSuggestions`,
`FriendChallengesPanel`) wait for open PR #12369, which edits
`src/pages/FriendsPage.tsx`.
