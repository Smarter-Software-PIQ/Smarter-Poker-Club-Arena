# A promo winnings credit never settles promo progress inside a payout

2026-11-19, incident 075013fd, lane E3. Migration
`20261119053144_a_promo_winnings_credit_never_settles_promo_progress_inside_.sql`.

## Owner rulings

- Promo chips can not and should not ever cause payout issues with tournaments or cash games (Dan, 2026-11-17).
- Promo progress is updated once per hour, only for accounts with active promo chips, and checked at the cashier on a cash-out; never per hand (Dan, 2026-11-18 13:40 CT).

## What was wrong

1. `fn_ca_promo_profit_credit_owned` (every prize, bounty, cash win, BBJ and stake refund to a promo holder) ran `fn_ca_promo_profit_settle` before deciding whether the credit is restricted. When the holder's hourly snapshot is not current, or shows a gate as met, that settle recomputes the account's whole fee history. The hourly sweep measures that at 1,110 ms mean and 15.6 s max per account. At 05:25 UTC, 826 accounts held a locked winnings gate and 412 of them had no current snapshot. A final table paying ten of them could spend ten seconds or more on promo arithmetic while it held the event's terminal lane.
2. `fn_ca_promo_profit_finish_entry_fee` was rewritten by `20261119002717` (satellite seat) from the body that came before `20261119001629`. That put the settle #11329 had removed back on every paid entry fee (production md5 `345276d5...`).

## What changed

- The credit decides on the gate as stored (`ca_promo_profit_gates.unlocked_at`, overrides) and never settles. The hourly sweep releases gates every hour, and the wallet exit trigger settles live before any chip leaves.
- Every entry fee, paid entry or satellite seat, is consumed exactly once and never settles.

## Why the restriction rule stays correct

A credit adds no fee progress, and the settle only ever releases. The outcome is identical whenever production decided without a live recomputation: gate released, gate overridden, zero credit, replay, locked below target, and locked with a stale but current snapshot. The two states production decided live (target met since the last hourly look, with the snapshot invalidated or showing it met) are now held under the still-locked gate. The next hourly pass, or the holder's cash-out (always live), releases them. `fn_ca_promo_profit_locked_at` counts custody only under a locked gate, so those chips are free the moment the gate opens. The hourly snapshot (`20261119002019`) already takes this path for a stale "locked" answer. Nothing is ever released early.

## Proof

`scripts/ci/test-promo-winnings-credit-never-settles-progress.py` runs on native PostgreSQL 16/17 against the production bodies with their md5s pinned. It covers the outcome of every holder state before and after, the live cash-out release, and conservation: one receipt per credit, custody equal to the restricted total, no partial restriction and no new fee phase. Measured in the fixture: an 8-holder payout took 1,209 ms with 4 live recomputations before and 27 ms with none after; 40 holders without a current snapshot took 37 ms with none. The law is `tests/a-promo-winnings-credit-never-settles-promo-progress.law.test.ts`.

## Still on the payout path

`fn_ca_promo_custody_on_ledger` still runs `fn_ca_promo_play_through_settle` (the principal settle) for a prize credited from `prize_liability`. It is cheap when the snapshot is current, and live otherwise, for the 366 accounts with an open grant. It decides principal release and is not changed here.
