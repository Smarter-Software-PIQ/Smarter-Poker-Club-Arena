CREATE OR REPLACE FUNCTION public.fn_union_club_invoice(p_union_id uuid, p_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(club_id uuid, club_name text, period_start timestamp with time zone, period_end timestamp with time zone, rake_generated numeric, union_fee_kept numeric, rakeback_due numeric, players_won numeric, player_pnl_net numeric, eco_amount numeric, eco_enabled boolean, presettled numeric, settled_in_chips numeric, outstanding numeric, net_position numeric, direction text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_start timestamptz := COALESCE(p_start, fn_union_week_start());
  v_end   timestamptz := COALESCE(p_end, now());
BEGIN
  v_start:=public.fn_ca_launch_accounting_start('union',p_union_id,v_start);
  IF v_start>=v_end THEN RETURN; END IF;
  RETURN QUERY
  WITH eco AS (
    SELECT e.club_id, e.club_name, e.players_won, e.rake_generated,
           e.rake_earned, e.eco_base, e.eco_amount, e.eco_enabled
      FROM fn_union_eco_adjustment(p_union_id, v_start, v_end) e
  ),
  recorded AS (
    /* THE DOCUMENT QUOTES THE RECORD (2026-09-21). fn_union_eco_adjustment is
       a VOLATILE recomputation of the whole week; fn_union_eco_record wrote
       its answer to union_eco_ledger earlier in this same settlement, and a
       second recomputation is a second answer. On 2026-09-14 that cost club
       a41434bb 1.21 of overstated debt on an invoice whose other three
       figures matched the ledger exactly. Read what was recorded. */
    SELECT l.club_id, l.eco_amount
      FROM union_eco_ledger l
     WHERE l.union_id = p_union_id
       AND l.period_start = v_start
       AND l.period_end   = v_end
  ),
  pre AS (
    -- Unapplied cash held against the running balance. Closed out by
    -- applied_settlement_id, never by age: a payment made during a week that
    -- did not settle must still reach the club's next statement.
    SELECT p.club_id, COALESCE(SUM(p.amount), 0) AS amt
      FROM union_presettlements p
     WHERE p.union_id = p_union_id
       AND p.received_at < v_end
       AND p.applied_settlement_id IS NULL
     GROUP BY p.club_id
  ),
  calc AS (
    /* Phase 6 (20260907): rakeback_due IS round 1's payout for the club - the
       same fn_union_club_rake_basis rows, per game type, truncated to the
       cent - not a flat rate applied to a different rake total. */
    SELECT eco.club_id, eco.club_name,
           eco.rake_generated,
           round(eco.rake_generated - eco.rake_earned, 2) AS union_fee_kept,
           eco.rake_earned                                AS rakeback_due,
           eco.players_won,
           round(eco.players_won + eco.rake_generated, 2) AS player_pnl_net,
           /* The recorded ECO when the settlement has recorded one; the live
              figure only for the read-only preview of a week that has not
              been settled yet, which has no record to quote. */
           CASE WHEN eco.eco_enabled
                  THEN COALESCE(rec.eco_amount, eco.eco_amount)
                ELSE 0 END AS eco_amount,
           eco.eco_enabled,
           COALESCE(pre.amt, 0) AS presettled
      FROM eco
      LEFT JOIN recorded rec ON rec.club_id = eco.club_id
      LEFT JOIN pre          ON pre.club_id = eco.club_id
  )
  SELECT calc.club_id, calc.club_name, v_start, v_end,
         calc.rake_generated, calc.union_fee_kept, calc.rakeback_due,
         calc.players_won, calc.player_pnl_net,
         calc.eco_amount, calc.eco_enabled, calc.presettled,
         round(calc.player_pnl_net + calc.rakeback_due, 2) AS settled_in_chips,
         round(calc.eco_amount + calc.presettled, 2)       AS outstanding,
         round(calc.player_pnl_net + calc.rakeback_due
               + calc.eco_amount + calc.presettled, 2)     AS net_position,
         CASE WHEN round(calc.eco_amount + calc.presettled, 2) > 0
                THEN 'union owes club'
              WHEN round(calc.eco_amount + calc.presettled, 2) < 0
                THEN 'club owes union'
              ELSE 'square' END::text
    FROM calc
   ORDER BY calc.club_name;
END;
$function$
;
