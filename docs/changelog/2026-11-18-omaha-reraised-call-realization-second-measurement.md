# 2026-11-18: the priced re-raise call drops the charges a second measurement did not find

Behaviour change inside the ON option `omahaOopReraisedPotStrongRange` (the priced test of a class fold; no new option).
PLO4/PLO5 cash tables. Tournaments, Lightning and PLO6 keep the numbers they had. The pricing still only overturns a class
fold; it never folds a call the class cell keeps.

Source: REALIZATION.md (lane w13-realization, 12,473 recorded calls of a 3-bet or 4-bet, 9,916 by Horses; reproduces the
first lane's cells within 0.012).

- Per other player in for the price: 0.35 -> 0 (`RERAISE_CALL_OTHER_IN_COST`; measured -0.03, SE 0.06). The measurement's
  equity is against everyone in for the price, and the engine's was heads-up against the re-raiser, so with players
  already in for the price the equity is now taken against the re-raiser and each of them (`omahaReraisedEquityAgainst`;
  a caller's range is the band the mind reads from his line this hand). Where a player in for the price has no readable
  band the equity stays heads-up and the 0.35 stays as its dilution (`RERAISE_CALL_HEADS_UP_DILUTION`).
- A raiser still to act and a caller still to act: no charge (measured -0.09, SE 0.09 and +0.08, SE 0.08). Until now a
  raiser of the hand still to act was charged 0.35 that no fit had measured for him (review of the hotfix, note B1).
- Position in the price: after the re-raiser, nothing else (unchanged from the position commit).
- Depth costs 0.15 in position and 0.70 out of position, halves 2 and 5: unchanged (0.14, SE 0.09; 0.49, SE 0.15 on all data
  and 0.73, SE 0.30 for a Horse caller against a human re-raiser: not confirmed, not refuted).
- Rake: unchanged. The fit that produced the constants divides by equity x (pot after the call - rake) (`fit1.py`), so the
  price's (1 - rake) factor is the fit's own, not a second count.

Effect on the 627 journaled decisions (hotfix head against this change): see
`repairs/F-02-06-07/POSITION-REBASED.md` in the audit evidence. More class folds are overturned; no call becomes a fold.

Receipts: `omaha_reraised_call_priced_multiway_equity`, `omaha_reraised_call_priced_heads_up_diluted`.

Rollback: revert this commit (the position commit beneath it stands alone), or switch the rule off
(`fn_ca_horse_option_switch_set('omahaOopReraisedPotStrongRange', 'off', ...)`, with the two re-raise range options).
