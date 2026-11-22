# server/src/engine/omahaMathCore/OmahaMathCoreTurnRiverHud.law.test.ts

Opponent-lifetime-backed PLO5 turn/river facing-bet pricing (`OmahaMathCoreTurnRiver.ts` + `OmahaMathCoreTurnRiverHud.ts`, default OFF behind `omahaMathCorePlo5Turn` / `omahaMathCorePlo5River`) enforces cumulative `fw1` tail mass without size-mix dilution, barrel sharpening, station/nit zero-flip guard (`f_lo <= p_base`), capped turn continuation (`lifetimeRiverShare`), river stack-commit `K_allin = 25`, current-nuts call floor, determinism, public-only HUD counters, and off-scope zero work.
