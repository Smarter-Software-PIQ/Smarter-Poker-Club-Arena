# 2026-11-18: the re-raised-pot calling rule derives position once, from seat order (finding F-02)

Scope correction of the ON option `omahaOopReraisedPotStrongRange` (no new option; with the option off the rule returns
before any of this). PLO4/PLO5 cash tables. PLO6, tournaments and Lightning keep the earlier reading. Rebased onto the
corrected re-raise hotfix (the pricing prices only class folds and never folds a class keep: unchanged here).

Before: the rule called the Horse out of position when it acted before the last raiser OR when any live player with more
than a big blind in acted after it, including a caller who had not yet answered the re-raise and may fold. Of 236 recorded
fires of `omaha_oop_reraised_call_folded`, 41 were in position against the re-raiser with only such a caller behind, under
a receipt named "oop". The priced call took position away when a player already in for the price acted behind the Horse,
which the fit of its constants did not do.

Now: one derivation, `omahaReraisedPositionOf` (HorseOmahaOopReraisedPot.ts), from seat order alone, with two readings
for two questions:

- SCOPE (is this call examined): `inPosition` = last to act among the players who will see the flop: the re-raiser,
  every player already in for the price, every earlier raiser still to act (all-in players hold no position). A caller
  of an earlier price who has not answered is reported and not counted.
- PRICE (the realization of a priced class fold): `ipVsRaiser` = the Horse acts after the re-raiser, nothing else. This is
  the definition the realization constants were fitted with (PLO Strategy lane 01BNteGZ, step1.py / fit1.py).

The two cases the review of the hotfix named, after this change:

- A caller already in for the price who acts behind the Horse: no longer costs position in the price (the fit did not
  take it); still charged 0.35 as another player in (the fit measured that). In the scope he still makes the call
  examined.
- An opener (earlier raiser) still to act: UNCHANGED in the price, still charged 0.35 as another player in, which the fit
  did not measure for him (its "still to act" terms are -0.09 and 0.01). Removing the charge was built and run on the 627
  journaled decisions and failed its declared bar (30 class folds became calls; 7 of them folds the audit judged correct,
  18 close, 5 questionable), so the conservative charge stays. In the scope he makes the call examined.

Receipts: `omaha_reraised_call_priced_in_position`, `omaha_reraised_call_priced_out_of_position` (fired with a priced
verdict, the price's reading), `omaha_reraised_call_in_position_caller_pending_seen`.

Rollback: there is no switch for this correction; `fn_ca_horse_option_switch_set('omahaOopReraisedPotStrongRange', 'off', ...)`
turns the whole rule off (see the hotfix changelog for the two re-raise range options that share the cell).
