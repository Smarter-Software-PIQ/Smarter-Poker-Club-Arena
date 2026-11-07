# The union promo is paid once per player (2026-11-07)

Owner report, 01:09 Central: "YOU SENT THE 25 CHIPS TO ALL THE PLAYERS TWICE.
REMOVE THE DUPLICATE 25 CHIPS THAT WAS SENT TO ANY AND ALL PLAYERS WALLETS THAT
HAVEN'T TOUCHED IT YET... IF A PLAYER HAS ALREADY SPENT IT OR DOESN'T HAVE THE
EXTRA 25 IN THERE WALLET, DON'T WORRY ABOUT IT." Then: "IDENTIFY WHICH PLAYERS
GOT 50, 25 CHIPS TWICE, AND ONLY CLAW BACK THE DUPLICATE 25 IF ITS AVAILABLE."

## What was wrong

160 `Union Promo Disbursement` legs of 25 chips had reached 128 members. 32 of
them had been paid twice and held 50.

## The settlement

29 of the 32 still held the duplicate: 725 chips were returned to
`union_wallets.promo_wallet`. 3 had already spent it (balances 20.55, 1.00 and
0.00) and were left alone on the owner's ruling. Every member keeps exactly one 25. No wallet went negative, the lowest balance is 0.00, and the books tally:
29 `reversal` legs totalling 725, 29 cashier rows, 29 union wallet credits, no
`ca_ledger_invariant_findings` row and no refusal.

`fn_promo_disburse` is a one-way door, so the claw-back needed one:
`fn_ca_union_promo_reverse_duplicate` (20261107071720). It reverses one named
promo leg, refuses any leg that is not a union promo to a player, is gated to
the union owner or a service caller, reverses a leg at most once, and skips
rather than driving a wallet negative. Its single `reversal` leg is written by
`club_members`' own autoledger writer with `union_wallets` stood down and
declared as counterparty, so both account keys tally at commit. It was proved
in a rolled-back `DO` block (11.5), then committed for one member and checked
against the commit-time invariant before the other 28.

## The cause, and the much larger exposure ahead of it

`fn_sp_signup_welcome_back_run` (20261104145956) pays this promo and was never
wrong. It skips any player with an `'awarded'` row in
`sp_signup_welcome_back_awards`, derives `v_op` from the player id so
`fn_promo_disburse` answers a replay, and keys the awards table on `user_id`.

It was bypassed. Of the 160 legs, **127 came from agent backfills through the
management API** calling `fn_promo_disburse` directly with fresh random
op_ids, and 33 from the live runner. 128 members were paid and only **33 had an
awards row**, so the runner was blind to 95 of them. That is the duplicate
mechanism exactly: the 9 members paid at 22:08 by a backfill were paid again at
22:17 by the runner, which had no record of the first payment.

The 725 already paid out was the smaller half. All 95 unguarded members are
past the 24-hour mark and 53 sit inside the runner's since-launch window, so
the next runs would have paid roughly **1,325 chips more** in duplicates, with
the remaining 42 exposed the moment `p_since` is widened.

## The fix

`20261107130207` makes the existing guard complete: an `'awarded'` row for
every member the ledger shows was paid, carrying the same deterministic op_id
the runner derives, so both the awards guard and `fn_promo_disburse`'s op_id
idempotency now refuse a second payment. It asserts zero unguarded members
before it commits. It moves no chips - it repairs the record of payments
already made so the live path stops re-paying them.

## Two things that were tried and are now pinned against

**A second guard.** `20261107124625` added `ca_union_promo_campaign_claims` and
`fn_ca_union_promo_grant_once`: a parallel claim table for a campaign that
already had a guard. That is CLAUDE.md 10.84 - three lists had to agree and
nothing checked them - and the next agent could not have told which was
authoritative. `20261107130207` drops it. `sp_signup_welcome_back_awards` is
the only guard, and its table comment now says so.

**A scheduled repair.** The first attempt at the fix was an hourly audit that
found duplicate promo legs and clawed them back automatically. CLAUDE.md 10.12
forbids precisely that - "IT IS NO LONGER ALLOWED TO CREATE ANYTHING THAT
MONITORS AND BACK FILLS OR ADJUSTS A PAYOUT ... NOT A FUCKING BAND AID!" It was
refused by the `:50-:03` DDL break window before it applied, and then dropped
on reading the law rather than retried. Nothing of it reached production: no
`fn_ca_duplicate_promo_audit`, no waiver table, no cron.
`tests/the-welcome-back-promo-has-one-guard.law.test.ts` refuses both shapes.

## The proof had to stay cheap

`20261107130207` declares its own `-- @live-proof:` because it creates no
persistent object - it drops two and writes rows - and
`tests/a-merged-migration-must-be-live.law.test.ts` caught that on the first
push. The proof checks both halves: the parallel guard is gone, and no member
the ledger shows was paid is missing an awards row.

That proof reads the promo legs with `created_at >= '2026-11-04'`, and
`chip_ledger` is 26,065,062 rows with no index on `category` or `description`.
Today that window is 438,631 rows; it only grows, for an answer that concerns
160 of them. `20261107134957` adds a partial index on the union promo door's own
leg shape, built with the sanctioned `CREATE INDEX CONCURRENTLY` preamble on the
same grounds as `20260920185803` and `20260925205938`: a plain `CREATE INDEX`
would hold ACCESS EXCLUSIVE on the money table for the whole build and stall
live play, and a daily-window file's 1 s lock / 5 s statement / 8 s budget
cannot fit a 26M-row build. The transaction refuses an INVALID leftover by name,
because a failed concurrent build leaves an unusable index the planner ignores -
which would look exactly like success.

## One more defect found while auditing this work

The backfill joined `chip_transactions` on `(to_user_id, type, amount)`, and the
32 double-paid members have TWO `promo_disbursement` rows each. The join fanned
out, `ON CONFLICT DO NOTHING` kept one arbitrarily, and the recorded
`transaction_id` was nondeterministic - worse, it could name the duplicate,
which is the payment that was reversed. A `LATERAL ... ORDER BY created_at
LIMIT 1` now takes the earliest, which is the payment that stands. Proved in a
rolled-back `DO` block: 95 rows inserted, 0 paid members left unguarded, 128
awards rows total, no two rows sharing a transaction id.

## Rule 11

`20261107071720` and `20261107124625` were applied directly through the
Supabase MCP during the live money incident, which CLAUDE.md section 2 rule 11
allows only for an outage that cannot wait, and requires the byte-exact
recording on main as the next step. Both are recorded in this PR at the exact
versions production holds, so `apply-merged-migration` answers ALREADY-APPLIED;
`20261107130207` is new and installs through the normal route.
