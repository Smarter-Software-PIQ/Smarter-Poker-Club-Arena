-- 20261114163249_weekly_union_statements_are_sent_with_the_monday_rakeback.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- OWNER INSTRUCTION (Dan, 2026-11-14 10:02 Chicago):
--   "4, FOR THE AUTOMATED WEEKLY RAKE BACK, YOU NEED TO INSURE THAT THE UNION
--    IS CALCULATING AND SENDING INVOICES TO THE CLUBS WITHIN THE UNION FOR
--    WHAT THEY OWE FOR THE WEEK, OR WHAT THEY ARE OWED FROM THE UNION FOR THE
--    WEEK, CURRENTLY THIS DOESN'T HAPPEN OR EXIST AND THERE IS NO WAY FOR THE
--    UNION TO SEE WHAT EACH CLUB OWES WEEKLY. FULLY BUILD AND IMPLEMENT THIS
--    INTO THE WEEKLY AUTOMATIC RAKE BACK."
--   "5, ... 50% OF ALL CHIPS AVAILABLE INSIDE THE PROMO WALLET AT THE END OF
--    THE WEEK ARE SUPPOSED TO BE DISTRIBURED EVENLY AMONGS THE HORSES
--    AUTOMATICALLY ... I DON'T THINK IT HAPPENED LAST WEEK (AND NO YOU DON'T
--    NEED TO BACK FILL) BUT JUST MAKE SURE ITS FULLY BUILT".
--
-- WHAT WAS WRONG, READ FROM ROWS (2026-11-14):
--
--   * The union square-up (settlement_invoices 'union_weekly_squareup', one per
--     club: club owes union / union owes club / square) IS calculated, by
--     fn_union_issue_weekly_invoices inside the union's weekly close. But:
--   * IT WAS NEVER SENT. fn_deliver_accounting_invoice carries the 2026-10-15
--     rule "only cashout documents reach the messenger. Every other invoice is
--     recorded in transaction history only and marked delivered". Every union
--     close since 2026-10-12 recorded notified 0 / messenger_deliveries 0 while
--     the Union Statements board said "Delivered". fn_get_user_conversations
--     also hid any thread whose messages were all non-cashout invoices.
--   * IT CAME DAYS LATE. The Monday 04:00 payout (rounds 1-3) is paid by the
--     round runner, but the union's books - P&L certification, one tournament
--     proof per club, ECO, square-ups - are left to job 272, whose tick is
--     240 s with a 3-minute scope budget and which only re-ticks outside
--     minutes :40-:44 while a chunk is committing. Measured: job 272 averages
--     45.7 s per tick, max 241.6 s (its own statement limit); Midway's close
--     took 130 attempts for the week ending 2026-11-09 (finished Wednesday
--     2026-11-11 09:06 UTC), 272 for 2026-11-02 (finished 2026-11-10) and 282
--     for 2026-10-26 (finished 2026-11-08).
--   * The weekly horse promo DID run last week: fn_midway_weekly_horse_promo,
--     from the same cascade, 2026-11-09 14:46 UTC, 90,274.35 promo chips (50%
--     of 180,548.70) split 90.27 / 90.28 across 1,000 distinct horses that
--     generated rake (no horse holds two active Midway wallets). Nothing told
--     anyone it ran.
--
-- WHAT THIS DOES:
--
--   1. SENT: union square-ups and union credit notes reach each club's owner
--      and staff, and the union's owner and admins, through the existing
--      accounting Messenger thread and a notification - the same delivery
--      every cashout document already uses. The union's own hub row (clubs.id
--      = union id) is a statement to itself and stays record-only. The
--      Messenger inbox lists these threads. This later owner instruction
--      supersedes the 2026-10-15 record-only rule for these two documents only.
--   2. ON MONDAY: once the round runner has paid and released the week, the
--      weekly close tick (fn_union_settlement_cascade_due, the exact function
--      job 272 runs, same chunked settings) runs every two minutes with the
--      close's own default 8-minute scope budget and a 15-minute statement,
--      until every union the payout covered has a complete close for the
--      week, for at most twelve hours after the payout time. Nothing about the
--      close changes; only its cadence and budget on payout day. Job 272 is
--      untouched and finishes anything left. Both take the same scheduler
--      lock, so they never run together. periodic-work below.
--   3. THE UNION SEES IT: when round 4 (the square-ups) is recorded for a
--      week, the union's owner and admins get one notification naming every
--      club and what it owes or is owed, linked to the Union Statements board.
--   4. The latest closed week's square-ups (week ending 2026-11-09) are
--      delivered now, once, so every club holds its current statement.
--   5. The weekly horse promo leaves a receipt: the payout report recipient
--      gets one notification per week with the budget, the horse count and
--      the share. Eligibility, budget and the split are unchanged.
--
-- periodic-work: the weekly union close on payout day - one tick every two minutes from the released Monday payout until the union's week is closed (at most twelve hours); it is the weekly accounting itself on the budget it needs, not a retry of a failed writer.
--
-- No balance is written by this migration. Delivery inserts Messenger rows,
-- notifications and accounting_invoice_deliveries only.
--
-- @live-proof: EXISTS (SELECT 1 FROM cron.job WHERE jobname='weekly-union-books' AND active) AND to_regprocedure('smarter_private.weekly_union_books_due()') IS NOT NULL AND position('union_weekly_squareup' IN pg_get_functiondef('public.fn_get_user_conversations(uuid,uuid)'::regprocedure))>0 AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.union_settlement_rounds'::regclass AND tgname='union_statements_issued_notice' AND tgenabled='O') AND position('weekly_horse_promo_receipt' IN pg_get_functiondef('public.fn_midway_weekly_horse_promo_due(timestamptz)'::regprocedure))>0

BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '120s';

DO $preimage$
BEGIN
  IF md5(pg_get_functiondef('public.fn_deliver_accounting_invoice(uuid)'::regprocedure))
       IS DISTINCT FROM '5a76ce1162d43b158e496bf3574c86d3'
     OR md5(pg_get_functiondef('public.fn_get_user_conversations(uuid,uuid)'::regprocedure))
       IS DISTINCT FROM 'bdf396d052880db05359c4bc9ddc377b'
     OR md5(pg_get_functiondef('public.fn_midway_weekly_horse_promo_due(timestamptz)'::regprocedure))
       IS DISTINCT FROM 'd54e0820c362ea36bda6a4eb45469f91' THEN
    RAISE EXCEPTION 'UNION_STATEMENTS_PREIMAGE_CHANGED';
  END IF;
END
$preimage$;

-- -----------------------------------------------------------------------------
-- 1a. Delivery: union square-ups and credit notes take the Messenger path.
-- -----------------------------------------------------------------------------
DO $deliver$
DECLARE
  c_old constant text := E' IF inv.invoice_type IS DISTINCT FROM ''cashier_cashout'' THEN\n';
  c_new constant text := E' -- Owner rule (2026-11-14) supersedes it for the union''s weekly statements:\n'
    || E' -- "THE UNION IS ... SENDING INVOICES TO THE CLUBS WITHIN THE UNION". A union\n'
    || E' -- square-up or credit note reaches the club and the union like a cashout\n'
    || E' -- document; the union''s own hub row is a statement to itself, record-only.\n'
    || E' IF inv.invoice_type IS DISTINCT FROM ''cashier_cashout''\n'
    || E'    AND NOT (inv.invoice_type IN(''union_weekly_squareup'',''union_weekly_credit_note'')\n'
    || E'             AND inv.club_id IS DISTINCT FROM NULLIF(inv.breakdown->>''union_id'','''')::uuid) THEN\n';
  v_def text := pg_get_functiondef('public.fn_deliver_accounting_invoice(uuid)'::regprocedure);
BEGIN
  IF (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'UNION_STATEMENTS_DELIVERY_PATCH_MISMATCH';
  END IF;
  EXECUTE replace(v_def, c_old, c_new);
  IF position('union_weekly_squareup' IN
       pg_get_functiondef('public.fn_deliver_accounting_invoice(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'UNION_STATEMENTS_DELIVERY_INSTALL_MISMATCH';
  END IF;
END
$deliver$;

-- -----------------------------------------------------------------------------
-- 1b. The Messenger inbox lists a union statement thread.
-- -----------------------------------------------------------------------------
DO $inbox$
DECLARE
  c_old constant text := E'AND si.invoice_type IS DISTINCT FROM ''cashier_cashout''\n';
  c_new constant text := E'AND COALESCE(si.invoice_type, '''') NOT IN (''cashier_cashout'', ''union_weekly_squareup'', ''union_weekly_credit_note'')\n';
  v_def text := pg_get_functiondef('public.fn_get_user_conversations(uuid,uuid)'::regprocedure);
