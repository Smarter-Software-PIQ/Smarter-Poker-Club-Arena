# The sparring bench learns the lifetime opponent HUD (2026-11-21)

Benchmark and test files only. No engine file, no migration, no production caller.

- `server/src/benchmark/SparringHud.ts` (new): one in-memory lifetime store per arm and per deal of a sparring cell. After every hand the hand's public record (blinds, actions, board, chips won, the hand name of a seat that showed down) goes through `HudHistoryRows` -> `handRecordFromRow` -> `applyHudHandToProfiles`; before every decision the acting seat's packet of its opponents (`buildHudPacket`, profiles as they stood before the hand) is installed with `installDecisionHud`. No hole card is handed to it.
- `server/src/benchmark/HorseLeague.ts`: the hand observer gains `beforeDecision` and a public `winnings` / `shown` (hand names) on `onEnd`. Without an observer nothing changes.
- `server/src/benchmark/SparringLeague.ts`, `sparringRun.ts`, `scripts/sparring.sh`: `spec.hud` / `SPARRING_HUD=1`, population priors and a pre-load as data files (`SPARRING_HUD_PRIORS`, `SPARRING_HUD_PRELOAD`), export of a block's stores (`SPARRING_HUD_EXPORT=1`). A tree that never installs or feeds the store stops the cell instead of measuring the prior. Unset, the bench is as before.
- Law test `SparringLearnsTheHud.law.test.ts`: OFF-vs-OFF = 0 flips with the provider installed (PLO4/PLO5, heads-up and six-max); a scripted folder's fold-to-raise count equals the script's own tally and the read converges to it by n/(n+k); no hole card reaches the store; a pre-load is data; benchmark-only.
