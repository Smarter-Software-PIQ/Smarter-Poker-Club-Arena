# Every live horse layer carries a receipt

Dan requires proof that every built horse layer is activated and used on live
hands. The two-week horse inventory (section 3, verdict "LIVE AND USED by code
path, no receipt of its own") found layers that run on the decision path but
write nothing to horse_brain_telemetry, so nobody could count them.

Eleven versus twelve. The inventory's verdict table counts twelve such layers:
river nuts, Omaha implied credit, draw blockers, PLO8 outlook with closed-table
release, exploit hydrator, wager-bound reads, Lightning fast fold, river caller
read, river counters, heads-up matched commitment, Lightning hand binding and
worker memory bounds. Its next-steps list names eleven because it leaves out
Lightning hand binding (#8065), whose evidence was "by construction". The same
summary row also names range reads (#8563) and the private journal receipts
(#8607 family), which it files with the journal measurement work, and V60 cash
pressure (#8694) carries "no receipt of its own" under a different verdict. The
private journal family is itself a receipt layer, so it needs nothing. Every
other layer, fourteen in all, now carries its own receipt.

Each of those layers now fires one receipt feature exactly where it changes or
informs a decision, through the same BrainTelemetry.noteFire counter and daily
flush every other receipt uses. Where a layer can be reached without changing
the action, it has a separate "considered" receipt so the two cases can be told
apart, and where a later owner can replace the layer's result there is a
precedence receipt. No decision logic, threshold or ordering changed; the receipts are
observation only.

| Layer                                                       | Receipts                                                                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| River nuts always raise and bet full (#7780, #7788)         | river_nuts_wager, river_nuts_wager_already_full, river_nuts_wager_superseded, near_pot_wager_full_pot                    |
| Omaha implied credit needs a draw (#7876)                   | omaha_implied_credit_draw, omaha_implied_credit_withheld                                                                 |
| Omaha draw blockers (#8220)                                 | omaha_board_blocked_nut_draw                                                                                             |
| PLO8 low-draw and counterfeit outlook (#9351)               | plo8_low_outlook_read, plo8_low_outlook_considered                                                                       |
| Closed-table hand memory release (#9351)                    | closed_table_hand_memory_released                                                                                        |
| Exploit hydrator boot replay (#7734)                        | exploit_hydrator_boot_replayed, exploit_hydrator_boot_replayed_empty, exploit_hydrator_boot_replay_read_stopped          |
| Reads bound to the current wager (#8847)                    | wager_bound_opponent_read, wager_bound_opponent_read_past_short_all_in, wager_bound_pressure_read                        |
| Lightning fast fold with human reaction time (#7958, #7993) | lightning_horse_fast_fold, lightning_horse_fast_fold_considered                                                          |
| River caller showdown read (#8160, #8214)                   | river_call_showdown_learned, river_call_light_read_considered (river_call_light_read already existed and is now counted) |
| Conditional river opportunity counters (#8386)              | river_last_to_act_counted                                                                                                |
| Range reads (#8563)                                         | range_read_big_bet_counted, range_read_capped_all_in_not_big_bet                                                         |
| Heads-up cash matched commitment (#8464)                    | hu_cash_matched_commitment, hu_cash_matched_commitment_covered, hu_cash_matched_commitment_wager                         |
| Lightning original hand binding (#8065)                     | lightning_original_hand_bound, lightning_original_hand_unbound                                                           |
| Worker memory and history retention bounds (#9387 family)   | horse_history_cache_entry_bound_evicted, horse_history_retention_refused                                                 |
| V60 cash pressure (#8694)                                   | v60_cash_pressure_facing_open, v60_cash_pressure_facing_open_superseded, v60_cash_pressure_opener_vs_three_bet           |

Every name is registered in HorseDataLedger, so the daily audit judges its
silence, and listed in scripts/horse-measure/sql/activation.sql, so the release
kit and the Phase 5 daily scorecard count it. The two Lightning Phase 15
acceptance receipts that already fired are registered as well.

A law test, everyLiveDecisionLayerCarriesAReceipt.law.test.ts, pins each layer
to its receipt names and fails if a receipt is unregistered, no longer fired in
the module where the layer acts, or missing from the activation list.
HorseLayerReceipts.test.ts drives HorseLogic.decide on a pinned decision clock
and checks that each receipt fires when the layer is reached and acted, and
never when it is not; the Lightning, hydrator, history cache and closed-table
receipts are checked in their own existing suites.
