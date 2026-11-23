# server/src/engine/HorseOmahaTurn4bHudProviders.law.test.ts

- **Scope:** Production `HorseDecisionWorkerRuntime` wiring for Turn 4B Omaha lifetime-HUD providers (`omahaStabDefenceIsPriced`, `omahaRiverBetFoldIsHisRecord`, `omahaCbetRaiseIsPriced`).
- **Invariant:** Every worker decision installs both `HorseMind.setOmahaLifetimeStreetRecordProvider` and `setOmahaCbetRaiseRecordProvider` over the installed `OpponentHudPacket`, returning live counts when the packet matches the game family and failing closed to `null` / exact population prior when no packet or a different family is installed.
