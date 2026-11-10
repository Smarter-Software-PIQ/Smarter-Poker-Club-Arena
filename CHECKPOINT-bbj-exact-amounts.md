# Bad Beat Jackpot exact amounts, 2026-11-09

Owner: this chat (Claude cloud session 01BNteGc7H6LV4JDQbe5854j). Branch
fix/bbj-exact-amounts. Owner instruction with a Kings Club popup screenshot:
"for the bbj display the full amount down to the decimal and the exact amounts
for the payouts... no rounded numbers. use exact numbers 100% of the time ...
make all changes and backlog corrections now".

Scope: every Bad Beat Jackpot chip figure prints to the cent (pool, mini, each
recorded payout and share, projected payouts). Excludes Diamond jackpots (whole
by custody), club-opening BBJ seed copy, non-jackpot compact figures, engine,
schema and stored data.

Policy reader 2.9 emitted 2026-11-10T00:23:09Z; owner policy, operating law,
hardening standard, reference index, root AGENTS.md, CLAUDE.md and the console
skill harness section read in this session. Mac canonical copies not reachable
from the cloud session (no connected folder).

Cause: display only; stored columns are numeric(…,2). Backlog read on
production: 220 bbj_payouts, 0 non-cent totals, 0 share-sum mismatches, 0
recipient-sum mismatches, so history needs no data correction.

Local evidence on the candidate: app compiler clean; eslint 0 errors on changed
files; prettier clean; affected vitest files pass (new law, history payout,
recent hits, mini law, initial layout, law registry and the other jackpot
suites). Popup rendered headless at 393px with production figures: header
15,379.83, rows 5,022.37 / +2,511.18 and 5,538.89 / +2,769.46, Basic page
74,116.66 = 37,058.33 + 18,529.17 + 18,529.16 at a 185,291.65 pool; no
overflow.

Acceptance: protected merge, publish-club-arena success, both build-info
endpoints on a revision containing the change, popup shows exact figures live.
