-- Horse release verification: ACTIVATION. Which horse-upgrade receipts fired
-- (public.horse_brain_telemetry, daily fires) on or after :START_DAY. The
-- 'decide_nlh' row is the liveness CONTROL: if it is zero, telemetry is not
-- flowing and every other zero is meaningless. With the control non-zero, a
-- zero row means the receipt never fired: either the spot did not occur or
-- the upgrade is not active. Read-only (one SELECT).
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
  ('v62_river_bettor_polarity', 'V62 (opt-in: expected 0)')
) AS x(feature, upgrade)
LEFT JOIN public.horse_brain_telemetry t ON t.feature = x.feature AND t.day >= :START_DAY::date
GROUP BY x.feature, x.upgrade
ORDER BY x.upgrade, x.feature;
