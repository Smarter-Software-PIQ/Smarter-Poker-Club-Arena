-- 20261114172156_member_figures_carry_exact_decimal_text.sql
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Dan 2026-11-13: real figures are always shown whole, digit for digit. The
-- Player Management roster, the member record and its win / loss card read
-- jsonb RPCs, and a jsonb number reaches the browser as a JSON number:
-- JSON.parse keeps about 15 significant digits, so a wallet or a lifetime
-- total past that (club_members.chip_balance is numeric(20,2), the agent
-- wallets numeric(18,2), the totals are unbounded sums) would print rounded.
--
-- Each money figure now carries an exact decimal twin, "<key>_text", read
-- from the jsonb value itself (jsonb keeps numeric digits and scale exactly).
-- No figure is recomputed and no extra query runs: the twin is the same value
-- as text. The numeric keys stay, so every older reader is unchanged.
--
--   ca_club_members_page   items: chip_balance, player_wallet, agent_wallet,
--                          promo_wallet, total_fees, downline_fees
--   ca_club_member_detail  wallets: chip_balance, player_wallet,
--                          agent_wallet, promo_wallet; stats: total_fee,
--                          mtt_fee, total_winnings, mtt_winnings,
--                          claimed_back, sent_out
--   ca_club_member_win_loss today / week / month / overall: cash, mtt, net
--
-- A redacted figure (null, or a whole null object for a viewer without
-- financial rights) gets no twin, so nothing is revealed that was hidden.
-- Each function is patched from its installed source under an md5 guard,
-- every anchor must match exactly once, and signatures, security, grants and
-- every other output key are unchanged. Function-only: no table DDL, no
-- records rewritten, no engine dependency.
--
-- @live-proof: (SELECT pg_get_functiondef('public.ca_club_member_win_loss(uuid,uuid)'::regprocedure) LIKE '%ca_jsonb_figure_text%' AND pg_get_functiondef('public.ca_club_member_detail(uuid,uuid,date,date)'::regprocedure) LIKE '%ca_jsonb_figure_text%' AND pg_get_functiondef('public.ca_club_members_page(uuid,text,text,text,jsonb,integer)'::regprocedure) LIKE '%ca_jsonb_figure_text%')

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

-- The exact decimal twin of each named number in a jsonb object.
CREATE OR REPLACE FUNCTION public.ca_jsonb_figure_text(p_obj jsonb, p_keys text[])
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN jsonb_typeof(p_obj) = 'object' THEN
    p_obj || coalesce((
      SELECT jsonb_object_agg(k || '_text', p_obj ->> k)
        FROM unnest(p_keys) AS k
       WHERE jsonb_typeof(p_obj -> k) = 'number'
    ), '{}'::jsonb)
  ELSE p_obj END
$function$;
REVOKE ALL ON FUNCTION public.ca_jsonb_figure_text(jsonb, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ca_jsonb_figure_text(jsonb, text[]) TO authenticated, service_role;

-- Patch one installed function: the source must be the reviewed one, and
-- every anchor must occur exactly once.
CREATE FUNCTION pg_temp.ca_patch(p_fn regprocedure, p_md5 text, p_pairs text[])
 RETURNS void LANGUAGE plpgsql AS $patch$
DECLARE
  d text := pg_get_functiondef(p_fn);
  i int;
BEGIN
  IF md5(d) <> p_md5 THEN RAISE EXCEPTION 'Source Changed: %', p_fn; END IF;
  FOR i IN 1 .. array_length(p_pairs, 1) BY 2 LOOP
    IF (length(d) - length(replace(d, p_pairs[i], ''))) / length(p_pairs[i]) <> 1 THEN
      RAISE EXCEPTION 'Anchor Not Unique In %: %', p_fn, p_pairs[i];
    END IF;
    d := replace(d, p_pairs[i], p_pairs[i + 1]);
  END LOOP;
  EXECUTE d;
END
$patch$;

SELECT pg_temp.ca_patch(
  'public.ca_club_members_page(uuid,text,text,text,jsonb,integer)'::regprocedure,
  '02c187d1ca021677af04bb47b5b3b5c2',
  ARRAY[
    $a$(to_jsonb(v) - ARRAY['search_rank'$a$,
    $a$public.ca_jsonb_figure_text((to_jsonb(v) - ARRAY['search_rank'$a$,
    $a$          ELSE NULL END)
        ORDER BY v.rn$a$,
    $a$          ELSE NULL END), ARRAY['chip_balance', 'player_wallet', 'agent_wallet', 'promo_wallet', 'total_fees', 'downline_fees'])
        ORDER BY v.rn$a$
  ]);

SELECT pg_temp.ca_patch(
  'public.ca_club_member_detail(uuid,uuid,date,date)'::regprocedure,
  'b055c20389dcc7630802733496ea117a',
  ARRAY[
    $a$  RETURN v_out;
END;$a$,
    $a$  IF jsonb_typeof(v_out -> 'wallets') = 'object' THEN
    v_out := jsonb_set(v_out, '{wallets}', public.ca_jsonb_figure_text(v_out -> 'wallets',
      ARRAY['chip_balance', 'player_wallet', 'agent_wallet', 'promo_wallet']));
  END IF;
  IF jsonb_typeof(v_out -> 'stats') = 'object' THEN
    v_out := jsonb_set(v_out, '{stats}', public.ca_jsonb_figure_text(v_out -> 'stats',
      ARRAY['total_fee', 'mtt_fee', 'total_winnings', 'mtt_winnings', 'claimed_back', 'sent_out']));
  END IF;
  RETURN v_out;
END;$a$
  ]);

SELECT pg_temp.ca_patch(
  'public.ca_club_member_win_loss(uuid,uuid)'::regprocedure,
  '1a8beb37acc553b9a62414991fb597f4',
  ARRAY[
    $a$'today', jsonb_build_object($a$, $a$'today', public.ca_jsonb_figure_text(jsonb_build_object($a$,
    $a$'net', round(v_cash_today + v_mtt_today, 2)),$a$, $a$'net', round(v_cash_today + v_mtt_today, 2)), ARRAY['cash', 'mtt', 'net']),$a$,
    $a$'week', jsonb_build_object($a$, $a$'week', public.ca_jsonb_figure_text(jsonb_build_object($a$,
    $a$'net', round(v_cash_week + v_mtt_week, 2)),$a$, $a$'net', round(v_cash_week + v_mtt_week, 2)), ARRAY['cash', 'mtt', 'net']),$a$,
    $a$'month', jsonb_build_object($a$, $a$'month', public.ca_jsonb_figure_text(jsonb_build_object($a$,
    $a$'net', round(v_cash_month + v_mtt_month, 2)),$a$, $a$'net', round(v_cash_month + v_mtt_month, 2)), ARRAY['cash', 'mtt', 'net']),$a$,
    $a$'overall', jsonb_build_object($a$, $a$'overall', public.ca_jsonb_figure_text(jsonb_build_object($a$,
    $a$'net', round(v_cash_all + v_mtt_all, 2))
  );$a$, $a$'net', round(v_cash_all + v_mtt_all, 2)), ARRAY['cash', 'mtt', 'net'])
  );$a$
  ]);

DROP FUNCTION pg_temp.ca_patch(regprocedure, text, text[]);

COMMIT;
