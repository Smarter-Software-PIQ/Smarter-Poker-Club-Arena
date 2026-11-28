# Agent Team: the Hierarchy and Payouts tab bodies wear #SmarterDesign (2026-11-28)

PR #12312 put the Agent Team page shell (`src/pages/AgentManagementPage.tsx`)
on the arena workspace, but two of its tab bodies still wore the old dress.
This is batch 6 of the #SmarterDesign sweep. CSS and markup only: no handler,
guard, hook, string, role, aria attribute, number format or data hook changed.

## Hierarchy tab

- **Assign And Transfer** (`AgentAssignmentPanel.tsx`) sat on the painted
  `SpadeConsole`. It now renders through `ClubPageSection arena`: the eyebrow,
  section title and Staff count, dark wells for the three fields, chrome keys
  with Review Assignment Or Transfer lit, and the transfer review on a chrome
  row.
- **Assignment History** (`AgentAssignmentHistory.tsx`): lit words became
  chrome keys, the search field a dark well, each record a chrome row with its
  timestamp in the live ink and a Transfer Details disclosure with the ledger
  chevron.
- **The tree** (`AgentTree.tsx`, `AgentTree.module.css`): the rounded gradient
  cards, blurred buttons, gold avatar disc, glowing status pills and the
  triangle glyph on the empty state are gone. The tree is a chrome case with a
  search well and chrome keys; each agent is a chrome row with four readout
  tiles (two across on a phone, so no balance is cut short as it was before),
  a two-stroke chevron expander on a 44px target, the status word in its rule
  ink and Send Chips a chrome key. Every rule in the module is scoped under
  `.arena-workspace`.

## Payouts tab

`AgentCashoutPanel` is shared with the Cashier trade page (a dialog, which
stays on the painted console under #ClubArenaConsole) and the player record.
It takes a new `arena` prop that only Agent Team passes. With it the panel
renders in a chrome case, Refresh, Approve Cashout (lit), Reject (error ink),
Send To Notice Board and Retry are chrome keys, each request is a chrome row
and the console's container-query sizes are replaced by px. Without it the
panel is unchanged apart from a wrapper around the Send To Notice Board and
Retry words that lays nothing out (`display: contents`). The dress lives in
`AgentCashoutArena.css`, every selector under `.arena-workspace .acp--arena`.

## Pinned

- `tests/components/agentTeamTabBodiesArePinned.test.tsx` pins every printed
  figure (`tests/helpers/moneyFigures.ts`), the printed words in order, every
  named region and every control with its disabled state, for the tree
  (expanded, empty, failed), Assign And Transfer (with history, and reviewing
  a transfer) and Pending Cashouts (decidable, noted and escalated requests,
  empty, failed). The snapshots were recorded against the old components on
  main `c6ec86b51` and pass unchanged. A further case asserts the arena
  cashout case prints exactly what the console prints.
- `tests/unit/agentTeamArenaDressIsScoped.test.ts` asserts the scoping, no
  gradient, radius, shadow, hover or uppercase of their own, and that only
  Agent Team opts into the arena cashout case.

## Found, not changed here

- The tree prints `commissionRate` as stored (a fraction), so a 40% agent
  reads "0.4%". That is a number format, outside a CSS and markup pass.
- The tree's role colours are inline JSX hex values (amber, violet, blue),
  not schema inks, and its failure text is "Failed to load agent hierarchy"
  (lower case). Both are strings outside this pass.
- Commissions and Players tab bodies, and the player record's Cash Out
  Requested section, remain for a later batch (see the inventory's
  Recommended Batch 7).
