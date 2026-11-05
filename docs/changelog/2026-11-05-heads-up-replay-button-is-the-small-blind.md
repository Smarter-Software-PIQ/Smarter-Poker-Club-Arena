# Heads-up replay: the button is the small blind

The offline league/replay simulator (`server/src/benchmark/HorseLeague.ts`)
dealt two-seat hands with the blinds reversed: the non-dealer posted the small
blind and acted first preflop. The engine and every V31 cell label the heads-up
dealer `SB` (`gtoV31Position`, `engine/headsUpButton.ts`), so the replay never
reached a heads-up SB spot. V31 dataset 187815b1's paired_replay/cash card ran
10,000 hands with 0 candidate hits and refused, writing no receipt.

- Two seats: the button posts the small blind and opens preflop; the other seat
  posts the big blind and acts first postflop. Three or more seats unchanged.
- `gtoV31Evaluate.ts` closes ChannelHub when it finishes or fails. Its
  import-time 30 s interval kept the evaluation worker alive, so the failed run
  idled ~6 hours to the job timeout instead of exiting.
- `HorseLeagueHeadsUpBlinds.test.ts` pins the heads-up blind order against the
  engine's own position labels; it fails on the previous simulator.

Every two-seat league and replay result moves with this fix; earlier heads-up
league numbers were measured with reversed blinds.
