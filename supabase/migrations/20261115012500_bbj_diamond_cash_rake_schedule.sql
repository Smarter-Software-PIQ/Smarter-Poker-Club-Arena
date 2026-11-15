-- Public price terms only. The existing settings readers select the effective
-- owner answer for each stake and dealt-in bracket, just as settlement does.
BEGIN;
CREATE FUNCTION public.fn_bbj_diamond_cash_rake_schedule()
RETURNS TABLE(big_blind numeric, players text, percent numeric, cap numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH stakes AS (
    SELECT DISTINCT scope FROM public.ca_diamond_economics
    WHERE name = 'cash_rake_cap' AND scope ~ '^bb:[0-9]+$'
  ), brackets(label, suffix, seq) AS (
    VALUES ('2', '_heads_up', 1), ('3', '_three_handed', 2), ('4+', '', 3)
  )
  SELECT split_part(scope, ':', 2)::numeric, label,
    CASE WHEN public.fn_ca_diamond_economic_on('cash_rake_enabled')
      THEN public.fn_ca_diamond_economic('cash_rake_percent' || suffix, 'all') ELSE 0 END,
    CASE WHEN public.fn_ca_diamond_economic_on('cash_rake_enabled')
      THEN public.fn_ca_diamond_economic('cash_rake_cap' || suffix, scope) ELSE 0 END
  FROM stakes CROSS JOIN brackets WHERE (SELECT auth.uid()) IS NOT NULL ORDER BY 1, seq
$$;
REVOKE ALL ON FUNCTION public.fn_bbj_diamond_cash_rake_schedule() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bbj_diamond_cash_rake_schedule() TO authenticated, service_role;

-- Only the four public bracket parameters needed to display a chip cash game.
CREATE FUNCTION public.fn_bbj_chip_rake_brackets()
RETURNS TABLE(hu_percent numeric, hu_factor numeric, short_factor numeric, short_seats integer, short_players integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT heads_up_percent, heads_up_cap_factor, short_handed_cap_factor,
         short_handed_min_seats, short_handed_max_players
  FROM public.ca_rake_rules WHERE id = 1 AND (SELECT auth.uid()) IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.fn_bbj_chip_rake_brackets() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bbj_chip_rake_brackets() TO authenticated, service_role;
COMMIT;
