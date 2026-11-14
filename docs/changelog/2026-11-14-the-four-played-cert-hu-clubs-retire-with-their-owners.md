# The four played Cert HU clubs retire with their owners (2026-11-14)

Dan, 2026-11-14: "REMOVE ANY AND ALL POSTDEPLOY TEST ACCOUNTS ACROSS THE POKER ARENA."

After today's test-account retirements, four reserved post-deploy identities were left. Each owns a heads-up rematch certification club that `certify-heads-up-rematch.mjs` created on Nov 9; that run died before its cleanup:

| Club                        | Owner           | Treasury  | Whole estate retired |
| --------------------------- | --------------- | --------- | -------------------- |
| Cert HU 05448714 (5db856cf) | PostDeploy58e6e | 99,700.00 | 100,000.00           |
| Cert HU 08278575 (e5d50964) | PostDeploy97c6a | 99,700.00 | 100,000.00           |
| Cert HU 10629595 (f5eebc0e) | PostDeploya5afb | 99,699.90 | 99,999.90            |
| Cert HU 12100714 (17b36e27) | PostDeployf9c82 | 99,699.80 | 99,999.80            |

Each estate is the treasury plus the untouched welcome-package pools: 100.00 of BBJ principal and the 200.00 Spin seed. Total retired: 399,999.70.

## Why nothing could retire them

`fn_retire_settled_club` first unwinds the welcome package, and the unwind refuses any club in which a Sit & Go was played. These clubs played their heads-up Sit & Gos. The Cert Residue Sweep has refused all four on every run since Nov 9. The certification script stopped creating such clubs (`CERTIFICATION_CLUB_CAN_RETIRE = false`), so this is a one-time settlement of exactly these four ids, not a new door.

## The settlement

`20261114194730`, one transaction, per club:

1. **Re-prove the state.** Every fact measured on Nov 14 is checked again from rows:
   - only reserved members, with zero balances;
   - no agents, custody, seats or obligations;
   - every unstarted game has 0 players and no money;
   - both pools are pristine;
   - the treasury is exact.
2. **Stop and cancel every game, as the owner.** Every recurrence source is stopped and every game cancelled or closed, the way the welcome unwind does it: unstarted tournaments go through `atomic_cancel_tournament`, and each receipt is asserted.
3. **Return the welcome pools to the club bank.** The 200.00 Spin seed comes back through `fn_spin_deactivate`, and the 100.00 BBJ principal through `fn_spin_move_owner_wallet`.
4. **Retire the chips.** The whole estate moves to `chip_retirement` under a `burn` declaration, and the burn row is read back to the cent.
5. **Confirm nothing is left.** `fn_club_retirement_impact` reads zero everywhere.
6. **Delete the owner's profile.** This runs with no actor claim; the deleted-account triggers depart the membership.
7. **Retire the club.** `fn_retire_settled_club_core_20260906` retires it with its records retained.

Nothing is deleted. Every club, hand, tournament, receipt, ledger and membership row stays, read-only.

Pinned by `tests/the-four-played-cert-hu-clubs-retire-with-their-owners.law.test.ts`.
