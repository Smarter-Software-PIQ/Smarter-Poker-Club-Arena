# omahaBetReadIsModeSplit: Authority For The Live Switch

Built 2026-11-20 by EMERG lane MODE-READ for the PLO-OWNER lead (owner order 1:55 AM Chicago: build with all available data; LIGHTNING-AUDIT section 2.5). This file does not authorize switching the option on. Switches are made only by the lead, through the delivery path. It records what the option is and what was measured.

## What It Does

Acts only with `omahaBetReadIsPerOpponent` on. PLO4/PLO5 cash, heads-up, one board, no bomb pot, on the turn and the river facing a wager. The bettor is read in the decision's mode (table or Lightning; `server/src/engine/HorseOmahaBetRead.ts`, `omahaBetReadModeOf`): his cell of that mode, shrunk toward his own pooled cell (20 pseudo-chances, 4 pseudo-shown bets), against the other persons of the same mode (leave one out). Cells: the first bet of the street by his previous-street line (the turn stab after a checked-through flop; the later barrel; every other first bet, first turn bets included) and size bucket, and his raise. The share is the mean of the shown signal (CR2's, selection-corrected against the same-mode persons) and a calibrated frequency signal q0 + slope x (his rate / theirs - 1), the slope `OMAHA_BET_READ_FREQ_SLOPE` fitted on every player's cards with no player above 20% of a cell's weight (provenance population_all_cards_capped, never keyed by player). Where the read acts on the turn, the call is priced with the measured realization of the Horses' heads-up turn calls (in position .84, out of position .60). One rule for every opponent. Public information only. PLO6 never. Default OFF in source (read `=== true`).

Receipt: `omaha_bet_read_mode_split_priced`.

## What Was Measured

See archive repairs/EMERG/MODE-READ.md (offline 5-week simulation, read built only from hands before each decision; fit Oct 15 to Nov 14, holdout Nov 15 to 19; real chips to persons). Grade: INSUFFICIENT; the Lightning turn cell it was built for grades negative on the holdout.

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (no server/scripts/audited-decision-replay.ts --row run is recorded; the offline simulation is in archive repairs/EMERG/MODE-READ.md and work emerg/mode-read/work)