BEGIN
  IF (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'UNION_STATEMENTS_INBOX_PATCH_MISMATCH';
  END IF;
  EXECUTE replace(v_def, c_old, c_new);
  IF position('union_weekly_squareup' IN
       pg_get_functiondef('public.fn_get_user_conversations(uuid,uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'UNION_STATEMENTS_INBOX_INSTALL_MISMATCH';
  END IF;
END
$inbox$;

-- -----------------------------------------------------------------------------
-- 2. The union's books close on payout day, on the budget they need.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION smarter_private.weekly_union_books_due()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  n timestamptz := clock_timestamp();
  e timestamptz := public.fn_union_week_start(clock_timestamp());
  due timestamptz;
  v_open jsonb;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  due := public.fn_union_accounting_run_at(e);
  IF n < due OR n >= due + interval '12 hours' THEN RETURN NULL; END IF;
  IF public.fn_entry_purchases_frozen() IS NOT FALSE OR public.fn_platform_frozen() IS NOT FALSE THEN
    RETURN jsonb_build_object('stage', 'weekly_union_books_frozen');
  END IF;
  -- The round runner owns the money until it releases the week.
  IF EXISTS (SELECT 1 FROM public.weekly_accounting_payout_pauses p
              WHERE p.period_end = e AND p.instance_id = 'weekly-payout-rounds'
                AND p.phase <> 'released') THEN
    RETURN jsonb_build_object('stage', 'weekly_union_books_waiting_for_payout');
  END IF;
  -- Every union the released payout covered whose close is still open.
  SELECT jsonb_agg(DISTINCT s.value->>'id') INTO v_open
    FROM public.weekly_accounting_payout_pauses p
    CROSS JOIN LATERAL jsonb_array_elements(p.scope_plan) s
   WHERE p.period_end = e AND p.instance_id = 'weekly-payout-rounds' AND p.phase = 'released'
     AND s.value->>'kind' = 'union'
     AND NOT EXISTS (SELECT 1 FROM public.union_accounting_runs r
                      WHERE r.scope_kind = 'union' AND r.scope_id = (s.value->>'id')::uuid
                        AND r.period_end = e AND r.status = 'complete');
  IF v_open IS NULL OR jsonb_array_length(v_open) = 0 THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('stage', 'weekly_union_books', 'open_unions', v_open,
    'tick', public.fn_union_settlement_cascade_due());
END
$function$;
REVOKE ALL ON FUNCTION smarter_private.weekly_union_books_due() FROM PUBLIC, anon, authenticated, service_role;

DO $schedule$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'weekly-union-books' LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
  PERFORM cron.schedule('weekly-union-books', '*/2 * * * *',
    $cron$SELECT set_config('statement_timeout','900s',false),set_config('app.weekly_accounting_attempt_budget','1',false),set_config('app.weekly_accounting_scope_budget','8 minutes',false),set_config('app.weekly_accounting_chunked','on',false); SELECT smarter_private.weekly_union_books_due();$cron$);
END
$schedule$;

-- -----------------------------------------------------------------------------
-- 3. The union sees every club's position the moment the square-ups exist.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION smarter_private.union_statements_issued_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_union record;
  v_label text;
  v_lines text;
  v_owed_to_union numeric;
  v_owed_by_union numeric;
  v_link text;
BEGIN
  IF NEW.round_no <> 4 OR NEW.detail->>'success' IS DISTINCT FROM 'true'
     OR COALESCE(NEW.detail->>'skipped', 'false') = 'true'
     OR jsonb_typeof(NEW.detail->'detail') IS DISTINCT FROM 'array' THEN
    RETURN NULL;
  END IF;
  SELECT u.id, u.name INTO v_union FROM public.unions u WHERE u.id = NEW.union_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_label := to_char(NEW.period_start AT TIME ZONE 'America/Chicago', 'Mon DD') || ' - '
          || to_char((NEW.period_end - interval '1 second') AT TIME ZONE 'America/Chicago', 'Mon DD');
  SELECT string_agg(
           (x.value->>'club_name') || CASE
             WHEN (x.value->>'outstanding')::numeric < 0
               THEN ' owes the union ' || to_char(abs((x.value->>'outstanding')::numeric), 'FM999,999,999,990.00')
             WHEN (x.value->>'outstanding')::numeric > 0
               THEN ' is owed ' || to_char((x.value->>'outstanding')::numeric, 'FM999,999,999,990.00')
             ELSE ' is square' END,
           '; ' ORDER BY (x.value->>'outstanding')::numeric, x.value->>'club_name'),
         COALESCE(sum(abs((x.value->>'outstanding')::numeric)) FILTER (WHERE (x.value->>'outstanding')::numeric < 0), 0),
         COALESCE(sum((x.value->>'outstanding')::numeric) FILTER (WHERE (x.value->>'outstanding')::numeric > 0), 0)
    INTO v_lines, v_owed_to_union, v_owed_by_union
    FROM jsonb_array_elements(NEW.detail->'detail') x
   WHERE (x.value->>'club_id')::uuid IS DISTINCT FROM NEW.union_id;
  IF v_lines IS NULL THEN RETURN NULL; END IF;
  v_link := '/hub/club-arena/unions/' || NEW.union_id::text || '/statements';
  -- A notice can never undo the close it describes: a failure here is a
  -- warning, and round 4 commits with its statements.
  BEGIN
  INSERT INTO public.notifications(user_id, type, title, message, data, link, action_url)
  SELECT pu.user_id, 'union_statements_issued',
         v_union.name || ' Weekly Statements Sent',
         'Weekly statements for ' || v_label || ' were sent to every club: ' || v_lines
           || '. Clubs owe the union ' || to_char(v_owed_to_union, 'FM999,999,999,990.00')
           || ' chips; the union owes clubs ' || to_char(v_owed_by_union, 'FM999,999,999,990.00') || ' chips.',
         jsonb_build_object('union_id', NEW.union_id, 'period_start', NEW.period_start,
           'period_end', NEW.period_end, 'clubs_owe_union', v_owed_to_union,
           'union_owes_clubs', v_owed_by_union, 'action_url', v_link),
         v_link, v_link
    FROM public.fn_accounting_invoice_party_users('union', NEW.union_id) pu
   WHERE NOT EXISTS (SELECT 1 FROM public.notifications n
                      WHERE n.user_id = pu.user_id AND n.type = 'union_statements_issued'
                        AND n.data->>'union_id' = NEW.union_id::text
                        AND (n.data->>'period_end')::timestamptz = NEW.period_end);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'union statements notice not recorded: %', SQLERRM;
  END;
  RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION smarter_private.union_statements_issued_notice() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS union_statements_issued_notice ON public.union_settlement_rounds;
CREATE TRIGGER union_statements_issued_notice
  AFTER INSERT OR UPDATE OF detail ON public.union_settlement_rounds
  FOR EACH ROW WHEN (NEW.round_no = 4)
  EXECUTE FUNCTION smarter_private.union_statements_issued_notice();

-- -----------------------------------------------------------------------------
-- 5. The weekly horse promo leaves a receipt. Everything else is the installed
-- body, byte for byte.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_midway_weekly_horse_promo_due(p_period_end timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_to timestamptz:=COALESCE(p_period_end,public.fn_union_week_start(clock_timestamp()));
 v_from timestamptz;v_result jsonb;v_report uuid;
BEGIN
 IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'midway_promo_service_required' USING ERRCODE='42501';END IF;
 IF v_to<'2026-10-19 07:00:00+00'::timestamptz OR clock_timestamp()<public.fn_union_accounting_run_at(v_to) THEN
  RETURN jsonb_build_object('success',true,'advanced',false,'reason','not_due');END IF;
 IF EXISTS(SELECT FROM public.union_weekly_horse_promo_runs WHERE union_id='fade0000-0000-0000-0000-000000000001' AND period_end=v_to) THEN
  RETURN jsonb_build_object('success',true,'advanced',false,'reason','already_paid');END IF;
 IF public.fn_platform_frozen() THEN
  RETURN jsonb_build_object('success',true,'advanced',false,'owns_tick',true,'reason','maintenance_window');END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('union-accounting-scheduler',0)) THEN
  RETURN jsonb_build_object('success',true,'advanced',false,'owns_tick',true,'reason','already_running');END IF;
 v_from:=public.fn_union_week_start(v_to-interval '1 day');
 v_result:=public.fn_midway_weekly_horse_promo(v_from,v_to);
 -- weekly_horse_promo_receipt (owner, 2026-11-14): the payout report recipient
 -- is told the promo ran, with its budget, its horses and the share.
 IF v_result->>'replayed' IS DISTINCT FROM 'true' AND v_result->>'success'='true' THEN
  SELECT report_user_id INTO v_report FROM smarter_private.weekly_payout_rounds_config WHERE singleton;
  IF v_report IS NOT NULL THEN
   -- A receipt can never undo the payment it describes.
   BEGIN
   INSERT INTO public.notifications(user_id,type,title,message,data,link,action_url)
   VALUES(v_report,'weekly_horse_promo_report','Midway Weekly Horse Promo Paid',
    CASE WHEN COALESCE((v_result->>'paid_wallets')::int,0)>0 THEN
     to_char((v_result->>'paid')::numeric,'FM999,999,999,990.00')||' promo chips (50% of the '
     ||to_char((v_result->>'opening_promo')::numeric,'FM999,999,999,990.00')||' promo wallet) were split equally across '
     ||to_char((v_result->>'paid_wallets')::int,'FM999,999,990')||' horses that played raked cash or tournament hands ('
     ||to_char(v_from AT TIME ZONE 'America/Chicago','Mon DD')||' - '||to_char((v_to-interval '1 second') AT TIME ZONE 'America/Chicago','Mon DD')||'), '
     ||to_char(trunc((v_result->>'paid')::numeric/(v_result->>'paid_wallets')::int,2),'FM999,999,990.00')||' each.'
    ELSE 'No promo chips were distributed for '||to_char(v_from AT TIME ZONE 'America/Chicago','Mon DD')||' - '
     ||to_char((v_to-interval '1 second') AT TIME ZONE 'America/Chicago','Mon DD')||': '||replace(COALESCE(v_result->>'reason','nothing to distribute'),'_',' ')||'.' END,
    (v_result-'replayed')||jsonb_build_object('period_start',v_from,'period_end',v_to,'action_url','/hub/club-arena/unions/fade0000-0000-0000-0000-000000000001/statements'),
    '/hub/club-arena/unions/fade0000-0000-0000-0000-000000000001/statements','/hub/club-arena/unions/fade0000-0000-0000-0000-000000000001/statements');
   EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'weekly horse promo receipt not recorded: %', SQLERRM;
   END;
  END IF;
 END IF;
 RETURN jsonb_build_object('success',true,'advanced',v_result->>'replayed' IS DISTINCT FROM 'true',
  'owns_tick',true,'weekly_horse_promo',v_result-'replayed');
END $function$;
-- The grants it already holds on production, stated: the engine only.
REVOKE ALL ON FUNCTION public.fn_midway_weekly_horse_promo_due(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_midway_weekly_horse_promo_due(timestamptz) TO service_role;

-- -----------------------------------------------------------------------------
-- 4. The latest closed week's square-ups reach every club now, once.
-- -----------------------------------------------------------------------------
DO $current$
DECLARE r record; v jsonb; v_sent integer := 0;
BEGIN
  FOR r IN
    SELECT si.id FROM public.settlement_invoices si
     WHERE si.invoice_type = 'union_weekly_squareup'
       AND si.breakdown->>'union_id' = 'fade0000-0000-0000-0000-000000000001'
       AND (si.breakdown->>'period_end')::timestamptz = '2026-11-09 08:00:00+00'
       AND si.status NOT IN ('paid', 'cancelled')
       AND si.club_id IS DISTINCT FROM 'fade0000-0000-0000-0000-000000000001'::uuid
     ORDER BY si.id
  LOOP
    v := public.fn_deliver_accounting_invoice(r.id);
    IF COALESCE(v->>'success', 'false') <> 'true' OR COALESCE((v->>'delivered')::int, 0) < 1 THEN
      RAISE EXCEPTION 'UNION_STATEMENT_DELIVERY_FAILED: % %', r.id, v::text;
    END IF;
    v_sent := v_sent + 1;
  END LOOP;
  -- Read 2026-11-14: Deep Stack Society, The Felt Society, KINGS CLUB, Club Savage.
  IF v_sent <> 4 THEN
    RAISE EXCEPTION 'UNION_STATEMENT_CURRENT_WEEK_MOVED: %', v_sent;
  END IF;
  RAISE NOTICE 'UNION_STATEMENTS_SENT: % clubs', v_sent;
END
$current$;

COMMIT;
