-- Horse release verification: ACTIVATION. Which horse-upgrade receipts fired
-- (public.horse_brain_telemetry, daily fires) on or after :START_DAY. The
-- 'decide_nlh' row is the liveness CONTROL: if it is zero, telemetry is not
-- flowing and every other zero is meaningless. With the control non-zero, a
-- zero row means the receipt never fired: either the spot did not occur or
-- the upgrade is not active. A row whose label says 'expected 0' is a guard
-- counter: it should stay at zero. Read-only (one SELECT).
--
-- V31 rows (2026-11-06): 'v31_certified_<node role>' fires once per horse
-- decision that a certified V31 solver cell answered and the engine executed
-- as sampled (HorseLogic.ts, noteFire after legalize). The facing roles
-- (facing_bet, facing_raise, check_raise, bet_raise, all_in) are the response
-- nodes the legacy V29/V30 aggregate never covered. The store is empty until
-- public.gto_v31_serving_bindings holds an open row for the serving engine
-- commit, so 'v31_certified_skip_empty_store' is the counter that must fall
-- to zero when V31 is live.
SELECT x.feature, x.upgrade, coalesce(sum(t.fires), 0) AS fires,
       count(DISTINCT t.day) AS days_seen, min(t.day) AS first_day, max(t.day) AS last_day
FROM (VALUES
  ('decide_nlh', 'CONTROL: telemetry alive'),
  ('v61_river_one_pair_shade', 'V61'),
  ('v63_large_river_bet_shade', 'V63'),
  ('v64_river_raise_needs_two_pair', 'V64'),
  ('v65_turn_one_pair_shade', 'V65'),
  ('v66_bet_raised_one_pair', 'V66'),
  ('v67_river_bet_raised_one_pair', 'V67'),
  ('v68_turn_air_draw_calls', 'V68'),
  ('v69_turn_call_gaps', 'V69'),
  ('v70_gto_open', 'V70'),
  ('v71_ante_push', 'V71'),
  ('v72_defend_vs_opener', 'V72'),
  ('v73_vs3bet_defence', 'V73'),
  ('v74_nlh_open_size', 'V74'),
  ('v75_squeeze_defence', 'V75'),
  ('v76_retired_four_bet_bluff', 'V76'),
  ('v77_seat_jam', 'V77'),
  ('v78_no_committing_bluff_raise', 'V78'),
  ('v79_top_pair_weak_kicker', 'V79'),
  ('v80_top_pair_strong_kicker', 'V80'),
  ('v81_omaha_big_bet_call_fold', 'V81'),
  ('holdem_no_four_bet_bluff', 'rule 4a'),
  ('holdem_premium_flat_deep_three_bet', 'rule 4a'),
  ('holdem_four_bettor_continues', 'rule 4b'),
  ('hybrid_v1_cash_grinder_decided', 'Hybrid v1 cash grinder'),
  ('hybrid_v1_tournament_tricky_decided', 'Hybrid v1 tournament tricky'),
  ('cash_nlh_three_bet_size', 'cash NLH 3-bet size'),
  ('v62_river_bettor_polarity', 'V62 (opt-in: expected 0)'),
  ('horse_turn_resolved_without_decision', 'clock-forced horse turn (expected 0)'),
  ('horse_turn_resolved_without_decision_brain_pending', 'clock-forced horse turn, brain decision was in flight (expected 0)'),
  ('horse_turn_resolved_without_decision_timebank_expired', 'clock-forced horse turn, bank countdown (expected 0)'),
  ('horse_turn_resolved_without_decision_timer_expired', 'clock-forced horse turn, action clock (expected 0)'),
  ('stale_turn_clock_expiry_ignored', 'clock outlived its turn, ignored (guard)'),
  ('time_bank_activation_retired_turn_ended', 'deferred bank activation retired, turn ended (guard)'),
  ('v31_certified_facing_bet', 'V31 solver cell applied: facing bet'),
  ('v31_certified_facing_raise', 'V31 solver cell applied: facing raise'),
  ('v31_certified_check_raise', 'V31 solver cell applied: check raise'),
  ('v31_certified_bet_raise', 'V31 solver cell applied: bet raise'),
  ('v31_certified_all_in', 'V31 solver cell applied: all in'),
  ('v31_certified_open', 'V31 solver cell applied: open'),
  ('v31_certified_cbet', 'V31 solver cell applied: cbet'),
  ('v31_certified_delayed_cbet', 'V31 solver cell applied: delayed cbet'),
  ('v31_certified_probe', 'V31 solver cell applied: probe'),
  ('v31_certified_barrel', 'V31 solver cell applied: barrel'),
  ('v31_certified_execution_mismatch', 'V31 solver cell sampled but legalized away (expected 0)'),
  ('v31_certified_skip_empty_store', 'V31 solver store empty, no serving binding (expected 0 once bound)'),
  ('plan_fingerprint_recorded', 'Items 21 and 23 plan fingerprint (recorded)'),
  ('plan_fingerprint_continued_on_blank', 'Items 21 and 23 plan fingerprint (met, blank)'),
  ('plan_fingerprint_improved_on_good_card', 'Items 21 and 23 plan fingerprint (met, good)'),
  ('plan_fingerprint_checked_scare_card', 'Items 21 and 23 plan fingerprint (met, scare)'),
  ('plan_fingerprint_aborted_multiway_contender_shift', 'Items 21 and 23 plan fingerprint (withdrawn: contender)'),
  ('plan_fingerprint_aborted_stack_exposure_shift', 'Items 21 and 23 plan fingerprint (withdrawn: exposure)'),
  ('plan_fingerprint_absent', 'Items 21 and 23 plan fingerprint (plan carried none)'),
  ('opponent_memory_donor_fresh', 'Item 12 donor staleness (fresh)'),
  ('opponent_memory_donor_stale', 'Item 12 donor staleness (stale)'),
  ('opponent_memory_donor_expired', 'Item 12 donor staleness (expired)')
) AS x(feature, upgrade)
LEFT JOIN public.horse_brain_telemetry t ON t.feature = x.feature AND t.day >= :START_DAY::date
GROUP BY x.feature, x.upgrade
ORDER BY x.upgrade, x.feature;
