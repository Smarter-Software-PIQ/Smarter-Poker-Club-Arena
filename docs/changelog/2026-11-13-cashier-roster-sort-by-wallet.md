# 2026-11-13 Cashier Roster Sorts By Last Transaction, Agent Wallet And Player Wallet

Dan: "FOR THE CASHIER, PLAYERS DISPLAYED SHOULD BE DEFAULTED BY LAST TRANSACTION, AND NEXT TO 140 RESULTS, SHOULD BE TO SORT BUTTONS. SORT UP OR DOWN BY AGENT WALLET BALANCE AND PLAYER WALLET BALANCE. THERE SHOULD BE A TOGGLE TO INSTANTLY SHOW HIGH TO LOW OR LOW TO HIGH FOR BOTH. WITH HIGH TO LOW BEING THE DEFAULT WHEN CLICKED."

## Root cause

- "Most Recent" was a per-browser list of recent recipients (`useRecentRecipients`), not the club ledger.
- The agent wallet was read only for the 25 rows on screen, so no sort could order the whole roster by it.

## Change

- `fn_cashier_roster_sort_keys(p_club_id)` (migration `20261113173905`): player wallet, agent wallet and newest cashier ledger row (the Transaction History types) for every member in the viewer's `fn_club_cashier_members_v2` scope. Read only.
- The roster opens on Last Transaction every visit. Agent Wallet and Player Wallet buttons sit beside the result count; the first tap sorts High To Low, the next flips to Low To High. "Sort By Last Transaction" in the filter row restores the default.
- Pure comparator in `src/lib/cashierRoster.ts`, pinned by `tests/unit/cashierRosterSort.test.ts`.

## Same day, round 2: transaction history words and phone fit

Dan: "THE TRANSACTION DESCRIPTIONS CAN BE MASSIVELY IMPROVED. THERE SHOULD BE -400 WHEN A PLAYER CASHES OUT" and "THE CASHIER PAGE ... NEEDS TO BE OPTIMIZED FOR MOBILE, TOO MANY WORDS CUT OFF".

- Signs: `ledgerDisplaySign` keeps the viewer's own in/out, and gives a club-book row the sign of the member whose wallet moved: a cash-out request reads -400, a cancelled or expired one +, a claim back or removal -. Totals still sum by `ledgerDirection`.
- Titles: `ledgerRowTitle` says what happened ("Probyourmom Moved Chips To Their Player Wallet", "Burls Sent To Woowoo", "Club Bank Paid Night Owl", "Burls Claimed Back From Emo", "Ticket Sent To Jmarov2") instead of "Transfer X To Y". Cash-out titles unchanged. The receipt carries it as Activity, and the CSV export uses it.
- Sub line: the wallet route and time only (the kind stays on the receipt); a cash-out request also says Waiting / Accepted / Cancelled / Expired.
- Phone fit, rendered at 300 and 393 px: the club name gives way before Advanced; history chips print short faces (Club, Mine, All, In, Out, All Time) with the full names kept as accessible names; the search placeholders fit; the action dock and the sort buttons stay on one line.
- Pinned by `tests/unit/ledgerRowWords.test.ts`; existing history tests updated to the new wording in the same commit.
