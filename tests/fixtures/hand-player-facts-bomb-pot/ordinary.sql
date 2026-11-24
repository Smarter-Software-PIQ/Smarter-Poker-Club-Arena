-- The ordinary fixture hands (no bomb_ante row, no bomb_pot marker), every
-- output column of both readers, in a fixed order. Run before and after the
-- patch; the two outputs must be byte-identical.
\pset format unaligned
\pset tuples_only on
SELECT 'one', to_jsonb(f)::text FROM public.hand_history h
  CROSS JOIN LATERAL public.ca_hand_player_facts_one(h.id, NULL) f
 WHERE h.bomb_pot IS NULL AND NOT h.actions @> '[{"action":"bomb_ante"}]'
 ORDER BY f.hand_id, f.user_id;
SELECT 'range', to_jsonb(f)::text FROM public.ca_hand_player_facts_range('2026-11-24 10:00:00+00', '2026-11-24 10:01:00+00', NULL) f
  JOIN public.hand_history h ON h.id = f.hand_id
 WHERE h.bomb_pot IS NULL AND NOT h.actions @> '[{"action":"bomb_ante"}]'
 ORDER BY f.hand_id, f.user_id;
