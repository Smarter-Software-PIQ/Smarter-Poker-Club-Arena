# Omaha strong hand on the river: value bet, value raise, induce check (option, default off)

Date: 2026-11-15. Lane: PLO Strategy. Owner instruction 2026-11-15 12:16 America/Chicago: add the earlier all-hands playbook's entries that are ready for PLO.

New option `omahaStrongHandValue` (read `=== true`, default OFF), module `server/src/engine/HorseOmahaStrongHandValue.ts`. PLO4/PLO5 cash, high only, one board, the river, a full house or better or a nut-class hand:

- a check with nothing to call is priced against every value bet against each opponent left; the value bet of highest expected value is made when it is worth at least the check;
- with a player still to act the check is kept only when it is worth more than every value bet (the induce);
- a call facing one bettor with nobody else in the hand is priced against every value raise on the exact count of the holdings that continue; the raise is made when it is worth more than the call by 4 percent of the pot.

Receipts `omaha_strong_hand_value_bet`, `_value_raise`, `_induce_check`. League cards `plo4_omaha_strong_hand_value`, `plo5_omaha_strong_hand_value`. Evidence: `docs/horse-default-on.d/omahaStrongHandValue.md`.

Unset, the brain decides exactly as before. No evaluation has been run; the option stays off.
