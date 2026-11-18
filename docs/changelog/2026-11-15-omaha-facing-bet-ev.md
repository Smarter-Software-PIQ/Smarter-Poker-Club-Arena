# Omaha facing a bet: one expected-value decision (option, default off)

Date: 2026-11-15. Lane: PLO Strategy. Owner instruction 2026-11-15 11:39 America/Chicago: the decision to fold or call facing a bet must depend on the hand, the player and the pot size to value.

New option `omahaFacingBetEv` (read `=== true`, default OFF), module `server/src/engine/HorseOmahaFacingBetEv.ts`. In PLO4/PLO5 cash, high only, one board, on the turn and the river, when the Horse faces a bet or a raise and today's brain answers fold or call, that answer is replaced by one expected-value verdict:

- the exact number of opponent holdings that beat, tie and lose to the Horse's actual hand, with its own cards removed (on the turn, for every river card); nothing is sampled;
- the bettor's range from public information: a value region sized by the bet's share of the pot and his line this hand, and a bluff share that starts at the measured population figure and moves with his measured bet-when-checked-to rate and, when the memory carries them, his shown-down results at that bet size;
- the price: the call is made when EV(call) on the actual pot and call exceeds 2 percent of the final pot; every other player in the hand (a caller, an earlier all-in, a player still to act) must be beaten as well.

In that spot it replaces the paired-board fold, the big-bet and bluff-catcher cells, the committed-call bar and the river and turn call verdicts. It never raises and never changes a raise. Receipts `omaha_facing_bet_ev_call`, `_fold`, `_changed`. League cards `plo4_omaha_facing_bet_ev`, `plo5_omaha_facing_bet_ev`. Evidence: `docs/horse-default-on.d/omahaFacingBetEv.md`.

Unset, the brain decides exactly as before. No evaluation has been run; the option stays off.
