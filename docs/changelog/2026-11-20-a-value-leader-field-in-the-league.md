# A value-leader field in the league (2026-11-20, Horse SWITCH lane, task #6)

The Omaha \*VsValueLeader rules (omahaMadeHandDefenseVsValueLeader, omahaBluffCatcherFoldVsValueLeader,
omahaOverpairNoOopBarrelVsValueLeader, omahaPairedRiverNoThinLeadVsValueLeader,
omahaPairedTurnNoBarrelWithoutBoatVsValueLeader) act only against an opponent HorseOmahaReadConditional
measures as a postflop value leader. Horse self-play never produces one, so no league card could grade them.

- `OMAHA_VALUE_LEADER_FIELD_PERSONA` (`omaha_value_leader_field_v1`): the Omaha development field's own profile
  with value-heavy, bluff-free postflop play and passive preflop raising, so the read labels its seats on their
  measured play (nothing sets the label). Omaha development field only.
- `OMAHA_LIVE_OPTIONS_20261120`: production's live Omaha rows at 7 PM Chicago on 2026-11-20.
- `VALUE_LEADER_FIELD_CARDS`: one card per value-leader rule for plo4 and plo5, both arms on the live set against
  the persona, the rule the only difference. They seat the Omaha development field, which the nightly card may not seat, so they
  are `DEVELOPMENT_LEAGUE_CARDS` (not `LEAGUE_MATCHUPS`): never dealt nightly, dealt by name with
  `npx tsx src/scripts/horseLeagueCard.ts --card=plo4_value_leader_field_<rule>`. Measurement only.
- Law `aValueLeaderFieldIsReadAsValueLeaders.law.test.ts`: the label is earned (>= 3 of 5 seats measured value
  leaders vs 0 against the calibrated field on the same deals), `omaha_value_leader_defense_applied` fires against
  the persona and never against the calibrated field, the table is clean, and every card differs in its one rule.

Probe evidence (seed 11, 3,000 pairs each): `omaha_value_leader_defense_applied` plo4 0 -> 74, plo5 0 -> 102;
paired-river thin-lead checks plo4 0 -> 44, plo5 0 -> 36; paired-turn barrel checks plo4 0 -> 14, plo5 0 -> 24;
0 illegal actions, 0 cut-off streets, 0 fallbacks. No live decision code changed.
