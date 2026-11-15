# omahaStrategyInTournaments: authority for the live switch

Owner order of 2026-11-15 13:16 America/Chicago. Evidence NOT MET; a live read is owed after the release.

## What it does

The PLO4/PLO5 options of 2026-11-15 that were scoped to cash also run in a PLO4/PLO5 tournament hand (HorseOmahaTournamentScope.ts): high only, one board, not All-In-Or-Fold, not Lightning, and the Horse deeper than the Omaha push/fold line of 14 big blinds (where the engine already plays the pot-limit commitment zone). Each option still needs its own switch; this option only widens their scope.

- Fold and check conversions apply as in cash. The widened paired-board spot (omahaPairedBoardNoBoatSpot: a paired turn or river, less than a full house, measured value leaders) reads the same public scope, so in a tournament it acts only as a bet turned into a check.
- A conversion that adds chips (fold to call, check to bet, call to raise) adds the engine's own tournament survival premium (icmRisk, the V16 real-ICM bubble premium, V23 endgame adjusted, at most 0.15, x sqrt(stack share)) to the price it uses: the facing-bet EV margin, the river medium-bet requirement, the paired-board price exception, the out-of-position turn nut-draw call, the elite 3-bet call, the big-draw wager EV and every card-impact bet. The bet-size read (omahaBigBetIsPotShare) and the measured maniac re-raise width feed the engine's own calls, which already pay the premium; the nut-blocker bluff keeps its existing tournament gate.
- Left cash-only: the street plan's river follow, omahaStrongHandValue (no tournament price hook) and omahaVpipFloorByLimp (a cash-table feature). Not widened: the blind-steal family and omahaReraisedFoldVsTight (holds). Hi-lo and Hold'em are unchanged; PLO6 joins only through the PLO6 lane's own option (omahaStrategyInPlo6, HorseOmahaStrategyGame.ts). The owner-ruled precedence chain is unchanged.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaStrategyInTournaments docs/horse-option-authority.d/omahaStrategyInTournaments.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-15 13:16: "DON'T FORGET TO SHARE EVERY SINGLE THING WE'VE BUILT, ADDED, IMPROVED, OPTIMIZED AND DID, ALL THE RULES AND THINGS WE ADJUSTED TODAY, ALL NEED TO BE SHARED WITH PLO6 AND IMPLEMENTED FOR TOURNAMENTS AS WELL."
- 2026-11-15 12:10: "NO YOU NEED TO LAUNCH EVERYTHING EVERY SINGLE THING WE IMPROVED AND BUILT AND TALKED ABOUT... GET IT ALL LAUNCHED AS SOON AS POSSIBLE FOR PLO AND HOLDEM, EVEN IF IT TAKES A COUPLE MORE HOURS TO GET IT DONE, IT HAS TO BE ALL TOGETHER, ACTIVATED, THEN WE CAN DO REAL TIME TESTING AGAINST HUMANS AND INSIDE YOUR TEST ARENA"

## Receipts

The extended options' own receipts (HorseDataLedger.ts), unchanged; in a tournament hand they fire only with this option on.

## Tests

HorseOmahaStrategyInTournaments.test.ts (scope, one tournament spot per extended option on/off, the ICM gate, unset = false = same decisions, cash unchanged, receipt validator); HorseOmahaStrategyPrecedenceTournament.test.ts (the cash precedence laws as tournament hands); HorseOmahaStrategyGame.test.ts (the shared game gate and constants).

## Evidence rows

- Mechanism, scope, visibility, tests: MET.
- Option unset or false: decisions identical (tests above; cash decisions unchanged with it on).
- Value, continuation, reach: NOT MET. No evaluation was run (evaluation NOT RUN); a live read is owed after the release.

## Limits

The 14 big blind line is the commitment zone's unopened gate, not a measurement. The premium is the engine's per-call survival premium; rules priced in chips on several streets (the street plan, card impact) carry it only on the bet they price, not a full future-street ICM tree. The option is registered in the live switch by follow-up migration 20261115230000_horse_option_switch_plo_followup_options; it can be switched on only after that migration is installed.
