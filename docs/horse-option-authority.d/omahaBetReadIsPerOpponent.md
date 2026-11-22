# omahaBetReadIsPerOpponent: Authority For The Live Switch

Built 2026-11-20 by EMERG lane CR2 for the PLO-OWNER lead (LIVEGRADE CR-2; OPEN-ITEMS L13 and G7; scope narrowed by the lead at 12:22 AM Chicago). This file does not authorize switching the option on. Switches are made only by the lead, through the delivery path. It records what the option is and what was measured.

## What It Does

PLO4/PLO5 cash (table and Lightning), heads-up, one board, no bomb pot, facing a bettor's first bet of the street. It acts on the river at every size, and on the turn only when the bet is his second barrel. It never acts on the flop or on a first turn bet. Where `omahaFacingBetEv` and `omahaFacingBetIsPricedByEquity` price the bettor's non-value share, the population prior is replaced by his own measured composition (`server/src/engine/HorseOmahaBetRead.ts`). That composition comes from first bets of the same street, size bucket (at most 0.505, at most 0.805, above) and barrel that he showed down. A shown hand counts as value when it beat at least 80% of holdings on the board of that street. His record is read against every OTHER person's shown hands (leave one out) and against their bet frequency. Below 4 shown bets the price is the population prior exactly. One rule covers every opponent, person or Horse. PLO6 is never learned and never read. Default OFF in source (read `=== true`).

Public information only: cards enter only from showdown reveals, through `hand_history.hole_cards` at boot and the completed-hand observation's `betReadShown` live. Memory only, rebuilt at every boot from the last 72 h of hand rows (no table, no migration).

Receipts: `omaha_bet_read_person_priced` and `omaha_bet_read_population_priced`, plus the per-decision rule receipt `omaha_bet_read.<source>.<street>.<bucket>.shown<n>.bets<n>`, which records the share used. The boot failure receipt is `omaha_bet_read_boot_failed_seen`. The validator admits a priced-by-equity call wherever the read could have made it (the largest share, 0.65), for the exact chips.

## What Was Measured

See archive repairs/EMERG/CR2.md (offline sim and exact journal replay, criteria sha256 dc206f9db5ba49f302ecf712af93cb6e4858e41a0d6bde9092bfbcecc5e29201).

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (no server/scripts/audited-decision-replay.ts --row run is recorded; the graded exact journal replay is in archive repairs/EMERG/CR2.md and work emerg/cr2/work/re)
