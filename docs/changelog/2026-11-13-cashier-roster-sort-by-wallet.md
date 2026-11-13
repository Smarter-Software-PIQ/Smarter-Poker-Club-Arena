# 2026-11-13 Cashier Roster Sorts By Last Transaction, Agent Wallet And Player Wallet

Dan: "FOR THE CASHIER, PLAYERS DISPLAYED SHOULD BE DEFAULTED BY LAST TRANSACTION, AND NEXT TO 140 RESULTS, SHOULD BE TO SORT BUTTONS. SORT UP OR DOWN BY AGENT WALLET BALANCE AND PLAYER WALLET BALANCE. THERE SHOULD BE A TOGGLE TO INSTANTLY SHOW HIGH TO LOW OR LOW TO HIGH FOR BOTH. WITH HIGH TO LOW BEING THE DEFAULT WHEN CLICKED."

## Root cause

- "Most Recent" was a per-browser list of recent recipients (`useRecentRecipients`), not the club ledger.
- The agent wallet was read only for the 25 rows on screen, so no sort could order the whole roster by it.

## Change

- `fn_cashier_roster_sort_keys(p_club_id)` (migration `20261113173905`): player wallet, agent wallet and newest cashier ledger row (the Transaction History types) for every member in the viewer's `fn_club_cashier_members_v2` scope. Read only.
- The roster opens on Last Transaction every visit. Agent Wallet and Player Wallet buttons sit beside the result count; the first tap sorts High To Low, the next flips to Low To High. "Sort By Last Transaction" in the filter row restores the default.
- Pure comparator in `src/lib/cashierRoster.ts`, pinned by `tests/unit/cashierRosterSort.test.ts`.
