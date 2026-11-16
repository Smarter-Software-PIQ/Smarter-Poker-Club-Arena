-- 20261115205037_weekly_payout_owner_updates_and_invoice_self_check
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-15 20:50:37 UTC.
--
-- WEEKLY RAKEBACK: THE OWNER IS TOLD AS THE PAYOUT PROGRESSES, AND EVERY CLUB
-- STATEMENT IS CHECKED AGAINST THE CLUB DATA SCREEN (2026-11-15).
--
-- WHAT WAS MISSING. The Monday 04:00 America/Chicago payout (cron job 528
-- weekly-payout-rounds -> smarter_private.weekly_payout_next_round()) pays in
-- stages - round 1 union -> club treasuries, round 2 agent commissions, round
-- 3 player/horse rakeback - and then the union close issues one
-- union_weekly_squareup statement per club. The union owner saw none of it
-- happen: nothing said "clubs paid", "players paid", or that the payout was
-- late (2026-11-09: round 1 paid at 10:52 UTC, 52 minutes after the 10:00 run
-- time, and nobody was told). Nothing compared what the statements charge
-- with what the Club Data screen shows for the same club and week, so a
-- statement that disagreed with the screen would only be found by a club.
--
-- WHAT THIS ADDS (new objects only - read-only on the payout path):
--   1. smarter_private.weekly_payout_owner_notify_tick(), on its own cron job
--      'weekly-payout-owner-updates' every minute. It does anything only from
--      the week's run time (public.fn_union_accounting_run_at of
--      public.fn_union_week_start) until 24 hours after; outside that window
--      it returns NULL before reading a table. Inside it, it takes its own
--      advisory try-lock and sends the Midway Union owner (public.unions.owner_id,
--      read every tick) ONE in-app/push notification per milestone per week
--      through the platform's existing public.fn_raise_notification:
--        clubs_paid       round 1 done for the union scope (club count, total)
--        agents_paid      round 2 done (agent count, total)
--        players_paid     round 3 done (payee count, total)
--        statements_sent  every club square-up of the week has a delivery row
--        invoices_checked every club square-up was compared with Club Data
--        payout_late      no round 1 by run time + 30 minutes
--      "Sent once" is the primary key (period_end, milestone) of
--      smarter_private.weekly_payout_owner_updates, written in the same
--      subtransaction as the notification.
--   2. The self-check: once the week's statements exist, each tick compares
--      ONE club statement's breakdown rake_generated / players_won with
--      public.ca_club_data_screen(club, first day, last day, 'ALL','ALL',NULL,1)
--      ->'summary' fee / total_winnings (the router the Club Data screen uses;
--      fn_ca_club_data_scope gives a postgres session the 'club' scope, which
--      is how pg_cron runs). Results go to
--      smarter_private.weekly_invoice_club_data_checks. Accounting days: the
--      week 2026-11-02 08:00Z -> 2026-11-09 08:00Z reads 2026-11-02..2026-11-08.
--      The union's own house statement (club_id = union id) is skipped. Any
--      mismatch, or a club the screen could not read, records ONE Production
--      Alert through public.fn_record_operational_alert (as
--      smarter_private.weekly_payout_readiness_check() does) and is named in
--      the invoices_checked notification.
--
-- SAFETY. No existing function, trigger, cron job or table is modified,
-- replaced or wrapped. The new code only SELECTs from the payout tables
-- (weekly_accounting_payout_pauses, union_settlement_rounds,
-- settlement_invoices, accounting_invoice_deliveries), runs under a 20 s
-- statement_timeout and 1 s lock_timeout set by its own cron command, takes
-- its own advisory key ('weekly-payout-owner-notify', never the scheduler
-- key), and catches every error into its return value, so it cannot raise
-- into or wait on the payout.
--
-- MEASURED (production, read-only, 2026-11-15): for the week ending
-- 2026-11-09 08:00Z the milestones would have been payout_late (10:30Z),
-- clubs_paid 3 clubs 840,213.67, agents_paid 20 agents 695.49, players_paid
-- 1,339 payees 642,268.52, statements_sent 4 of 4 and invoices_checked
-- 4 of 4 matching (KINGS 25,854.24 / -37,160.83, Felt 455,510.12 /
-- -473,091.31, Deep Stack 452,206.43 / -562,209.57, Club Savage 0 / 0).
--
-- periodic-work: the owner's live weekly-payout progress notices and the weekly statement-vs-Club-Data check ARE the product the owner asked for; the job only reads, runs in the 24 hours after each Monday run time, and retries nothing.
-- @live-proof: (SELECT count(*) FROM cron.job WHERE jobname='weekly-payout-owner-updates' AND active)=1 AND to_regprocedure('smarter_private.weekly_payout_owner_notify_tick(timestamp with time zone)') IS NOT NULL AND to_regclass('smarter_private.weekly_payout_owner_updates') IS NOT NULL AND to_regclass('smarter_private.weekly_invoice_club_data_checks') IS NOT NULL
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='20s';

