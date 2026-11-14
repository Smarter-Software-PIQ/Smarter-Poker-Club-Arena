# Member and cashier figures carry exact decimal text

Follow-up to `2026-11-14-real-figures-are-never-abbreviated.md`. A JSON number
keeps about 15 significant digits, so a figure that arrives as one can lose
digits in `JSON.parse` before any formatter sees it. The listed read paths now
also carry each money figure as exact decimal text, and the display prefers it.

| Surface                                   | Read                                       | How the text arrives                           |
| ----------------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| Player Management roster wallets and fees | `ca_club_members_page` (jsonb)             | `<key>_text` twins, migration `20261114172156` |
| Roster overview                           | `ca_club_members_overview` (table)         | `textTwinSelect(ROSTER_MONEY_KEYS)`            |
| Member record wallets and stats           | `ca_club_member_detail` (jsonb)            | `<key>_text` twins, same migration             |
| Member record win / loss card             | `ca_club_member_win_loss` (jsonb)          | `cash_text`, `mtt_text`, `net_text`            |
| Member record downline fees               | `ca_club_member_downline_in_range` (table) | `textTwinSelect(DOWNLINE_MONEY_KEYS)`          |
| Cashier roster player wallet              | `fn_club_cashier_members_page_v3` (table)  | `CASHIER_ROSTER_SELECT`                        |
| Cashier history rows, receipt, CSV        | `fn_cashier_history_feed` (table)          | `HISTORY_FEED_SELECT`                          |

The jsonb twins come from `public.ca_jsonb_figure_text`, which copies each
named number's own jsonb text (exact digits and scale). Nothing is recomputed,
no query is added, and a redacted figure gets no twin. A live wallet update
keeps a twin only while its number is unchanged (`keptTwin`). Player Record
money (`playerRecordMoney`) now accepts text; a number keeps the cents rule.

Proof (rollback-only `pg_temp` probe on production, KINGS CLUB owner): all
three patched functions returned output identical to the installed ones apart
from the twins, and every twin equalled its number's text.

Note: `chip_transactions.amount` is `numeric(14,2)`, which a JSON number always
holds exactly, so the history rows were not losing digits; they carry the text
anyway so every cashier figure follows one rule.
