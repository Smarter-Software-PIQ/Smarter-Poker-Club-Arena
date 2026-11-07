# tests/a-zero-chip-settlement-error-is-not-a-settlement-error.law.test.ts

`fn_ca_escrow_balance_drift` filed 26 of the 46 unresolved `drift_incident:*`
rows in `financial_alerts`, and every one of the 26 was false. This law pins
both halves of the fix in migration 20261107143600 and refuses a later edit
that takes either back.

THE AMOUNT FILED IS THE AMOUNT TESTED. The detector tripped per bank - prize,
bounty and fee each against the shadow with a 0.01 tolerance - and then filed
the SUM of the three bank differences as `discrepancy_amount`. Two banks that
disagree by the same amount with opposite signs therefore tripped the test and
filed a `settlement_error` of exactly 0.00 chips. The amount was not computed
late and was not a rounding artefact: it was computed correctly and never
tested, while `classification` was the literal `'settlement_error'`, fixed
before any amount was known. One sweep tick at
`detected_at = 2026-11-03 12:35:00.159115+00` filed 25 of them across 25
distinct tournaments.

Re-measured 2026-11-07, all 25: every one is a CANCELLED Spin, 25/25 with
`gross_in` exactly equal to the sum refunded, 25/25 with `prize_out` 0, 25/25
with net `rake_records` 0 (booked by `fn_spin_book_entry`, reversed by
`atomic_cancel_tournament`), and 25/25 holding a maintained escrow of prize
0.00, bounty 0.00, fee 0.00, terminally closed. The escrow balances and nobody
is owed anything. The bank split disagrees only because the chip shadow keeps
the booked entry rake in its fee bank, its rake filter dropping the negative
`atomic_cancel_tournament` reversal on purpose, while
`tournament_refund_tranches` returns the whole gross as `refund_prize`: for
`debe4d81` the shadow reads `prize_in 276.00`, `fee_in 24.00`,
`exact_prize 300.00`, hence `prize_balance -24.00` and `fee_balance +24.00`,
summing to 0.00. The 25 bank gaps are 0.24, 0.48, 0.72, 1.20, 2.40, 4.80,
12.00 and 24.00 chips, each exactly 8% of that event's gross. That bank-split
disagreement is a defect of the shadow, for whoever reconciles `rake_records`
against the escrow; it is not a settlement error, and one of 0.00 chips tells a
reader nothing. So the guard is `v_diff <> 0` - the measured amount itself,
never a tolerance invented for the purpose - and the law asserts the only
numeric thresholds left in the predicate are the three pre-existing per-bank
0.01 comparisons, so the change can never widen what the detector catches.

A JOURNAL-BOUND CORRECTION IS ACCOUNTED FOR, NOT DRIFT. The 26th alert,
`detected_at = 2026-11-02 06:35:00.134568+00`, `discrepancy_amount -950.00` on
tournament `6b72abc3`, is the owner-authorized bounty/guarantee correction
already admitted by the door inside
`trg_freeze_finalized_tournament_prize_pool`. The correction moved its chips
out of `prize_liability` to the union bank as a `reversal` leg; the maintained
escrow saw that leg and the shadow does not count it, so the row reads low by
exactly the amount of the leg. The leg IS the accounting. The detector now
recognises it positively, as narrowly as the freeze trigger's own door: the
whole measured gap must sit in the prize bank (`v_prize_gap = v_diff`) and one
`chip_ledger` row of the same tournament must carry the tournament-scoped
`owner_bounty_guarantee` idempotency key, `category = 'reversal'`,
`from_type = 'prize_liability'` with this tournament as `from_entity_id`,
`to_type = 'union_bank'` with a destination, metadata kind
`owner_bounty_guarantee_correction`, a `tournament_before` object, a
`tournament_after` object, an `owner_instruction` string, and
`round(l.amount, 2) = - v_diff`. The law pins every one of those fields and
refuses two shortcuts the term must never take: no hard-coded tournament id and
no `interval` or time window anywhere in the predicate. A correction whose
ledger row is absent, of another kind, of another direction, of another amount,
or landing outside the prize bank is still a drift.

The proof is executed against production inside an explicitly rolled-back
transaction: the postimage installed, the new predicate asserted verbatim
inside the installed body, then evaluated. The old predicate raises 26 of 26
and the new one 0 of 26; 13 fabricated cases land with 0 mismatches, including
a genuine +777 and -777 gap, a -950 gap with the ledger row absent, a -949 and
a -951 gap against the real 950.00 leg, a -950 gap split -500 prize / -450 fee,
a +950 gap of the wrong sign, a 0.02 gap, three real
`prize_liability -> union_bank` reversals of kind `reviewed_void_overlay_return`
raising, and a zero-total +500/-500 bank split filing nothing. After ROLLBACK
the live body still read the preimage md5 and no incident and no alert had been
written. The law also pins both row images - preimage
`62bc43d2d2846fd066fc86919eb55598`, postimage
`9898d7b3dc17564f522892164c85de65` - so the migration refuses any other live
body, refuses a derived text that is not the proven postimage, and reads the
installed body back byte-identical.

The 26 alerts already filed are deliberately NOT resolved by this migration and
no one-off cleanup ships with it; the law asserts the migration updates neither
`financial_alerts` nor `ca_drift_incidents`. All 26 twin incidents are already
`resolved` with `closure_basis = 'aged_out_unverified'`, so they need the
generic closer on a fresh re-measure, never on elapsed time and never by
propagating an aged-out closure as a verified one.