-- One row per milestone per week: the row IS the "already sent" record.
CREATE TABLE smarter_private.weekly_payout_owner_updates(
  period_end timestamptz NOT NULL,
  milestone text NOT NULL CHECK (milestone IN ('clubs_paid','agents_paid','players_paid',
    'statements_sent','invoices_checked','payout_late','invoice_mismatch_alert')),
  union_id uuid NOT NULL,
  recipient_id uuid,
  title text NOT NULL,
  message text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (period_end, milestone)
);
ALTER TABLE smarter_private.weekly_payout_owner_updates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE smarter_private.weekly_payout_owner_updates FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE smarter_private.weekly_payout_owner_updates TO service_role;

-- One row per club statement per week: what the statement says, what the
-- Club Data screen says, and whether they agree to the cent.
CREATE TABLE smarter_private.weekly_invoice_club_data_checks(
  period_end timestamptz NOT NULL,
  club_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  invoice_number text,
  first_day date NOT NULL,
  last_day date NOT NULL,
  invoice_fee numeric,
  screen_fee numeric,
  invoice_result numeric,
  screen_result numeric,
  matches boolean,
  read_error text,
  read_ms numeric,
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (period_end, club_id)
);
ALTER TABLE smarter_private.weekly_invoice_club_data_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE smarter_private.weekly_invoice_club_data_checks FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE smarter_private.weekly_invoice_club_data_checks TO service_role;

CREATE FUNCTION smarter_private.weekly_payout_owner_chips(p numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
  SELECT to_char(round(COALESCE(p,0),2),'FM999,999,999,999,990.00')
$f$;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_owner_chips(numeric) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION smarter_private.weekly_payout_owner_count(p bigint, p_one text, p_many text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
  SELECT to_char(COALESCE(p,0),'FM999,999,999,990')||' '||CASE WHEN p=1 THEN p_one ELSE p_many END
$f$;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_owner_count(bigint,text,text) FROM PUBLIC, anon, authenticated, service_role;

-- The week's club square-ups for one union (house row excluded), one per club.
-- Every cast is guarded so a malformed breakdown can never raise.
CREATE FUNCTION smarter_private.weekly_union_club_statements(p_period_end timestamptz, p_union uuid)
RETURNS TABLE(invoice_id uuid, club_id uuid, club_name text, invoice_number text,
  period_start timestamptz, invoice_fee numeric, invoice_result numeric, delivered boolean)
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $f$
  SELECT DISTINCT ON (i.club_id) i.id, i.club_id, c.name, i.invoice_number,
    CASE WHEN i.breakdown->>'period_start' ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)?$'
      THEN (i.breakdown->>'period_start')::timestamptz END,
    CASE WHEN i.breakdown->>'rake_generated' ~ '^-?\d+(\.\d+)?$' THEN (i.breakdown->>'rake_generated')::numeric END,
    CASE WHEN i.breakdown->>'players_won' ~ '^-?\d+(\.\d+)?$' THEN (i.breakdown->>'players_won')::numeric END,
    EXISTS(SELECT 1 FROM public.accounting_invoice_deliveries d WHERE d.invoice_id=i.id)
  FROM public.settlement_invoices i
  LEFT JOIN public.clubs c ON c.id=i.club_id
  WHERE i.invoice_type='union_weekly_squareup'
    AND i.created_at>=p_period_end
    AND i.club_id IS NOT NULL AND i.club_id<>p_union
    AND ((i.from_entity_type='union' AND i.from_entity_id=p_union::text)
      OR (i.to_entity_type='union' AND i.to_entity_id=p_union::text))
    AND CASE WHEN i.breakdown->>'period_end' ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)?$'
      THEN (i.breakdown->>'period_end')::timestamptz END = p_period_end
  ORDER BY i.club_id, i.created_at DESC, i.id
