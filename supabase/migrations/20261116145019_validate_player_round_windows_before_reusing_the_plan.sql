-- A previously closed window may precede fee recognition or later certificates.
-- If the cached inputs already disagree, use the original set-based proof of
-- the current earning sources. All existing amount, payer, wallet and ledger
-- checks still run. The installer does not prepare, book or pay any period.
-- @live-proof: position('stale_rakeback_window' in pg_get_functiondef('public.fn_settle_accounting_rakeback_plan_get(text,uuid,timestamptz,timestamptz,uuid[],uuid,uuid,boolean)'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $migration$
DECLARE
  target constant regprocedure := 'public.fn_settle_accounting_rakeback_plan_get(text,uuid,timestamptz,timestamptz,uuid[],uuid,uuid,boolean)'::regprocedure;
  original text := pg_get_functiondef(target);
  anchor constant text := 'FROM p WHERE EXISTS(SELECT 1 FROM q)';
BEGIN
  IF md5(original)<>'f4c135f1c425de4f5d257dd7c59eaa38' OR position(anchor in original)=0 THEN
    RAISE EXCEPTION 'round_three_cached_plan_reader_changed';
  END IF;
  EXECUTE replace(original,anchor,anchor||$guard$
   -- stale_rakeback_window: a plan containing a known failed proof is unusable.
   -- Returning NULL selects the original full-week source validation, before
   -- period discovery. It also avoids trusting stale payer or player counts.
   AND NOT EXISTS (
     SELECT FROM jsonb_array_elements(p.value->'alloc') a
     LEFT JOIN q ON q.club_id=(a->>2)::uuid AND q.player_id=(a->>3)::uuid
     WHERE coalesce((a->>8)::boolean,true)
       OR (a->>4)::bigint IS DISTINCT FROM (a->>5)::bigint
       OR (a->>4)::bigint IS DISTINCT FROM q.n
       OR q.d1 IS DISTINCT FROM (a->>9)::numeric
       OR q.d2 IS DISTINCT FROM (a->>10)::numeric
   )$guard$);
END
$migration$;
COMMIT;
