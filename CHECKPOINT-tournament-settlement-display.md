# Tournament Settlement Display (Burls, Sunday 200 Deep Stack, 2026-11-01)

Status: CLOSED for implementation and financial verification. One item outstanding: an observed production bust (see Outstanding Proof).

## Incident
- Tournament `b85c5ce4-5d17-4f1d-9ca7-81c6a225701c` (Sunday 200 Deep Stack, 316 entrants, COMPLETED).
- Burls (user `7e616640-58dd-4d8d-a18e-2f37f057bcd9`) busted 39th at 23:35:07Z; elimination commit (position, prize, wallet credit) landed 23:38:41Z.
- Finish card backfill stopped after 9s, so the card read Finished / Total Payout 0.
- Settlement notice printed 507.96 while the payout ladder printed 508.

## Delivered
- PR #9238, squash-merged as `0508fcf3c17bffbb2496d612d8a89cefb01cb471`.
  - `TournamentRankingHost.tsx`: backfill runs 6 quick looks then every 5s up to 6 minutes; fills `bounty_winnings`; a read error is reported once and the loop continues.
  - `TournamentRankingCard.tsx`: with no place and no figure the reward prints Pending, never 0.
- Migration `20261101235311_tournament_cash_notice_prints_the_rounded_whole_chip_figure`: `trg_ca_notify_tournament_cash` prints `round(amount)`. Installed by Apply Merged Migration run 41375700771 (APPLIED 02:04:40Z); recorded in `supabase_migrations.schema_migrations`.
- Live client: build-info `ca_sha` `3634e37fa52db1c76de3028470c9328cc3d242f0` (built 02:06:06Z) at both ca-static.smarter.poker and smarter.poker/hub/club-arena; contains `0508fcf3`; finish card, host and `pendingSessionSummary.ts` unchanged between the two.

## Finish Screen Verification
LIMITATION: run against the published source (`0508fcf3`) with a simulated database, not an observed production bust. Test file was a one-off (not committed); reproduced below.

Command: `npx vitest run tests/verify/settlementPendingE2E.verify.test.tsx` in a detached worktree at `0508fcf3`.

| Case | Evidence |
|---|---|
| Prize 507.96 + bounty 12 land on read 9 (~19s) | Pending at bust and at 12s; 519.96, 39th after the row lands, no reload |
| First read errors, then row lands | error reported once; 519.96, 39th |
| No row for 8 minutes | Pending at 8m, never 0; reads stop at the 6-minute limit (77); reopening after settlement shows 519.96, 39th |

Reopen path: the report persists in sessionStorage (`club-arena-finish-reports-v1:<userId>`) and the host reruns the backfill on mount. A card the player dismissed while Pending does not return; notification, wallet and Ranking tab carry the payout.

## Financial Verification (read only, no repayment)
- Burls: exactly one prize credit, `wallet_transactions` `22175753-fa68-4110-9215-e82303b5997f`, 507.96, "Tournament prize: position 39", 23:38:41Z. `tournament_players`: position 39, prize 507.96, bounty 0. One `tournament_payouts` row.
- Event payouts: 49 paid players (places 1-48 plus bubble protection for place 49), 49 `tournament_payouts` rows, 49 distinct users.

## Notification Reconciliation
- 49 `tournament_cash` notices = 48 place notices (places 1-48) + 1 `bubble_protection` notice (place 49, 180.00 buy-in returned). The earlier "48 paid finishers" figure was wrong; 48 is the place notices only.
- 49 distinct recipients, 49 distinct `obligation_id`, 48 distinct places, no duplicate recipient.
- Every place notice matches its player's `tournament_players` row on user, position and prize. The bubble notice matches on user and amount (180.00); place is null by design for that kind.
- Display-only text edits: 47 place notices in one bulk update, Burls' separately, and the bubble notice (180.00 -> 180) after it was found still showing decimals. `data.amount` untouched on all 49 (sum 61,380.00, equal to the recorded prizes of the same 49 players). No notice deleted, no wallet entry created.

Reconciliation query:
```sql
with n as (select n.user_id, n.data->>'obligation_id' ob, (n.data->>'place')::int place,
  n.data->>'kind' kind, (n.data->>'amount')::numeric amt
  from notifications n where n.type='tournament_cash'
  and n.data->>'tournament_id'='b85c5ce4-5d17-4f1d-9ca7-81c6a225701c')
select count(*), count(distinct user_id), count(distinct ob), count(distinct place),
  string_agg(distinct kind, ',') from n;
```

## Outstanding Proof
- Observed production bust showing Pending then the settled total on the live client. No supported tournament test route exists in the repository, and producing one would require paid tournament activity. Capture on the next natural tournament finish by a beta account (KingFish or Danimal).
