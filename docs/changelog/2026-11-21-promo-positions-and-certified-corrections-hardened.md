# 2026-11-21: a moved seat never leaves a locked promo position; a certified cash correction needs no per-cause list

Hardening after incidents bb04ee5f, e542fbd7 and 887c0008 (table dbbc148e,
six-hour engine kill storm). The root fix (20261121143259, PR #11619) made
`fn_cash_seat_move_execute` carry every promo position with the seat.

## 20261121182315: the database holds the rule

A deferred constraint trigger on `public.table_seats`
(`zz_moved_seat_leaves_no_locked_promo_position`), queued only when a LIVE
occupancy ends, refuses at COMMIT a transaction that seats a player at another
table while a LOCKED promo position (open-grant principal, locked-gate winnings,
unreleased integrity) stays keyed to the table they left. A future seat mover
that forgets `fn_ca_promo_follow_seat_move` can no longer commit the bad state.
A plain exit with no other seat is never refused (cash-out and settlement own
those, and CLAUDE.md 11.5 forbids guards that can strand a player mid-hand).
Measured first: 0 locked positions held by an unseated player; the 19 unlocked
winnings rows (14.52, user 74dbee95 on 8fee68cc) are by design and not counted.

## 20261121185031: no per-cause list in the claim guard

Recovering hand #60380607 needed a second emergency migration (20261121143102)
only to add its cause to a hard-coded list in
`smarter_private.hand_source_correction_claim_guard`. Certification is
postgres-only and the guard already requires the re-derived proof to equal the
certified one, so the cash branch now admits any migration-certified cash proof
(plain-identifier cause, 14-digit proof_version). `backup_residue_constraint`
keeps its own live condition; every other check is unchanged.

Laws: `tests/a-moved-seat-never-leaves-a-locked-promo-position.law.test.ts`,
`tests/a-certified-cash-correction-needs-no-per-cause-list.law.test.ts`.
