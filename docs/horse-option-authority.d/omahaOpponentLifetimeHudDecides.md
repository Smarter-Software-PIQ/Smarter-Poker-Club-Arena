# omahaOpponentLifetimeHudDecides: Authority For The Live Switch

Evidence NOT MET for a live switch-on: the consumer passed its sparring-bench record 2 (criteria CRITERIA-OPPONENT-HUD-8-RECORD-2.md sha256 31b1bc775a4cf3a5d6787b5d8cf4d970bcc3cb8ada28a6c39ee38bd441e41e31, seed 20261124) as omahaOpponentLifetimeHud on the graded tree lifetime-hud3 (wt4 0f011165c72); this rebuild on the list train inherits that verdict only if decision-identical on the record-2 replay (lead rulings 12:58 PM Chicago Nov 21, item 4). Its live trial follows the store being on and backfilled (EMERG/OPPONENT-HUD-ACTIVATION.md, consumer section).

## What It Does

PLO4/PLO5 cash (tables and Lightning), flop, turn and river only; never preflop, tournaments or PLO6. With this option AND `omahaOpponentLifetimeHud` on (that one arms the store and attaches each opponent's lifetime public profile to the decision), `HorseMind.opponentRead` takes the opponent's counters from his lifetime profile, shrunk n/(n+k) toward the population of his stake band and game, in place of the 30-hand decayed window and the shared presumed-aggressor read; the fold model's lifetime input carries its measured calibration (`HUD_EV_FOLD_CALIBRATION`), and the lifetime read alone never lowers an aggressive action. One mechanism for every opponent, person or Horse; public information only, never an unshown card.

Default OFF in source (read `=== true`). Off, or on without `omahaOpponentLifetimeHud`: the decision read options are exactly what they were (no key added), pinned by TheLifetimeHudConsumerIsTheOnlyDecisionReader.law. Registered in the option switch, switchable live, takes shadow (re-decided on PLO4/PLO5 flop, turn and river with `omahaOpponentLifetimeHud` as companion; a shadow re-decision reads the lifetime record only while the store option is on).

## Receipts

`opponent_hud_exploit_counters`, `opponent_hud_presumption_replaced_lifetime`, `opponent_hud_presumption_replaced_prior` and the other `opponent_hud_*` decision receipts; with the option off none of them fires (the store's own `opponent_hud_provider_armed_seen` is the provider's).

## Rollback

Set this option off (one switch row, lead only). The store keeps running on `omahaOpponentLifetimeHud`; nothing else changes.

- Replay: NOT RUN (graded on the sparring bench, record 2 PASS 2026-11-21T19:29:10Z; no audited-decision replay of this option is recorded)