$f$;
REVOKE ALL ON FUNCTION smarter_private.weekly_union_club_statements(timestamptz,uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Compares ONE not-yet-checked club statement with the Club Data screen.
CREATE FUNCTION smarter_private.weekly_invoice_club_data_check_next(p_period_end timestamptz, p_union uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public SET lock_timeout='1s' AS $f$
DECLARE s record; d_from date; d_to date; scr jsonb; v_fee numeric; v_res numeric; v_err text;
  t0 timestamptz; v_ms numeric; v_match boolean;
BEGIN
  SELECT * INTO s FROM smarter_private.weekly_union_club_statements(p_period_end,p_union) x
   WHERE NOT EXISTS(SELECT 1 FROM smarter_private.weekly_invoice_club_data_checks k
                     WHERE k.period_end=p_period_end AND k.club_id=x.club_id)
   ORDER BY x.invoice_number, x.club_id LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  d_from := public.fn_ca_accounting_day(COALESCE(s.period_start, p_period_end-interval '7 days'));
  d_to := public.fn_ca_accounting_day(p_period_end)-1;
  t0 := clock_timestamp();
  BEGIN
    scr := public.ca_club_data_screen(s.club_id,d_from,d_to,'ALL','ALL',NULL,1)->'summary';
    IF jsonb_typeof(scr->'fee')='number' AND jsonb_typeof(scr->'total_winnings')='number' THEN
      v_fee := (scr->>'fee')::numeric; v_res := (scr->>'total_winnings')::numeric;
    ELSE v_err := 'club_data_summary_missing'; END IF;
  EXCEPTION
    WHEN query_canceled THEN v_err := 'club_data_read_timed_out';
    WHEN OTHERS THEN v_err := SQLSTATE||': '||left(SQLERRM,200);
  END;
  v_ms := round(extract(epoch FROM clock_timestamp()-t0)*1000,1);
  IF v_err IS NULL THEN
    v_match := round(s.invoice_fee,2) IS NOT DISTINCT FROM round(v_fee,2)
           AND round(s.invoice_result,2) IS NOT DISTINCT FROM round(v_res,2);
  END IF;
  INSERT INTO smarter_private.weekly_invoice_club_data_checks(period_end,club_id,invoice_id,invoice_number,
    first_day,last_day,invoice_fee,screen_fee,invoice_result,screen_result,matches,read_error,read_ms)
  VALUES (p_period_end,s.club_id,s.invoice_id,s.invoice_number,d_from,d_to,s.invoice_fee,v_fee,
    s.invoice_result,v_res,v_match,v_err,v_ms)
  ON CONFLICT (period_end,club_id) DO NOTHING;
  RETURN jsonb_build_object('club_id',s.club_id,'invoice_number',s.invoice_number,'matches',v_match,
    'read_error',v_err,'read_ms',v_ms);
END $f$;
REVOKE ALL ON FUNCTION smarter_private.weekly_invoice_club_data_check_next(timestamptz,uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Every milestone that is TRUE for the week right now (sent or not). Read-only.
CREATE FUNCTION smarter_private.weekly_payout_owner_milestones(p_period_end timestamptz, p_now timestamptz, p_union uuid)
RETURNS TABLE(milestone text, title text, message text, detail jsonb)
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $f$
DECLARE due timestamptz := public.fn_union_accounting_run_at(p_period_end);
  v_name text; v_label text; v_first date; v_last date; r record; v_r1 boolean := false;
  st record; ck record;
BEGIN
  SELECT u.name INTO v_name FROM public.unions u WHERE u.id=p_union;
  v_name := COALESCE(v_name,'The union');
  v_first := public.fn_ca_accounting_day(public.fn_union_week_start(p_period_end-interval '1 day'));
  v_last := public.fn_ca_accounting_day(p_period_end)-1;
  v_label := to_char(v_first,'Mon FMDD')||' - '||to_char(v_last,'Mon FMDD');

  FOR r IN
    SELECT DISTINCT ON (z.round_no) z.round_no, z.amount, z.payees FROM (
      SELECT s.round_no, s.amount, s.payees::bigint AS payees, 1 AS pri, s.executed_at AS ts
        FROM public.union_settlement_rounds s
       WHERE s.union_id=p_union AND s.period_end=p_period_end AND s.round_no IN (1,2,3)
      UNION ALL
      SELECT (x->>'round')::int,
        CASE WHEN x->>'amount' ~ '^-?\d+(\.\d+)?$' THEN (x->>'amount')::numeric END,
        CASE WHEN x->>'payees' ~ '^\d{1,15}$' THEN (x->>'payees')::bigint END, 2, p.created_at
        FROM public.weekly_accounting_payout_pauses p
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.result->'rounds')='array'
          THEN p.result->'rounds' ELSE '[]'::jsonb END) x
       WHERE p.period_end=p_period_end AND p.instance_id='weekly-payout-rounds'
         AND jsonb_typeof(x)='object' AND x->>'scope_kind'='union' AND x->>'scope_id'=p_union::text
         AND x->>'round' IN ('1','2','3')
    ) z ORDER BY z.round_no, z.pri, z.ts DESC
  LOOP
    IF r.round_no=1 THEN
      v_r1 := true;
      milestone := 'clubs_paid';
      title := 'Weekly Rakeback: Clubs Paid ('||smarter_private.weekly_payout_owner_count(r.payees,'Club','Clubs')
        ||', '||smarter_private.weekly_payout_owner_chips(r.amount)||' Chips)';
      message := v_name||' paid '||smarter_private.weekly_payout_owner_count(r.payees,'club treasury','club treasuries')
        ||' '||smarter_private.weekly_payout_owner_chips(r.amount)||' chips of rakeback for '||v_label
        ||'. Agent commissions are paid next.';
    ELSIF r.round_no=2 THEN
      milestone := 'agents_paid';
      title := 'Weekly Rakeback: Agents Paid ('||smarter_private.weekly_payout_owner_count(r.payees,'Agent','Agents')
        ||', '||smarter_private.weekly_payout_owner_chips(r.amount)||' Chips)';
      message := 'Agent commissions for '||v_label||' are paid: '
        ||smarter_private.weekly_payout_owner_count(r.payees,'agent','agents')||', '
        ||smarter_private.weekly_payout_owner_chips(r.amount)||' chips. Player rakeback is paid next.';
    ELSE
      milestone := 'players_paid';
      title := 'Weekly Rakeback: Players Paid ('||smarter_private.weekly_payout_owner_count(r.payees,'Payee','Payees')
        ||', '||smarter_private.weekly_payout_owner_chips(r.amount)||' Chips)';
      message := 'Player and horse rakeback for '||v_label||' is paid: '
        ||smarter_private.weekly_payout_owner_count(r.payees,'payee','payees')||', '
        ||smarter_private.weekly_payout_owner_chips(r.amount)||' chips. The club statements are sent next.';
    END IF;
    detail := jsonb_build_object('round',r.round_no,'amount',r.amount,'payees',r.payees,'week',v_label);
    RETURN NEXT;
  END LOOP;

  IF NOT v_r1 AND due IS NOT NULL AND p_now>=due+interval '30 minutes' THEN
    milestone := 'payout_late';
    title := 'Weekly Rakeback: Payout Late (Clubs Not Paid By '
      ||to_char((due+interval '30 minutes') AT TIME ZONE 'America/Chicago','FMHH12:MI AM')||')';
    message := 'The weekly rakeback for '||v_label||' was due at '
      ||to_char(due AT TIME ZONE 'America/Chicago','FMHH12:MI AM')||' Chicago time and the club treasuries have not been paid 30 minutes later. '
      ||'You will get a Clubs Paid notice when it goes through.';
    detail := jsonb_build_object('due',due,'observed_at',p_now,'week',v_label);
    RETURN NEXT;
  END IF;

  SELECT count(*) AS n, count(*) FILTER (WHERE x.delivered) AS d INTO st
    FROM smarter_private.weekly_union_club_statements(p_period_end,p_union) x;
  IF st.n>0 AND st.d=st.n THEN
    milestone := 'statements_sent';
    title := 'Weekly Rakeback: Statements Sent ('||st.d||' Of '||st.n||' Clubs)';
    message := 'Every club statement for '||v_label||' has been delivered ('||st.d||' of '||st.n||' clubs).';
    detail := jsonb_build_object('statements',st.n,'delivered',st.d,'week',v_label);
    RETURN NEXT;
  END IF;

  SELECT count(*) AS n, count(k.club_id) AS checked, count(*) FILTER (WHERE k.matches) AS ok,
    string_agg(CASE WHEN k.club_id IS NOT NULL AND k.matches IS NOT TRUE THEN
      COALESCE(x.club_name,x.club_id::text)||' ('||COALESCE(x.invoice_number,'no number')||'): '||
      CASE WHEN k.read_error IS NOT NULL THEN 'Club Data could not be read'
        ELSE 'statement rake '||smarter_private.weekly_payout_owner_chips(k.invoice_fee)||' vs Club Data '
          ||smarter_private.weekly_payout_owner_chips(k.screen_fee)||', player result '
          ||smarter_private.weekly_payout_owner_chips(k.invoice_result)||' vs Club Data '
          ||smarter_private.weekly_payout_owner_chips(k.screen_result) END END,
      '; ' ORDER BY x.invoice_number) AS lines,
    COALESCE(jsonb_agg(jsonb_build_object('club_id',x.club_id,'club_name',x.club_name,'invoice_number',x.invoice_number,
      'invoice_fee',k.invoice_fee,'screen_fee',k.screen_fee,'invoice_result',k.invoice_result,
      'screen_result',k.screen_result,'matches',k.matches,'read_error',k.read_error) ORDER BY x.invoice_number),'[]'::jsonb) AS clubs
    INTO ck
    FROM smarter_private.weekly_union_club_statements(p_period_end,p_union) x
    LEFT JOIN smarter_private.weekly_invoice_club_data_checks k ON k.period_end=p_period_end AND k.club_id=x.club_id;
  IF ck.n>0 AND ck.checked=ck.n THEN
    milestone := 'invoices_checked';
    IF ck.ok=ck.n THEN
      title := 'Weekly Rakeback: Invoices Match Club Data ('||ck.ok||' Of '||ck.n||' Clubs)';
      message := 'Every club statement for '||v_label||' matches the Club Data screen to the cent (rake and player results, '
        ||ck.ok||' of '||ck.n||' clubs).';
    ELSE
      title := 'Weekly Rakeback: Invoices Do Not Match Club Data ('||ck.ok||' Of '||ck.n||' Clubs Match)';
      message := 'Some club statements for '||v_label||' differ from the Club Data screen: '||COALESCE(ck.lines,'')
        ||'. A Production Alert was recorded.';
    END IF;
    detail := jsonb_build_object('statements',ck.n,'matching',ck.ok,'all_match',ck.ok=ck.n,'clubs',ck.clubs,'week',v_label);
    RETURN NEXT;
  END IF;
END $f$;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_owner_milestones(timestamptz,timestamptz,uuid) FROM PUBLIC, anon, authenticated, service_role;

-- The cron tick. p_now exists for the native proof; the job passes nothing.
CREATE FUNCTION smarter_private.weekly_payout_owner_notify_tick(p_now timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public SET lock_timeout='1s' AS $f$
DECLARE n timestamptz := COALESCE(p_now,clock_timestamp()); e timestamptz; due timestamptz;
  v_union constant uuid := 'fade0000-0000-0000-0000-000000000001'; v_owner uuid; v_link text;
  m record; v_sent text[] := '{}'; v_failed text[] := '{}'; v_check jsonb; v_alert text; w record;
BEGIN
  e := public.fn_union_week_start(n);
  due := public.fn_union_accounting_run_at(e);
  IF e IS NULL OR due IS NULL OR n<due OR n>=due+interval '24 hours' THEN RETURN NULL; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('weekly-payout-owner-notify',0)) THEN
    RETURN jsonb_build_object('skipped','already_running');
  END IF;
  SELECT u.owner_id INTO v_owner FROM public.unions u WHERE u.id=v_union;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('skipped','union_has_no_owner'); END IF;
  v_link := '/hub/club-arena/unions/'||v_union::text||'/statements';

  BEGIN
    v_check := smarter_private.weekly_invoice_club_data_check_next(e,v_union);
  EXCEPTION WHEN OTHERS THEN v_check := jsonb_build_object('error',SQLSTATE,'message',left(SQLERRM,200));
  END;

  FOR m IN SELECT x.* FROM smarter_private.weekly_payout_owner_milestones(e,n,v_union) x
    WHERE NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_owner_updates u
                      WHERE u.period_end=e AND u.milestone=x.milestone)
  LOOP
    BEGIN
      INSERT INTO smarter_private.weekly_payout_owner_updates(period_end,milestone,union_id,recipient_id,title,message,detail)
      VALUES (e,m.milestone,v_union,v_owner,m.title,m.message,m.detail)
      ON CONFLICT (period_end,milestone) DO NOTHING;
      IF FOUND THEN
        PERFORM public.fn_raise_notification(v_owner,'system',m.title,m.message,v_link,
          COALESCE(m.detail,'{}'::jsonb)||jsonb_build_object('source','weekly-payout-owner-update',
            'milestone',m.milestone,'union_id',v_union,'period_end',e,'action_url',v_link));
        v_sent := v_sent||m.milestone;
      END IF;
    EXCEPTION WHEN OTHERS THEN v_failed := v_failed||(m.milestone||': '||SQLSTATE);
    END;
  END LOOP;

  -- ONE Production Alert per week when any statement disagrees with Club Data.
  SELECT u.* INTO w FROM smarter_private.weekly_payout_owner_updates u
   WHERE u.period_end=e AND u.milestone='invoices_checked' AND u.detail->>'all_match'='false';
  IF FOUND AND NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_owner_updates u
                           WHERE u.period_end=e AND u.milestone='invoice_mismatch_alert') THEN
    BEGIN
      INSERT INTO smarter_private.weekly_payout_owner_updates(period_end,milestone,union_id,recipient_id,title,message,detail)
      VALUES (e,'invoice_mismatch_alert',v_union,NULL,w.title,w.message,w.detail)
      ON CONFLICT (period_end,milestone) DO NOTHING;
      IF FOUND THEN
        PERFORM public.fn_record_operational_alert('weekly-payout','invoice-vs-club-data:'||to_char(e AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI"Z"'),
          'WeeklyInvoiceDiffersFromClubData','firing','critical',
          jsonb_build_object('target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca','period_end',e,
            'union_id',v_union,'summary',w.message,'clubs',w.detail->'clubs','observed_at',n));
        v_alert := 'recorded';
      END IF;
    EXCEPTION WHEN OTHERS THEN v_alert := 'failed: '||SQLSTATE;
    END;
  END IF;

  RETURN jsonb_build_object('period_end',e,'sent',to_jsonb(v_sent),'failed',to_jsonb(v_failed),
    'check',v_check,'alert',v_alert);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error',SQLSTATE,'message',left(SQLERRM,200));
END $f$;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_owner_notify_tick(timestamptz) FROM PUBLIC, anon, authenticated, service_role;

DO $cron$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname='weekly-payout-owner-updates' LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
  PERFORM cron.schedule('weekly-payout-owner-updates','* * * * *',
    $c$SELECT set_config('statement_timeout','20s',false),set_config('lock_timeout','1s',false); SELECT smarter_private.weekly_payout_owner_notify_tick();$c$);
END
$cron$;
DO $post$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname='weekly-payout-owner-updates' AND active)<>1 THEN
    RAISE EXCEPTION 'weekly_payout_owner_updates_not_scheduled';
  END IF;
END
$post$;
COMMIT;
