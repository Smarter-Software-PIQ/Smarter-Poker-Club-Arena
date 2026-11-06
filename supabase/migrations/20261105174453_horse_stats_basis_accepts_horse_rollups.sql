-- 2026-11-05: sp_prune_hand_history failed 7,728 of 8,621 runs a day with
-- HORSE_STATS_BASIS_INVALID_SHAPE, and hand_history retention has been stuck at
-- 2026-10-25 23:53 since. Migration 20261025185247 (horse daily counts share the
-- accepted hand receipt) added a fourth key, horse_rollups (an object), to the
-- accepted stats_facts; horse_compact_stats_basis still allowed only
-- version/facts/transfers. It now also accepts horse_rollups when it is an object
-- and keeps it in the compact copy.
do $mig$
declare
  src text := pg_get_functiondef('smarter_private.horse_compact_stats_basis(jsonb)'::regprocedure);
  out text;
begin
  out := replace(src,
    'OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_stats) k WHERE k NOT IN(''version'',''facts'',''transfers''))',
    'OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_stats) k WHERE k NOT IN(''version'',''facts'',''transfers'',''horse_rollups''))
 OR (p_stats ? ''horse_rollups'' AND jsonb_typeof(p_stats->''horse_rollups'') IS DISTINCT FROM ''object'')');
  if out = src then raise exception 'shape anchor not found'; end if;
  execute out;
end
$mig$;
