# Promo fee state is read from an hourly snapshot (2026-11-19)

Owner ruling (Dan, 2026-11-18): promo progress is not checked after every hand; it is
updated once per hour, only for accounts with active promo chips; the check at the
cashier on a cash-out is right; promo can never cause payout issues.

`20261118194330` retired one per-hand caller. The cost stayed on every money path
because it lives in `fn_ca_promo_shared_fee_state`, which recomputed an account's
whole fee history on every call (1,085 ms average on production over 30 accounts with
an open grant). Hands, buy-ins, rebuys, add-ons, bounty and prize credits and
satellite seats all reached it, and each settle held every grant row of the account
`FOR UPDATE` while it recomputed. On 2026-11-18 23:30 to 23:45 UTC the satellite path
timed out 82 times inside it and 63 add-ons failed on the `NOWAIT` in
`fn_ca_promo_profit_prelock_source`. The hourly sweep was not the holder.

Migration `20261119002019_promo_fee_state_is_read_from_an_hourly_snapshot.sql`:

- the recomputation keeps its body as `fn_ca_promo_shared_fee_state_live`;
- `ca_promo_fee_state_cache` keeps one snapshot per account; the reader returns it
  while it is under two hours old, no grant has expired since and the account's promo
  structure is unchanged (a 0.28 ms signature check), otherwise it recomputes;
- a release (winnings gate, met grant) is decided on the live history only;
- a cash-out (wallet exit trigger, cashier ticket sale) reads live, always;
- the sweep refreshes the snapshot hourly, looks without holding any lock and locks
  only to act, with `NOWAIT`.

Known and accepted, all in the direction of holding longer, never releasing early:

- a tournament fee reversed between a threshold crossing and the next sweep leaves a
  gate locked that the per-hand path had already released;
- for up to an hour after the fees are paid, a hand or buy-in still treats that promo
  as locked (custody follows the chips), and the progress summary can lag the same way;
- a cash-out never lags: it is answered live.

Proof: `scripts/ci/test-promo-profit-fee-state-snapshot.py` (31 checks, run by
`scripts/ci/test-promo-profit.py`).
