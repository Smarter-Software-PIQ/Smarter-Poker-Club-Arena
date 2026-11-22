# server/src/engine/anOmahaRuleNeverKeysOnPersonVsHorse.law.test.ts

No switchable Omaha rule keys on whether an opponent is a person or a Horse (owner rule 8). Every legacy dark Omaha option that reads `omahaOpponentKindOf`, `humanUserIds`, or opponent `.is_horse` stays locked in `OPTION_SWITCH_OFF_ONLY` (alongside the twice-failed PLO4/PLO5 options), no new engine file or `HorseLogic.ts` call site may introduce a person-vs-Horse check, and the live in-position preflop 3-bet defence path is proved invariant when the 3-bettor toggles between person and Horse.
