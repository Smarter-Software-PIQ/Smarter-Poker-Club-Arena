-- Captured read-only from PokerIQ-Production 2026-11-10. This fixture supplies
-- the same index predicate the production journal uses.
CREATE OR REPLACE FUNCTION public.trivia_ledger_platform_family(p_kind text, p_reference text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_kind IN ('pvp_stake', 'pvp_win', 'pvp_refund', 'pvp_tie_refund')
      OR p_reference LIKE 'pvp\_%' OR p_reference LIKE 'legacy\_pvp\_%' THEN 'pvp'
    WHEN p_kind IN ('tournament_entry', 'tournament_entry_refund', 'tournament_cancel_refund', 'tournament_prize')
      OR p_reference LIKE 'trivia\_tourn\_%' THEN 'tournament'
    WHEN p_kind IN ('trivia_entry', 'trivia_run', 'trivia_daily_bonus', 'trivia_prize_wheel', 'trivia_lifeline', 'trivia_arcade')
      OR p_reference LIKE 'trivia\_%' OR p_reference LIKE 'spend:%:trivia\_lifeline:%' THEN 'solo'
  END;
$function$
;
CREATE INDEX diamond_transactions_trivia_family_created_idx ON public.diamond_transactions(created_at)
 WHERE amount<>0 AND public.trivia_ledger_platform_family(coalesce(nullif(btrim(transaction_type),''),type),reference_id) IS NOT NULL;
