# Horse Late Prizes Return To The Old Club Bank By Themselves

Date: 2026-11-03

## Owner Order

Dan, 2026-11-03 05:27 CT: late prizes return to the bank by themselves, so the manual step is gone for good.

## The Gap

The horse club split closed every horse membership in a club the horse no longer belongs to, with records retained. Entries those memberships paid for, in events already running, still pay their prizes and bounties to that club. The payout path credits the closed record, as it does for any member who has left. The chips were the club's, but they waited on the record until `fn_ca_horse_club_split_late_claims` was run by hand.

## The Fix

Migration `20261103113029_horse_late_prizes_return_to_the_old_club_bank.sql` installs in the daily maintenance window, because a trigger on `club_members` needs a table lock that is never taken during play.

- **Trigger:** `zzzz_horse_split_late_credit_returns_to_bank` fires after a departed record's `chip_balance` goes up. It acts only on records the split departed, outside the horse's assigned club.
- **Return:** in the same transaction it moves the record's whole balance to that club's bank through the same declared Club Bank claim the split used. Each return gets a `chip_transactions` row on a fresh op id and a row in `ca_horse_club_split_late_returns`.
- **Safety:** the return runs in its own subtransaction with a 200 ms lock wait.
  - On any failure it rolls back alone. The prize stays on the record, `horse_split.late_return_deferred` is filed, and the existing late claim still returns it after its events finish.
  - The caller's ledger declaration and lock timeout are saved before and restored after, so the payout's own later writes are unchanged.

## Verification

Smoke-tested on scratch PostgreSQL 16:

- A credit of 25 returned to the bank and the record went back to 0.
- The payout's ledger context and lock timeout were intact afterwards.
- A departed member that is not a split record was untouched.
- A forced failure (bank row missing) left the 7-chip credit on the record, filed one warning, and let the payment complete.
