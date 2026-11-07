-- Exact cancellation returns tickets while preserving the historical roster.
-- Exclude that closed entry only from the missing-ticket finding. The watch's
-- cancelled-event ticket check and existing finding/alert closure remain intact.
-- @live-proof: position('AND fb.status <> ''CANCELLED''' IN pg_get_functiondef('public.fn_ca_free_buy_funding_watch()'::regprocedure)) > 0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $correct_watch$
DECLARE source text; before_fragment text := $before$      FROM fb JOIN public.tournament_players p ON p.tournament_id = fb.id
     WHERE fb.fmt IS NOT NULL
       AND p.registered_at < v_grace$before$;
BEGIN
 SELECT pg_get_functiondef('public.fn_ca_free_buy_funding_watch()'::regprocedure) INTO source;
 IF md5(source)<>'6c183f2365317624f37d79b0677482c5' THEN
  RAISE EXCEPTION 'Inspected definition changed: fn_ca_free_buy_funding_watch';
 END IF;
 IF (length(source)-length(replace(source,before_fragment,'')))/length(before_fragment)<>1 THEN
  RAISE EXCEPTION 'Expected one missing-ticket entry branch';
 END IF;
 EXECUTE replace(source,before_fragment,replace(before_fragment,
  'WHERE fb.fmt IS NOT NULL',E'WHERE fb.fmt IS NOT NULL\n       AND fb.status <> ''CANCELLED'''));
END $correct_watch$;
COMMIT;
