-- 20261114192824_tournaments_count_in_the_week_they_start
--
-- Reserved by scripts/new-migration.mjs on 2026-11-14 19:28:24 UTC.
--
-- CLAUDE.md 10.9 / 10.11: the reasoning goes in this header, not just the SQL.
--
-- EVERY TOURNAMENT COUNTS IN THE WEEK IT STARTS (Dan, 2026-11-14, binding):
--   "ANY TOURNAMENT, SPIN, SIT N GO OR SATELLITE GAME THAT STARTS BEFORE THE
--    CUT OFF MUST BE INCLUDED IN THE WEEK IT STARTED IN. THE INVOICES AREN'T
--    SENT FOR 4 HOURS, SO THAT GIVES MORE THEN ENOUGH TIME FOR THE EVENTS TO
--    FINISH AND RECONCILE. MAKE SURE THATS THE CASE MOVING FORWARD..."
--
-- WHAT THE PLATFORM DID. Every weekly money calculation counted a tournament
-- in the week it FINISHED. Its fee is recognized (and banked to the union) at
-- terminal time, and rakeback, agent commission, the union fee, ECO and the
-- union statements all select fees by that recognition instant; the union P&L
-- carried an event still running at the cutoff at its entries less returns,
-- so its result landed in the week it ended. Measured: 309 of 84,434
-- recognized tournaments in the last 14 days straddled a cutoff; at the
-- 2026-11-09 cutoff (Mon 2:00 AM Central) 82 Midway events were running and
-- 80 had finished by 4:00 AM. Unused satellite tickets in escrow were not
-- held at any cutoff, so a satellite's ticket prize landed in whatever week
-- the ticket was used (2,205.00 at the Nov 9 cutoff).
--
-- THE RULE FROM NOW ON. A tournament, spin, sit & go or satellite belongs to
-- the week containing GREATEST(started_at, C), C = 2026-11-16 08:00Z (Mon Nov
-- 16, 2:00 AM Central). Events that started before C were already deferred out
-- of their start week under the old rule and stay in the Nov 16 week, so no
-- closed week changes and nothing is counted twice or dropped. Weeks ending on
-- or before C are computed exactly as before.
--
--  P1  public.accounting_tournament_week_attributions (one row per earned fee
--      source of a straddler, written by the one recognition writer) and
--      public.fn_accounting_tournament_attributed_at; the payable earning
--      sources view pays a straddler at the last instant of its start week.
--      Bank time is untouched: the fee still lands in the union wallet when the
--      event ends, and every bank reconciliation stays on bank time.
--  P2  the union earned plan (window and sets) selects tournament sources by
--      attribution, re-keys its per-tournament checks, and adjusts its bank
--      total for fees banked in one week and paid in another.
--  P3  week clubs, the tournament week quality proof, the club weekly summary
--      and the union rake basis follow attribution.
--  P4  the gate: a week's books (payout, job 272, union books, the cascade, the
--      prep shards and the round-window advance) are not prepared until every
--      event that started in the week is terminal and its fee recognized; a
--      waiting week raises one warning alert naming the events from payout time
--      plus one hour, and only its own scope waits.
--  P5  the union P&L boundary, from 2026-11-23 08:00Z: an event that started
--      before the cutoff is held at exactly what changes hands after it
--      (credits, refunds, awarded seats and tickets, minus entries and
--      admissions after it, late registrations included), and every satellite
--      ticket in escrow at the cutoff is held for the club that funded the
--      entry that won it. The Nov 16-23 week picks up, once, every ticket in
--      escrow at Nov 23 (measured if it were today: Deep Stack 5,150.00, Felt
--      5,780.00 of player result).
--  P6  the earned-plan fallback and the weekly union close conserve the bank
--      the same way; commission accruals carry the attributed instant, and an
--      event whose start week already closed is not attributed backwards.
--
-- Every inserted fragment carries the marker START-WEEK ATTRIBUTION (20261116).
-- Every patched function is guarded by its preimage md5 (pg_catalog search
-- path) and asserted for owner, ACL, security, config and volatility; every
-- moved pin is read back from the catalog. Qualified read-only on production
-- 2026-11-14 with self-aborting pg_temp probes: identical output for windows
-- inside Nov 9-16 with an empty side table, and balanced windows when one
-- tournament is attributed across a window.
--
-- @live-proof: smarter_private.original_inventory_proof_sources_match() IS TRUE AND to_regclass('public.accounting_tournament_week_attributions') IS NOT NULL AND position('START-WEEK ATTRIBUTION (20261116)' IN pg_get_functiondef('public.fn_prepare_accounting_week(uuid,uuid,timestamptz,timestamptz)'::regprocedure))>0 AND position('START-WEEK ATTRIBUTION (20261116)' IN pg_get_functiondef('public.fn_union_pnl_boundary(uuid,timestamptz)'::regprocedure))>0

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';


-- ===========================================================================
-- P1. START-WEEK ATTRIBUTION (20261116): the side table, the attribution
-- instant, the one recognition writer, and the payable earning sources view.
--
-- Nothing in this part changes any output until the first fee recognition at
-- or after 2026-11-23 08:00Z of a tournament that started in an earlier week:
-- until then the side table is empty and the view returns exactly today's rows
-- (proved: 452 rows, md5 cc85c7ac47ee456808170b8a510dbef2, for 2026-11-12
-- 18:00-20:00Z, old view and new tournament branches, side table empty).
-- ===========================================================================

-- P1.1 The side table. Small (about 150 rows a week: only events whose fee is
-- recognized in a later week than the one they started in), append-only by
-- grant, no foreign key to a hot table (CLAUDE.md section 2 rule 7).
CREATE TABLE public.accounting_tournament_week_attributions (
  source_id     uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  recognized_at timestamptz NOT NULL,
  attributed_at timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounting_tournament_week_attributions_earlier CHECK (attributed_at < recognized_at)
);
CREATE INDEX accounting_tournament_week_attributions_window
  ON public.accounting_tournament_week_attributions (attributed_at, tournament_id);
CREATE INDEX accounting_tournament_week_attributions_tournament
  ON public.accounting_tournament_week_attributions (tournament_id);
ALTER TABLE public.accounting_tournament_week_attributions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.accounting_tournament_week_attributions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.accounting_tournament_week_attributions TO service_role;
COMMENT ON TABLE public.accounting_tournament_week_attributions IS
  'START-WEEK ATTRIBUTION (20261116), Dan 2026-11-14: a tournament, spin, sit & go or satellite belongs to the week it started in. One row per earned fee source whose recognition (bank) week is later than its start week; attributed_at is the last instant of the start week. Written only by fn_recognize_accounting_tournament_fees.';

-- P1.2 The attribution instant. The week is fn_union_week_start's: Monday
-- 00:00 America/Los_Angeles = Monday 2:00 AM America/Chicago (08:00Z standard,
-- 07:00Z daylight). C = 2026-11-16 08:00Z: an event that started before C
-- belongs to the week containing C (it was already deferred out of its start
-- week under the old rule), so no closed week ever changes.
CREATE FUNCTION public.fn_accounting_tournament_attributed_at(p_tournament_id uuid, p_recognized_at timestamptz)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 -- START-WEEK ATTRIBUTION (20261116)
 SELECT CASE
   WHEN public.fn_union_week_start(p_recognized_at)
        > public.fn_union_week_start(GREATEST(COALESCE(t.started_at, p_recognized_at), '2026-11-16 08:00:00+00'::timestamptz))
   THEN public.fn_union_week_start(
          public.fn_union_week_start(GREATEST(COALESCE(t.started_at, p_recognized_at), '2026-11-16 08:00:00+00'::timestamptz))
          + interval '8 days') - interval '1 microsecond'
   ELSE p_recognized_at END
 FROM (SELECT (SELECT x.started_at FROM public.tournaments x WHERE x.id = p_tournament_id) AS started_at) t
$function$;
REVOKE ALL ON FUNCTION public.fn_accounting_tournament_attributed_at(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_accounting_tournament_attributed_at(uuid, timestamptz) TO service_role;

-- P1.3 The only writer of accounting_tournament_recognized_sources writes the
-- attribution in the same statement sequence, for earned sources of a
-- recognized (net fee > 0) event only, and asks the start week's period to
-- recompute as well as the recognition week's.
DO $recognize$
DECLARE
  c_sig constant text := 'public.fn_recognize_accounting_tournament_fees(uuid,timestamptz,uuid,uuid,uuid)';
  c_old_md5 constant text := '48005212e5690fe916f57c3a4da9bf57';
  c_decl_old constant text := $old$week_date date;batch_admitted boolean;
$old$;
  c_decl_new constant text := $new$week_date date;batch_admitted boolean;
 v_attributed timestamptz;
$new$;
  c_ins_old constant text := $old$ FROM public.accounting_tournament_fee_sources s WHERE s.id=ANY(active_ids||refunded_ids);
$old$;
  c_ins_new constant text := $new$ FROM public.accounting_tournament_fee_sources s WHERE s.id=ANY(active_ids||refunded_ids);
 -- START-WEEK ATTRIBUTION (20261116): an event recognized in a later week
 -- than it started in is attributed to the last instant of its start week.
 -- The recognition and the bank keep their own instant; only the week the
 -- earning belongs to moves (accounting_payable_earning_sources reads it).
 v_attributed:=public.fn_accounting_tournament_attributed_at(p_tournament_id,p_recognized_at);
 IF net_fee>0 AND v_attributed IS DISTINCT FROM p_recognized_at THEN
  INSERT INTO public.accounting_tournament_week_attributions(source_id,tournament_id,recognized_at,attributed_at)
  SELECT s.id,p_tournament_id,p_recognized_at,v_attributed
   FROM public.accounting_tournament_fee_sources s WHERE s.id=ANY(active_ids)
  ON CONFLICT (source_id) DO NOTHING;
 END IF;
$new$;
  c_rc_old constant text := $old$ SELECT count(DISTINCT player_id),count(*) INTO users_count,source_count FROM$old$;
  c_rc_new constant text := $new$ -- START-WEEK ATTRIBUTION (20261116): the start week's periods recompute too.
 IF net_fee>0 AND v_attributed IS DISTINCT FROM p_recognized_at THEN
  week_date:=(public.fn_union_week_start(v_attributed) AT TIME ZONE 'America/Los_Angeles')::date;
  INSERT INTO public.accounting_period_recompute_requests(club_id,period_start,period_end,status)
  SELECT DISTINCT club_id,week_date,week_date+6,'pending' FROM public.accounting_tournament_fee_sources WHERE id=ANY(active_ids)
  ON CONFLICT(club_id,period_start,period_end) DO UPDATE SET status='pending',reason=NULL,last_result='{}'::jsonb,last_requested_at=transaction_timestamp();
 END IF;
 SELECT count(DISTINCT player_id),count(*) INTO users_count,source_count FROM$new$;
  d text; p text; m jsonb; m2 jsonb; previous text := current_setting('search_path');
BEGIN
  PERFORM set_config('search_path', 'pg_catalog', true);
  d := pg_get_functiondef(c_sig::regprocedure);
  PERFORM set_config('search_path', previous, true);
  IF md5(d) IS DISTINCT FROM c_old_md5 THEN
    RAISE EXCEPTION 'START_WEEK_RECOGNIZE_PREIMAGE_CHANGED: %', md5(d) USING ERRCODE = '55000';
  END IF;
  IF (length(d) - length(replace(d, c_decl_old, ''))) / length(c_decl_old) <> 1
     OR (length(d) - length(replace(d, c_ins_old, ''))) / length(c_ins_old) <> 1
     OR (length(d) - length(replace(d, c_rc_old, ''))) / length(c_rc_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_RECOGNIZE_ANCHOR: an anchor is not unique' USING ERRCODE = '55000';
  END IF;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_proc WHERE oid = c_sig::regprocedure;
  p := replace(replace(replace(d, c_decl_old, c_decl_new), c_ins_old, c_ins_new), c_rc_old, c_rc_new);
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_sig::regprocedure;
  PERFORM set_config('search_path', 'pg_catalog', true);
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_sig::regprocedure) <> p THEN
    RAISE EXCEPTION 'START_WEEK_RECOGNIZE_POSTIMAGE %', md5(pg_get_functiondef(c_sig::regprocedure)) USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('search_path', previous, true);
END
$recognize$;

-- P1.4 The payable earning sources view. Only the tournament branch changes,
-- split in two so every consumer's earned_at range still reaches an index:
--   (a) a source with no attribution row: earned_at = rs.recognized_at, exactly
--       as before, through accounting_tournament_recognized_sources_week;
--   (b) an attributed source: earned_at = a.attributed_at, through the side
--       table's (attributed_at, tournament_id) index.
-- Column list and order are identical; security_invoker, owner and grants are
-- asserted unchanged. The launch cutoffs are still read once per branch.
DO $view_pre$
DECLARE v_meta text; v_cols text; previous text := current_setting('search_path');
BEGIN
  PERFORM set_config('search_path', 'pg_catalog', true);
  IF md5(pg_get_viewdef('public.accounting_payable_earning_sources'::regclass)) IS DISTINCT FROM 'c71b1095aacf430538f9247f350dfd54' THEN
    RAISE EXCEPTION 'START_WEEK_VIEW_PREIMAGE_CHANGED: %', md5(pg_get_viewdef('public.accounting_payable_earning_sources'::regclass)) USING ERRCODE = '55000';
  END IF;
  SELECT string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod),',' ORDER BY a.attnum) INTO v_cols
    FROM pg_attribute a WHERE a.attrelid='public.accounting_payable_earning_sources'::regclass AND a.attnum>0 AND NOT a.attisdropped;
  SELECT array_to_string(c.reloptions,',')||'|'||c.relacl::text||'|'||c.relowner::regrole INTO v_meta
    FROM pg_class c WHERE c.oid='public.accounting_payable_earning_sources'::regclass;
  PERFORM set_config('search_path', previous, true);
  PERFORM set_config('ca.start_week_view_cols', v_cols, true);
  PERFORM set_config('ca.start_week_view_meta', v_meta, true);
END
$view_pre$;

CREATE OR REPLACE VIEW public.accounting_payable_earning_sources WITH (security_invoker=true) AS
 SELECT 'cash_rake_accrual'::text AS source_type,
    s.id AS source_id,
    s.rake_record_id,
    NULL::uuid AS tournament_id,
    s.player_id,
    s.club_id,
    s.union_id,
    s.coordinator_union_id,
    s.earned_at,
    s.rake_credit,
    s.contract
   FROM public.accounting_effective_cash_rake_sources s
     LEFT JOIN public.fn_ca_launch_accounting_club_cutoffs() bd(club_id, cutoff_at) ON bd.club_id = s.club_id
  WHERE (bd.cutoff_at IS NULL OR (s.earned_at IS NOT NULL AND isfinite(s.earned_at) AND s.earned_at >= bd.cutoff_at))
UNION ALL
 -- START-WEEK ATTRIBUTION (20261116), branch (a): not attributed.
 SELECT 'tournament_fee_accrual'::text AS source_type,
    s.id AS source_id,
    s.rake_record_id,
    s.tournament_id,
    s.player_id,
    s.club_id,
    s.union_id,
    s.coordinator_union_id,
    rs.recognized_at AS earned_at,
    s.rake_credit,
    s.contract
   FROM public.accounting_effective_tournament_fee_sources s
     JOIN public.accounting_tournament_recognized_sources rs ON rs.source_id = s.id AND rs.tournament_id = s.tournament_id
     JOIN public.accounting_tournament_fee_recognitions r ON r.tournament_id = s.tournament_id
     LEFT JOIN public.fn_ca_launch_accounting_club_cutoffs() bd(club_id, cutoff_at) ON bd.club_id = s.club_id
  WHERE (bd.cutoff_at IS NULL OR (s.charged_at IS NOT NULL AND isfinite(s.charged_at) AND s.charged_at >= bd.cutoff_at))
    AND (bd.cutoff_at IS NULL OR (rs.recognized_at IS NOT NULL AND isfinite(rs.recognized_at) AND rs.recognized_at >= bd.cutoff_at))
    AND rs.disposition = 'earned'::text AND r.status = 'recognized'::text AND rs.rake_credit = s.rake_credit
    AND rs.recognized_at = r.recognized_at AND NOT (s.union_id IS DISTINCT FROM r.union_id)
    AND NOT EXISTS (SELECT 1 FROM public.accounting_tournament_week_attributions a WHERE a.source_id = s.id)
UNION ALL
 -- START-WEEK ATTRIBUTION (20261116), branch (b): attributed to its start week.
 SELECT 'tournament_fee_accrual'::text AS source_type,
    s.id AS source_id,
    s.rake_record_id,
    s.tournament_id,
    s.player_id,
    s.club_id,
    s.union_id,
    s.coordinator_union_id,
    a.attributed_at AS earned_at,
    s.rake_credit,
    s.contract
   FROM public.accounting_tournament_week_attributions a
     JOIN public.accounting_effective_tournament_fee_sources s ON s.id = a.source_id AND s.tournament_id = a.tournament_id
     JOIN public.accounting_tournament_recognized_sources rs ON rs.source_id = s.id AND rs.tournament_id = s.tournament_id
     JOIN public.accounting_tournament_fee_recognitions r ON r.tournament_id = s.tournament_id
     LEFT JOIN public.fn_ca_launch_accounting_club_cutoffs() bd(club_id, cutoff_at) ON bd.club_id = s.club_id
  WHERE (bd.cutoff_at IS NULL OR (s.charged_at IS NOT NULL AND isfinite(s.charged_at) AND s.charged_at >= bd.cutoff_at))
    AND (bd.cutoff_at IS NULL OR (rs.recognized_at IS NOT NULL AND isfinite(rs.recognized_at) AND rs.recognized_at >= bd.cutoff_at))
    AND rs.disposition = 'earned'::text AND r.status = 'recognized'::text AND rs.rake_credit = s.rake_credit
    AND rs.recognized_at = r.recognized_at AND NOT (s.union_id IS DISTINCT FROM r.union_id);

-- The view keeps exactly its grants: service_role reads it, nobody else
-- (explicit, so the table-access check sees them; ACL asserted unchanged below).
REVOKE ALL ON TABLE public.accounting_payable_earning_sources FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.accounting_payable_earning_sources TO service_role;

DO $view_post$
DECLARE v_meta text; v_cols text; v_def text; previous text := current_setting('search_path');
BEGIN
  PERFORM set_config('search_path', 'pg_catalog', true);
  SELECT string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod),',' ORDER BY a.attnum) INTO v_cols
    FROM pg_attribute a WHERE a.attrelid='public.accounting_payable_earning_sources'::regclass AND a.attnum>0 AND NOT a.attisdropped;
  SELECT array_to_string(c.reloptions,',')||'|'||c.relacl::text||'|'||c.relowner::regrole INTO v_meta
    FROM pg_class c WHERE c.oid='public.accounting_payable_earning_sources'::regclass;
  v_def := pg_get_viewdef('public.accounting_payable_earning_sources'::regclass);
  PERFORM set_config('search_path', previous, true);
  IF v_cols IS DISTINCT FROM current_setting('ca.start_week_view_cols') THEN
    RAISE EXCEPTION 'START_WEEK_VIEW_COLUMNS_CHANGED' USING ERRCODE = '55000';
  END IF;
  IF v_meta IS DISTINCT FROM current_setting('ca.start_week_view_meta') THEN
    RAISE EXCEPTION 'START_WEEK_VIEW_SECURITY_CHANGED: % vs %', v_meta, current_setting('ca.start_week_view_meta') USING ERRCODE = '55000';
  END IF;
  IF (length(v_def) - length(replace(v_def, 'accounting_tournament_week_attributions', ''))) / length('accounting_tournament_week_attributions') <> 2
     OR (length(v_def) - length(replace(v_def, 'fn_ca_launch_accounting_club_cutoffs()', ''))) / length('fn_ca_launch_accounting_club_cutoffs()') <> 3
     OR position('fn_ca_launch_accounting_accepts' IN v_def) > 0 THEN
    RAISE EXCEPTION 'START_WEEK_VIEW_POSTIMAGE' USING ERRCODE = '55000';
  END IF;
  -- The side table is empty at install, so the view's output is unchanged.
  IF EXISTS (SELECT 1 FROM public.accounting_tournament_week_attributions) THEN
    RAISE EXCEPTION 'START_WEEK_SIDE_TABLE_NOT_EMPTY' USING ERRCODE = '55000';
  END IF;
END
$view_post$;


-- P2: start-week attribution in the union earned plan (window and sets).
-- Requires P1 (public.accounting_tournament_week_attributions) installed earlier in the same migration.

-- P2a. fn_accounting_union_earned_plan_window: one two-hour window of the chunked close.
DO $p2_window$
DECLARE
  c_sig constant text := 'public.fn_accounting_union_earned_plan_window(uuid,timestamptz,timestamptz)';
  c_old_md5 constant text := '737ffac96388517d170c9962174f0222';
  -- (A) tour_keys carries the instant each source is paid at.
  a_old constant text := $a_old$   SELECT rs.source_id,rs.tournament_id,rs.recognized_at,rs.rake_credit
    FROM public.accounting_tournament_recognized_sources rs
$a_old$;
  a_new constant text := $a_new$   SELECT rs.source_id,rs.tournament_id,rs.recognized_at,rs.rake_credit,rs.recognized_at AS earned_at
    FROM public.accounting_tournament_recognized_sources rs
$a_new$;
  -- (B) a source attributed to its start week leaves the window it was banked
  --     in and joins the window holding its attributed instant.
  b_old constant text := $b_old$     AND r.recognized_at>=$2 AND r.recognized_at<$3
  ), raw AS (
$b_old$;
  b_new constant text := $b_new$     AND r.recognized_at>=$2 AND r.recognized_at<$3
     AND NOT EXISTS(SELECT 1 FROM public.accounting_tournament_week_attributions a WHERE a.source_id=rs.source_id)
   UNION ALL
   -- START-WEEK ATTRIBUTION (20261116): a tournament is paid in the week it
   -- started (Dan, 2026-11-14). A source of a tournament that finished in a
   -- later week is paid at its attributed instant, the last instant of its
   -- start week, wherever its recognition was banked.
   -- The two big tables are read by key (bitmap scans of their primary keys;
   -- this statement runs with index scans and nested loops off).
   SELECT rs.source_id,rs.tournament_id,rs.recognized_at,rs.rake_credit,a.attributed_at
    FROM public.accounting_tournament_recognized_sources rs
    JOIN public.accounting_tournament_week_attributions a
     ON a.source_id=rs.source_id AND a.tournament_id=rs.tournament_id AND a.recognized_at=rs.recognized_at
    JOIN public.accounting_tournament_fee_recognitions r ON r.tournament_id=rs.tournament_id
    WHERE rs.source_id=ANY(ARRAY(SELECT a1.source_id FROM public.accounting_tournament_week_attributions a1
           WHERE a1.attributed_at>=$2 AND a1.attributed_at<$3))
     AND r.tournament_id=ANY(ARRAY(SELECT a2.tournament_id FROM public.accounting_tournament_week_attributions a2
           WHERE a2.attributed_at>=$2 AND a2.attributed_at<$3))
     AND a.attributed_at>=$2 AND a.attributed_at<$3 AND rs.disposition='earned'
     AND r.status='recognized' AND rs.recognized_at=r.recognized_at AND r.union_id=$1
  ), raw AS (
$b_new$;
  -- (C) both raw branches carry the bank instant; a tournament source is paid
  --     at its attributed instant.
  c1_old constant text := $c1_old$NULL::boolean AS terms_match
$c1_old$;
  c1_new constant text := $c1_new$NULL::boolean AS terms_match,s.earned_at AS bank_at
$c1_new$;
  c2_old constant text := $c2_old$    s.union_id,s.coordinator_union_id,k.recognized_at,s.rake_credit,s.contract,COALESCE(s.game_type,'cash'),
    (public.fn_accounting_tournament_source_terms_at(s.tournament_id,s.charged_at,s.contract)=(s.contract->>'terms_at')::timestamptz)
$c2_old$;
  c2_new constant text := $c2_new$    s.union_id,s.coordinator_union_id,k.earned_at,s.rake_credit,s.contract,COALESCE(s.game_type,'cash'),
    (public.fn_accounting_tournament_source_terms_at(s.tournament_id,s.charged_at,s.contract)=(s.contract->>'terms_at')::timestamptz),k.recognized_at
$c2_new$;
  -- (D) terms are checked against the bank instant (equal to earned_at for
  --     every row that is not attributed).
  d_old constant text := $d_old$OR s.terms_at IS NULL OR s.terms_at>s.earned_at
$d_old$;
  d_new constant text := $d_new$OR s.terms_at IS NULL OR s.terms_at>s.bank_at
$d_new$;
  -- (E) q4: every recognition this window pays has its sources here, at its instant.
  e1_old constant text := $e1_old$    (SELECT count(*) FROM fw f LEFT JOIN (SELECT s.tournament_id,s.earned_at,count(*) AS n,sum(s.rake_credit) AS total FROM src s
$e1_old$;
  e1_new constant text := $e1_new$    (SELECT count(*) FROM fa f LEFT JOIN (SELECT s.tournament_id,s.earned_at,count(*) AS n,sum(s.rake_credit) AS total FROM src s
$e1_new$;
  e2_old constant text := $e2_old$       ON x.tournament_id=f.tournament_id AND x.earned_at=f.recognized_at
$e2_old$;
  e2_new constant text := $e2_new$       ON x.tournament_id=f.tournament_id AND x.earned_at=f.earned_at
$e2_new$;
  -- (F) q5: every tournament source matches a recognition this window pays.
  f1_old constant text := $f1_old$       LEFT JOIN fw f ON s.source_type='tournament_fee_accrual' AND f.tournament_id=s.tournament_id
$f1_old$;
  f1_new constant text := $f1_new$       LEFT JOIN fa f ON s.source_type='tournament_fee_accrual' AND f.tournament_id=s.tournament_id
$f1_new$;
  f2_old constant text := $f2_old$       OR (s.source_type='tournament_fee_accrual' AND (f.tournament_id IS NULL OR f.recognized_at IS DISTINCT FROM s.earned_at
$f2_old$;
  f2_new constant text := $f2_new$       OR (s.source_type='tournament_fee_accrual' AND (f.tournament_id IS NULL OR f.earned_at IS DISTINCT FROM s.earned_at
$f2_new$;
  -- (G) the bank this window answers for: its own bank, less recognitions
  --     banked here that another week pays, plus recognitions banked in a
  --     later window that this window pays. Unchanged when nothing is attributed.
  g_old constant text := $g_old$   (SELECT sum(amount) FROM tw) AS bank_sum,
$g_old$;
  g_new constant text := $g_new$   (SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM attributed_bank) THEN (SELECT sum(amount) FROM tw)
     ELSE COALESCE((SELECT sum(amount) FROM tw),0)
      -COALESCE((SELECT sum(net_rake) FROM attributed_bank WHERE side='out'),0)
      +COALESCE((SELECT sum(net_rake) FROM attributed_bank WHERE side='in'),0) END) AS bank_sum,
$g_new$;
  -- (H) the recognitions this window pays, and the bank moved between weeks.
  h_old constant text := $h_old$  ), tour_keys AS MATERIALIZED (
$h_old$;
  h_new constant text := $h_new$  ), fa AS MATERIALIZED (
   -- START-WEEK ATTRIBUTION (20261116): the recognitions whose sources this
   -- window pays. One with no attribution row is paid where it was banked
   -- (fw, unchanged); one attributed to its start week is paid in the window
   -- holding its attributed instant. Bank checks (tw, q1, q2) stay on bank time.
   SELECT f.tournament_id,f.net_rake,f.status,f.recognized_at,f.recognized_at AS earned_at,false AS attributed FROM fw f
    WHERE NOT EXISTS(SELECT 1 FROM public.accounting_tournament_week_attributions a
     WHERE a.tournament_id=f.tournament_id AND a.recognized_at=f.recognized_at)
   UNION ALL
   SELECT f.tournament_id,f.net_rake,f.status,f.recognized_at,a.attributed_at,true
    FROM (SELECT DISTINCT a0.tournament_id,a0.recognized_at,a0.attributed_at FROM public.accounting_tournament_week_attributions a0
           WHERE a0.attributed_at>=$2 AND a0.attributed_at<$3) a
    JOIN public.accounting_tournament_fee_recognitions f
     ON f.tournament_id=a.tournament_id AND f.recognized_at=a.recognized_at AND f.union_id=$1
    WHERE f.tournament_id=ANY(ARRAY(SELECT a3.tournament_id FROM public.accounting_tournament_week_attributions a3
           WHERE a3.attributed_at>=$2 AND a3.attributed_at<$3))
  ), attributed_bank AS MATERIALIZED (
   -- START-WEEK ATTRIBUTION (20261116): this window's bank that another week
   -- pays ('out') and another window's bank that this window pays ('in').
   SELECT 'out'::text AS side,f.net_rake FROM fw f
    WHERE f.net_rake>0 AND EXISTS(SELECT 1 FROM public.accounting_tournament_week_attributions a
     WHERE a.tournament_id=f.tournament_id AND a.recognized_at=f.recognized_at)
   UNION ALL
   SELECT 'in'::text,f.net_rake FROM fa f WHERE f.net_rake>0 AND f.attributed
  ), tour_keys AS MATERIALIZED (
$h_new$;
  d text; p text; m jsonb; m2 jsonb; n int; previous text := current_setting('search_path');
  pairs text[][];
BEGIN
  PERFORM set_config('search_path', 'pg_catalog', true);
  d := pg_get_functiondef(c_sig::regprocedure);
  PERFORM set_config('search_path', previous, true);
  IF md5(d) IS DISTINCT FROM c_old_md5 THEN
    RAISE EXCEPTION 'P2_EARNED_PLAN_WINDOW_PREIMAGE_CHANGED: %', md5(d) USING ERRCODE = '55000';
  END IF;
  pairs := ARRAY[[a_old,a_new],[b_old,b_new],[c1_old,c1_new],[c2_old,c2_new],[d_old,d_new],
                 [e1_old,e1_new],[e2_old,e2_new],[f1_old,f1_new],[f2_old,f2_new],[g_old,g_new],[h_old,h_new]];
  p := d;
  FOR i IN 1..array_length(pairs,1) LOOP
    n := (length(p) - length(replace(p, pairs[i][1], ''))) / length(pairs[i][1]);
    IF n IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'P2_EARNED_PLAN_WINDOW_ANCHOR_%: found % times', i, n USING ERRCODE = '55000';
    END IF;
    p := replace(p, pairs[i][1], pairs[i][2]);
  END LOOP;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_proc WHERE oid = c_sig::regprocedure;
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_sig::regprocedure;
  PERFORM set_config('search_path', 'pg_catalog', true);
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_sig::regprocedure) <> p THEN
    RAISE EXCEPTION 'P2_EARNED_PLAN_WINDOW_POSTIMAGE %', md5(pg_get_functiondef(c_sig::regprocedure)) USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('search_path', previous, true);
END
$p2_window$;

-- P2b. fn_accounting_union_earned_plan_sets: the whole week read as sets.
DO $p2_sets$
DECLARE
  c_sig constant text := 'public.fn_accounting_union_earned_plan_sets(uuid,timestamptz,timestamptz)';
  c_old_md5 constant text := 'dce90bd407404e6bf8e135874b7b9209';
  a_old constant text := $a_old$   SELECT rs.source_id,rs.tournament_id,rs.recognized_at,rs.rake_credit
    FROM public.accounting_tournament_recognized_sources rs
$a_old$;
  a_new constant text := $a_new$   SELECT rs.source_id,rs.tournament_id,rs.recognized_at,rs.rake_credit,rs.recognized_at AS earned_at
    FROM public.accounting_tournament_recognized_sources rs
$a_new$;
  b_old constant text := $b_old$     AND r.status='recognized' AND rs.recognized_at=r.recognized_at AND r.union_id=$1
  ), raw AS (
$b_old$;
  b_new constant text := $b_new$     AND r.status='recognized' AND rs.recognized_at=r.recognized_at AND r.union_id=$1
     AND NOT EXISTS(SELECT 1 FROM public.accounting_tournament_week_attributions a WHERE a.source_id=rs.source_id)
   UNION ALL
   -- START-WEEK ATTRIBUTION (20261116): a tournament is paid in the week it
   -- started (Dan, 2026-11-14). A source of a tournament that finished in a
   -- later week is paid at its attributed instant, the last instant of its
   -- start week, wherever its recognition was banked.
   -- The two big tables are read by key (bitmap scans of their primary keys;
   -- this statement runs with index scans off).
   SELECT rs.source_id,rs.tournament_id,rs.recognized_at,rs.rake_credit,a.attributed_at
    FROM public.accounting_tournament_recognized_sources rs
    JOIN public.accounting_tournament_week_attributions a
     ON a.source_id=rs.source_id AND a.tournament_id=rs.tournament_id AND a.recognized_at=rs.recognized_at
    JOIN public.accounting_tournament_fee_recognitions r ON r.tournament_id=rs.tournament_id
    WHERE rs.source_id=ANY(ARRAY(SELECT a1.source_id FROM public.accounting_tournament_week_attributions a1
           WHERE a1.attributed_at>=$2 AND a1.attributed_at<$3))
     AND r.tournament_id=ANY(ARRAY(SELECT a2.tournament_id FROM public.accounting_tournament_week_attributions a2
           WHERE a2.attributed_at>=$2 AND a2.attributed_at<$3))
     AND a.attributed_at>=$2 AND a.attributed_at<$3 AND rs.disposition='earned'
     AND r.status='recognized' AND rs.recognized_at=r.recognized_at AND r.union_id=$1
  ), raw AS (
$b_new$;
  c1_old constant text := $c1_old$NULL::boolean AS terms_match
$c1_old$;
  c1_new constant text := $c1_new$NULL::boolean AS terms_match,s.earned_at AS bank_at
$c1_new$;
  c2_old constant text := $c2_old$    s.union_id,s.coordinator_union_id,k.recognized_at,s.rake_credit,s.contract,COALESCE(s.game_type,'cash'),
    (public.fn_accounting_tournament_source_terms_at(s.tournament_id,s.charged_at,s.contract)=(s.contract->>'terms_at')::timestamptz)
$c2_old$;
  c2_new constant text := $c2_new$    s.union_id,s.coordinator_union_id,k.earned_at,s.rake_credit,s.contract,COALESCE(s.game_type,'cash'),
    (public.fn_accounting_tournament_source_terms_at(s.tournament_id,s.charged_at,s.contract)=(s.contract->>'terms_at')::timestamptz),k.recognized_at
$c2_new$;
  d_old constant text := $d_old$OR s.terms_at IS NULL OR s.terms_at>s.earned_at
$d_old$;
  d_new constant text := $d_new$OR s.terms_at IS NULL OR s.terms_at>s.bank_at
$d_new$;
  e1_old constant text := $e1_old$    (SELECT count(*) FROM fw f LEFT JOIN (SELECT s.tournament_id,s.earned_at,count(*) AS n,sum(s.rake_credit) AS total FROM src s
$e1_old$;
  e1_new constant text := $e1_new$    (SELECT count(*) FROM fa f LEFT JOIN (SELECT s.tournament_id,s.earned_at,count(*) AS n,sum(s.rake_credit) AS total FROM src s
$e1_new$;
  e2_old constant text := $e2_old$       ON x.tournament_id=f.tournament_id AND x.earned_at=f.recognized_at
$e2_old$;
  e2_new constant text := $e2_new$       ON x.tournament_id=f.tournament_id AND x.earned_at=f.earned_at
$e2_new$;
  f1_old constant text := $f1_old$       LEFT JOIN fw f ON s.source_type='tournament_fee_accrual' AND f.tournament_id=s.tournament_id
$f1_old$;
  f1_new constant text := $f1_new$       LEFT JOIN fa f ON s.source_type='tournament_fee_accrual' AND f.tournament_id=s.tournament_id
$f1_new$;
  f2_old constant text := $f2_old$       OR (s.source_type='tournament_fee_accrual' AND (f.tournament_id IS NULL OR f.recognized_at IS DISTINCT FROM s.earned_at
$f2_old$;
  f2_new constant text := $f2_new$       OR (s.source_type='tournament_fee_accrual' AND (f.tournament_id IS NULL OR f.earned_at IS DISTINCT FROM s.earned_at
$f2_new$;
  -- The week's period_rake is the bank of the tournaments this week pays:
  -- unchanged when nothing is attributed, and the conservation test below
  -- (source_total = bank_total) then holds exactly as before.
  g_old constant text := $g_old$   (SELECT COALESCE(sum(amount),0) FROM tw) AS bank_total,
$g_old$;
  g_new constant text := $g_new$   (SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM attributed_bank) THEN (SELECT COALESCE(sum(amount),0) FROM tw)
     ELSE COALESCE((SELECT sum(amount) FROM tw),0)
      -COALESCE((SELECT sum(net_rake) FROM attributed_bank WHERE side='out'),0)
      +COALESCE((SELECT sum(net_rake) FROM attributed_bank WHERE side='in'),0) END) AS bank_total,
$g_new$;
  h_old constant text := $h_old$  ), tour_keys AS MATERIALIZED (
$h_old$;
  h_new constant text := $h_new$  ), fa AS MATERIALIZED (
   -- START-WEEK ATTRIBUTION (20261116): the recognitions whose sources this
   -- period pays. One with no attribution row is paid where it was banked
   -- (fw, unchanged); one attributed to its start week is paid in the period
   -- holding its attributed instant. Bank checks (tw, q1, q2) stay on bank time.
   SELECT f.tournament_id,f.net_rake,f.status,f.recognized_at,f.recognized_at AS earned_at,false AS attributed FROM fw f
    WHERE NOT EXISTS(SELECT 1 FROM public.accounting_tournament_week_attributions a
     WHERE a.tournament_id=f.tournament_id AND a.recognized_at=f.recognized_at)
   UNION ALL
   SELECT f.tournament_id,f.net_rake,f.status,f.recognized_at,a.attributed_at,true
    FROM (SELECT DISTINCT a0.tournament_id,a0.recognized_at,a0.attributed_at FROM public.accounting_tournament_week_attributions a0
           WHERE a0.attributed_at>=$2 AND a0.attributed_at<$3) a
    JOIN public.accounting_tournament_fee_recognitions f
     ON f.tournament_id=a.tournament_id AND f.recognized_at=a.recognized_at AND f.union_id=$1
    WHERE f.tournament_id=ANY(ARRAY(SELECT a3.tournament_id FROM public.accounting_tournament_week_attributions a3
           WHERE a3.attributed_at>=$2 AND a3.attributed_at<$3))
  ), attributed_bank AS MATERIALIZED (
   -- START-WEEK ATTRIBUTION (20261116): this period's bank that another week
   -- pays ('out') and another period's bank that this period pays ('in').
   SELECT 'out'::text AS side,f.net_rake FROM fw f
    WHERE f.net_rake>0 AND EXISTS(SELECT 1 FROM public.accounting_tournament_week_attributions a
     WHERE a.tournament_id=f.tournament_id AND a.recognized_at=f.recognized_at)
   UNION ALL
   SELECT 'in'::text,f.net_rake FROM fa f WHERE f.net_rake>0 AND f.attributed
  ), tour_keys AS MATERIALIZED (
$h_new$;
  d text; p text; m jsonb; m2 jsonb; n int; previous text := current_setting('search_path');
  pairs text[][];
BEGIN
  PERFORM set_config('search_path', 'pg_catalog', true);
  d := pg_get_functiondef(c_sig::regprocedure);
  PERFORM set_config('search_path', previous, true);
  IF md5(d) IS DISTINCT FROM c_old_md5 THEN
    RAISE EXCEPTION 'P2_EARNED_PLAN_SETS_PREIMAGE_CHANGED: %', md5(d) USING ERRCODE = '55000';
  END IF;
  pairs := ARRAY[[a_old,a_new],[b_old,b_new],[c1_old,c1_new],[c2_old,c2_new],[d_old,d_new],
                 [e1_old,e1_new],[e2_old,e2_new],[f1_old,f1_new],[f2_old,f2_new],[g_old,g_new],[h_old,h_new]];
  p := d;
  FOR i IN 1..array_length(pairs,1) LOOP
    n := (length(p) - length(replace(p, pairs[i][1], ''))) / length(pairs[i][1]);
    IF n IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'P2_EARNED_PLAN_SETS_ANCHOR_%: found % times', i, n USING ERRCODE = '55000';
    END IF;
    p := replace(p, pairs[i][1], pairs[i][2]);
  END LOOP;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_proc WHERE oid = c_sig::regprocedure;
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_sig::regprocedure;
  PERFORM set_config('search_path', 'pg_catalog', true);
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_sig::regprocedure) <> p THEN
    RAISE EXCEPTION 'P2_EARNED_PLAN_SETS_POSTIMAGE %', md5(pg_get_functiondef(c_sig::regprocedure)) USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('search_path', previous, true);
END
$p2_sets$;


-- ===========================================================================
-- P6. START-WEEK ATTRIBUTION (20261116): the gaps P1 and P2 left.
--   P6a fn_accounting_union_earned_plan_v3 (the last fallback of the earned
--       plan) pays and conserves by attribution, exactly as P2 did for the
--       window and sets paths.
--   P6b fn_union_weekly_rakeback_close debits the rake treasury for the bank
--       the week PAYS, the same total the plan now reports as period_rake.
--   P6c fn_recognize_accounting_tournament_fees (P1's postimage) dates the
--       agent commission rows of an attributed event at its attributed instant,
--       so the commission stage's source match (rs.earned_at=ac.created_at)
--       holds, and never attributes into a start week whose close already ran.
-- Requires P1 (side table, helper, writer patch) and P2 earlier in the same
-- migration. With the side table empty every block is output-identical.
-- ===========================================================================

-- P6a. fn_accounting_union_earned_plan_v3.
DO $p6_v3$
DECLARE
  c_sig constant text := 'public.fn_accounting_union_earned_plan_v3(uuid,timestamptz,timestamptz)';
  c_old_md5 constant text := 'e42fa0ee1e5d6ce48ad27ed79ed9ed53';
  -- (A) every recognition this period PAYS has its sources here, at the
  --     instant they are paid at.
  a_old constant text := $a_old$ SELECT count(*) INTO issue_count FROM public.accounting_tournament_fee_recognitions f
  LEFT JOIN LATERAL (SELECT count(*) AS n,sum(s.rake_credit) AS total
   FROM public.accounting_payable_earning_sources s WHERE s.source_type='tournament_fee_accrual'
    AND s.tournament_id=f.tournament_id AND s.union_id=p_union_id AND s.earned_at=f.recognized_at) x ON true
  WHERE f.union_id=p_union_id AND f.recognized_at>=p_start AND f.recognized_at<p_end AND f.net_rake>0
   AND (f.status IS DISTINCT FROM 'recognized' OR x.n=0 OR x.total IS DISTINCT FROM f.net_rake);
$a_old$;
  a_new constant text := $a_new$ -- START-WEEK ATTRIBUTION (20261116): every recognition this period PAYS has
 -- its sources here, at the instant they are paid at. One with no attribution
 -- row is paid where it was banked (unchanged); one attributed to its start
 -- week is paid in the period that holds its attributed instant.
 SELECT count(*) INTO issue_count FROM (
  SELECT f.tournament_id,f.net_rake,f.status,f.recognized_at AS paid_at
   FROM public.accounting_tournament_fee_recognitions f
   WHERE f.union_id=p_union_id AND f.recognized_at>=p_start AND f.recognized_at<p_end AND f.net_rake>0
    AND NOT EXISTS(SELECT 1 FROM public.accounting_tournament_week_attributions a
     WHERE a.tournament_id=f.tournament_id AND a.recognized_at=f.recognized_at)
  UNION ALL
  SELECT f.tournament_id,f.net_rake,f.status,a.attributed_at
   FROM (SELECT DISTINCT a0.tournament_id,a0.recognized_at,a0.attributed_at
          FROM public.accounting_tournament_week_attributions a0
          WHERE a0.attributed_at>=p_start AND a0.attributed_at<p_end) a
   JOIN public.accounting_tournament_fee_recognitions f ON f.tournament_id=a.tournament_id AND f.recognized_at=a.recognized_at
   WHERE f.union_id=p_union_id AND f.net_rake>0) f
  LEFT JOIN LATERAL (SELECT count(*) AS n,sum(s.rake_credit) AS total
   FROM public.accounting_payable_earning_sources s WHERE s.source_type='tournament_fee_accrual'
    AND s.tournament_id=f.tournament_id AND s.union_id=p_union_id AND s.earned_at=f.paid_at) x ON true
  WHERE (f.status IS DISTINCT FROM 'recognized' OR x.n=0 OR x.total IS DISTINCT FROM f.net_rake);
$a_new$;
  -- (B) a tournament source matches its recognition at the instant it is paid at.
  b_old constant text := $b_old$      OR f.recognized_at IS DISTINCT FROM s.earned_at OR f.status IS DISTINCT FROM 'recognized'))
$b_old$;
  b_new constant text := $b_new$      -- START-WEEK ATTRIBUTION (20261116): paid at its attributed instant if it has one.
      OR COALESCE((SELECT a.attributed_at FROM public.accounting_tournament_week_attributions a
          WHERE a.source_id=s.source_id AND a.recognized_at=f.recognized_at),f.recognized_at) IS DISTINCT FROM s.earned_at
      OR f.status IS DISTINCT FROM 'recognized'))
$b_new$;
  -- (C) the agreement check knows each source's bank instant.
  c_old constant text := $c_old$   COALESCE((s.contract->>'is_union_house')::boolean,false) AS is_house
   FROM public.accounting_payable_earning_sources s LEFT JOIN public.accounting_tournament_fee_sources f
    ON s.source_type='tournament_fee_accrual' AND f.id=s.source_id
$c_old$;
  c_new constant text := $c_new$   COALESCE((s.contract->>'is_union_house')::boolean,false) AS is_house,
   -- START-WEEK ATTRIBUTION (20261116): the bank instant of each source.
   COALESCE(wa.recognized_at,s.earned_at) AS attribution_bank_at
   FROM public.accounting_payable_earning_sources s LEFT JOIN public.accounting_tournament_fee_sources f
    ON s.source_type='tournament_fee_accrual' AND f.id=s.source_id
   LEFT JOIN public.accounting_tournament_week_attributions wa
    ON s.source_type='tournament_fee_accrual' AND wa.source_id=s.source_id
$c_new$;
  -- (D) terms are checked against the bank instant (equal to earned_at for
  --     every source that is not attributed).
  d_old constant text := $d_old$OR s.terms_at IS NULL OR s.terms_at>s.earned_at
$d_old$;
  d_new constant text := $d_new$OR s.terms_at IS NULL OR s.terms_at>s.attribution_bank_at
$d_new$;
  -- (E) the bank this period answers for. Unchanged when nothing is attributed.
  e_old constant text := $e_old$ SELECT COALESCE(sum(amount),0) INTO bank_total FROM public.union_wallet_transactions
  WHERE union_id=p_union_id AND wallet='rake_wallet' AND direction='credit' AND tx_type='rake' AND created_at>=p_start AND created_at<p_end;
$e_old$;
  e_new constant text := $e_new$ SELECT COALESCE(sum(amount),0) INTO bank_total FROM public.union_wallet_transactions
  WHERE union_id=p_union_id AND wallet='rake_wallet' AND direction='credit' AND tx_type='rake' AND created_at>=p_start AND created_at<p_end;
 -- START-WEEK ATTRIBUTION (20261116): the bank this period answers for is its
 -- own bank, less recognitions banked here that another period pays, plus
 -- recognitions banked in another period that this one pays. The bank checks
 -- above stay on bank time; only what the period owes moves.
 IF EXISTS(SELECT 1 FROM public.accounting_tournament_week_attributions a
            WHERE (a.attributed_at>=p_start AND a.attributed_at<p_end)
               OR (a.recognized_at>=p_start AND a.recognized_at<p_end)) THEN
  bank_total:=bank_total
   -COALESCE((SELECT sum(f.net_rake) FROM public.accounting_tournament_fee_recognitions f
      WHERE f.union_id=p_union_id AND f.status='recognized' AND f.net_rake>0
        AND f.recognized_at>=p_start AND f.recognized_at<p_end
        AND EXISTS(SELECT 1 FROM public.accounting_tournament_week_attributions a
          WHERE a.tournament_id=f.tournament_id AND a.recognized_at=f.recognized_at
            AND NOT (a.attributed_at>=p_start AND a.attributed_at<p_end))),0)
   +COALESCE((SELECT sum(f.net_rake) FROM (SELECT DISTINCT a0.tournament_id,a0.recognized_at
        FROM public.accounting_tournament_week_attributions a0
        WHERE a0.attributed_at>=p_start AND a0.attributed_at<p_end
          AND NOT (a0.recognized_at>=p_start AND a0.recognized_at<p_end)) a
      JOIN public.accounting_tournament_fee_recognitions f ON f.tournament_id=a.tournament_id AND f.recognized_at=a.recognized_at
      WHERE f.union_id=p_union_id AND f.status='recognized' AND f.net_rake>0),0);
 END IF;
$e_new$;
  d text; p text; m jsonb; m2 jsonb; n int; previous text := current_setting('search_path');
  pairs text[][];
BEGIN
  PERFORM set_config('search_path', 'pg_catalog', true);
  d := pg_get_functiondef(c_sig::regprocedure);
  PERFORM set_config('search_path', previous, true);
  IF md5(d) IS DISTINCT FROM c_old_md5 THEN
    RAISE EXCEPTION 'P6_EARNED_PLAN_V3_PREIMAGE_CHANGED: %', md5(d) USING ERRCODE = '55000';
  END IF;
  pairs := ARRAY[[a_old,a_new],[b_old,b_new],[c_old,c_new],[d_old,d_new],[e_old,e_new]];
  p := d;
  FOR i IN 1..array_length(pairs,1) LOOP
    n := (length(p) - length(replace(p, pairs[i][1], ''))) / length(pairs[i][1]);
    IF n IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'P6_EARNED_PLAN_V3_ANCHOR_%: found % times', i, n USING ERRCODE = '55000';
    END IF;
    p := replace(p, pairs[i][1], pairs[i][2]);
  END LOOP;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_proc WHERE oid = c_sig::regprocedure;
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_sig::regprocedure;
  PERFORM set_config('search_path', 'pg_catalog', true);
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_sig::regprocedure) <> p THEN
    RAISE EXCEPTION 'P6_EARNED_PLAN_V3_POSTIMAGE %', md5(pg_get_functiondef(c_sig::regprocedure)) USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('search_path', previous, true);
END
$p6_v3$;

-- P6b. fn_union_weekly_rakeback_close: the week debits the bank it pays.
DO $p6_close$
DECLARE
  c_sig constant text := 'public.fn_union_weekly_rakeback_close(uuid,timestamptz,timestamptz)';
  c_old_md5 constant text := '64c4c5191e1263399cf63e63b1a7b46b';
  a_old constant text := $a_old$  SELECT round(COALESCE(SUM(amount), 0), 2) INTO v_period_total FROM _uwrb_credits;
$a_old$;
  a_new constant text := $a_new$  SELECT round(COALESCE(SUM(amount), 0), 2) INTO v_period_total FROM _uwrb_credits;
  /* START-WEEK ATTRIBUTION (20261116): a tournament belongs to the week it
     started (Dan, 2026-11-14). The week owes the rake it PAYS: the treasury's
     credits of the week, less recognitions banked in it that another week
     pays, plus recognitions banked after it that it pays. This is exactly the
     plan's period_rake, so the bank check below keeps holding, and a straddler
     is debited once, by the week it started in. Unchanged when nothing is
     attributed. */
  IF EXISTS(SELECT 1 FROM public.accounting_tournament_week_attributions a
             WHERE (a.attributed_at>=p_period_start AND a.attributed_at<p_period_end)
                OR (a.recognized_at>=p_period_start AND a.recognized_at<p_period_end)) THEN
    v_period_total := round(v_period_total
      -COALESCE((SELECT sum(f.net_rake) FROM public.accounting_tournament_fee_recognitions f
         WHERE f.union_id=p_union_id AND f.status='recognized' AND f.net_rake>0
           AND f.recognized_at>=p_period_start AND f.recognized_at<p_period_end
           AND EXISTS(SELECT 1 FROM public.accounting_tournament_week_attributions a
             WHERE a.tournament_id=f.tournament_id AND a.recognized_at=f.recognized_at
               AND NOT (a.attributed_at>=p_period_start AND a.attributed_at<p_period_end))),0)
      +COALESCE((SELECT sum(f.net_rake) FROM (SELECT DISTINCT a0.tournament_id,a0.recognized_at
           FROM public.accounting_tournament_week_attributions a0
           WHERE a0.attributed_at>=p_period_start AND a0.attributed_at<p_period_end
             AND NOT (a0.recognized_at>=p_period_start AND a0.recognized_at<p_period_end)) a
         JOIN public.accounting_tournament_fee_recognitions f ON f.tournament_id=a.tournament_id AND f.recognized_at=a.recognized_at
         WHERE f.union_id=p_union_id AND f.status='recognized' AND f.net_rake>0),0), 2);
  END IF;
$a_new$;
  d text; p text; m jsonb; m2 jsonb; n int; previous text := current_setting('search_path');
BEGIN
  PERFORM set_config('search_path', 'pg_catalog', true);
  d := pg_get_functiondef(c_sig::regprocedure);
  PERFORM set_config('search_path', previous, true);
  IF md5(d) IS DISTINCT FROM c_old_md5 THEN
    RAISE EXCEPTION 'P6_RAKEBACK_CLOSE_PREIMAGE_CHANGED: %', md5(d) USING ERRCODE = '55000';
  END IF;
  n := (length(d) - length(replace(d, a_old, ''))) / length(a_old);
  IF n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'P6_RAKEBACK_CLOSE_ANCHOR: found % times', n USING ERRCODE = '55000';
  END IF;
  p := replace(d, a_old, a_new);
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_proc WHERE oid = c_sig::regprocedure;
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_sig::regprocedure;
  PERFORM set_config('search_path', 'pg_catalog', true);
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_sig::regprocedure) <> p THEN
    RAISE EXCEPTION 'P6_RAKEBACK_CLOSE_POSTIMAGE %', md5(pg_get_functiondef(c_sig::regprocedure)) USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('search_path', previous, true);
END
$p6_close$;

-- P6c. fn_recognize_accounting_tournament_fees, on top of P1's postimage
--      (md5 ef8773c36f2ecbee353780d790c74e3e, computed from the live body
--      48005212... with P1's three replacements; it changes if P1's text does).
DO $p6_recognize$
DECLARE
  c_sig constant text := 'public.fn_recognize_accounting_tournament_fees(uuid,timestamptz,uuid,uuid,uuid)';
  c_old_md5 constant text := 'ef8773c36f2ecbee353780d790c74e3e';
  -- (A) never attribute into a start week that can no longer pay, and only a
  --     recognized (net fee > 0) event is attributed at all.
  a_old constant text := $a_old$ v_attributed:=public.fn_accounting_tournament_attributed_at(p_tournament_id,p_recognized_at);
$a_old$;
  a_new constant text := $a_new$ v_attributed:=public.fn_accounting_tournament_attributed_at(p_tournament_id,p_recognized_at);
 -- START-WEEK ATTRIBUTION (20261116), P6: the weekly close waits for every
 -- event that started in the week, so its start week is still open here. If a
 -- close for that week has nonetheless run for this scope (round 1, a routed
 -- round, a completed run, or a settled commission period), the event keeps
 -- its recognition instant: an earning is never attributed into a week that
 -- can no longer pay it, where it would be lost to both weeks.
 IF NOT (net_fee>0) THEN v_attributed:=p_recognized_at; END IF;
 IF v_attributed IS DISTINCT FROM p_recognized_at AND (
   EXISTS(SELECT 1 FROM public.union_rakeback_log l
           WHERE game_union IS NOT NULL AND l.union_id=game_union
             AND l.period_start=public.fn_union_week_start(v_attributed))
   OR EXISTS(SELECT 1 FROM public.accounting_routed_settlement_runs r
           WHERE r.period_start=public.fn_union_week_start(v_attributed)
             AND ((game_union IS NOT NULL AND r.scope_kind='union' AND r.scope_id=game_union)
               OR (game_union IS NULL AND r.scope_kind='club' AND r.scope_id IN
                    (SELECT s.club_id FROM public.accounting_tournament_fee_sources s WHERE s.id=ANY(active_ids)))))
   OR EXISTS(SELECT 1 FROM public.union_accounting_runs q
           WHERE q.period_start=public.fn_union_week_start(v_attributed) AND q.status='complete'
             AND ((game_union IS NOT NULL AND q.scope_kind='union' AND q.scope_id=game_union)
               OR (game_union IS NULL AND q.scope_kind='club' AND q.scope_id IN
                    (SELECT s.club_id FROM public.accounting_tournament_fee_sources s WHERE s.id=ANY(active_ids)))))
   OR EXISTS(SELECT 1 FROM public.accounting_tournament_fee_sources s
           JOIN public.agent_commission_settlements closed ON closed.club_id=(s.contract->>'club_id')::uuid
            AND v_attributed>=closed.period_start AND v_attributed<closed.period_end
           WHERE s.id=ANY(active_ids))) THEN
  v_attributed:=p_recognized_at;
 END IF;
$a_new$;
  -- (B) the batch path's closed-period refusal reads the week the commission
  --     belongs to.
  b_old constant text := $b_old$    AND p_recognized_at>=closed.period_start AND p_recognized_at<closed.period_end
$b_old$;
  b_new constant text := $b_new$    AND v_attributed>=closed.period_start AND v_attributed<closed.period_end
$b_new$;
  -- (C) a batch commission row is dated at the instant its source is paid at
  --     (accounting_payable_earning_sources.earned_at): the commission stage
  --     matches rs.earned_at=ac.created_at.
  c_old constant text := $c_old$   'Commission from recorded earning agreement; tier '||(tier.value->>'depth'),p_recognized_at
$c_old$;
  c_new constant text := $c_new$   'Commission from recorded earning agreement; tier '||(tier.value->>'depth'),v_attributed
$c_new$;
  -- (D) the same for a commission row posted one source at a time.
  d_old constant text := $d_old$public.fn_post_accounting_commission_source(source.id,'tournament_fee_accrual',p_recognized_at,source.contract)$d_old$;
  d_new constant text := $d_new$public.fn_post_accounting_commission_source(source.id,'tournament_fee_accrual',v_attributed,source.contract)$d_new$;
  d text; p text; m jsonb; m2 jsonb; n int; previous text := current_setting('search_path');
  pairs text[][];
BEGIN
  PERFORM set_config('search_path', 'pg_catalog', true);
  d := pg_get_functiondef(c_sig::regprocedure);
  PERFORM set_config('search_path', previous, true);
  IF md5(d) IS DISTINCT FROM c_old_md5 THEN
    RAISE EXCEPTION 'P6_RECOGNIZE_PREIMAGE_CHANGED (P1 must install first): %', md5(d) USING ERRCODE = '55000';
  END IF;
  pairs := ARRAY[[a_old,a_new],[b_old,b_new],[c_old,c_new],[d_old,d_new]];
  p := d;
  FOR i IN 1..array_length(pairs,1) LOOP
    n := (length(p) - length(replace(p, pairs[i][1], ''))) / length(pairs[i][1]);
    IF n IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'P6_RECOGNIZE_ANCHOR_%: found % times', i, n USING ERRCODE = '55000';
    END IF;
    p := replace(p, pairs[i][1], pairs[i][2]);
  END LOOP;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_proc WHERE oid = c_sig::regprocedure;
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_sig::regprocedure;
  PERFORM set_config('search_path', 'pg_catalog', true);
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_sig::regprocedure) <> p THEN
    RAISE EXCEPTION 'P6_RECOGNIZE_POSTIMAGE %', md5(pg_get_functiondef(c_sig::regprocedure)) USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('search_path', previous, true);
END
$p6_recognize$;


-- P3: start-week attribution for the club and quality readers (task #8).
-- Migration-body DO blocks only (no BEGIN/COMMIT). Requires P1's
-- public.accounting_tournament_week_attributions to exist first.
-- Functions: fn_accounting_week_clubs, fn_accounting_tournament_week_quality,
-- fn_club_weekly_accounting_summary, fn_union_rake_basis_refresh,
-- fn_union_rake_basis_windowed. None of the five old md5s is pinned by any
-- installed function, so no pin moves here.

-- public.fn_accounting_week_clubs(uuid,uuid,timestamptz,timestamptz)
DO $p3_week_clubs$
DECLARE
  c_sig constant text := 'public.fn_accounting_week_clubs(uuid,uuid,timestamptz,timestamptz)';
  c_md5 constant text := 'e5ec460a159bfb46735d99be1a0738a3';
  a1_old constant text := $o1$rs.recognized_at>=p_from AND rs.recognized_at<p_to
$o1$;
  a1_new constant text := $n1$rs.recognized_at>=p_from AND rs.recognized_at<p_to
   -- START-WEEK ATTRIBUTION (20261116): a tournament source that finished in a later week
   -- than it started is that start week's, through its attribution row only.
   AND NOT EXISTS(SELECT 1 FROM public.accounting_tournament_week_attributions wa WHERE wa.source_id=rs.source_id)
$n1$;
  a2_old constant text := $o2$r.recognized_at>=p_from AND r.recognized_at<p_to LIMIT 1 OFFSET 0)
), initial AS ($o2$;
  a2_new constant text := $n2$r.recognized_at>=p_from AND r.recognized_at<p_to LIMIT 1 OFFSET 0)
  -- START-WEEK ATTRIBUTION (20261116): the same per-row tests for a source attributed to
  -- this week (it started here and its fee was recognized in a later week).
  OR EXISTS(SELECT 1 FROM public.accounting_tournament_week_attributions wa
   JOIN public.accounting_tournament_fee_sources s ON s.id=wa.source_id AND s.tournament_id=wa.tournament_id
   JOIN public.accounting_tournament_recognized_sources rs ON rs.source_id=s.id AND rs.tournament_id=s.tournament_id
   JOIN public.accounting_tournament_fee_recognitions r ON r.tournament_id=s.tournament_id
  WHERE wa.attributed_at>=p_from AND wa.attributed_at<p_to
   AND s.coordinator_union_id=p_union_id AND s.club_id=t.club_id
   AND CASE WHEN b.cutoff IS NULL THEN true ELSE s.charged_at IS NOT NULL AND isfinite(s.charged_at) AND s.charged_at>=b.cutoff END
   AND CASE WHEN b.cutoff IS NULL THEN true ELSE rs.recognized_at IS NOT NULL AND isfinite(rs.recognized_at) AND rs.recognized_at>=b.cutoff END
   AND rs.disposition='earned' AND r.status='recognized'
   AND rs.rake_credit=s.rake_credit AND rs.recognized_at=r.recognized_at
   AND NOT s.union_id IS DISTINCT FROM r.union_id LIMIT 1 OFFSET 0)
), initial AS ($n2$;
  d text; p text; m jsonb; m2 jsonb; prev text := current_setting('search_path');
BEGIN
  PERFORM set_config('search_path','pg_catalog',true);
  d := pg_get_functiondef(c_sig::regprocedure);
  PERFORM set_config('search_path',prev,true);
  IF md5(d) IS DISTINCT FROM c_md5 THEN
    RAISE EXCEPTION 'START_WEEK_P3_PREIMAGE_CHANGED: % is %', c_sig, md5(d) USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a1_old,'')))/length(a1_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P3_ANCHOR: % anchor 1 is not unique', c_sig USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a2_old,'')))/length(a2_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P3_ANCHOR: % anchor 2 is not unique', c_sig USING ERRCODE='55000';
  END IF;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_catalog.pg_proc WHERE oid = c_sig::regprocedure;
  p := replace(replace(d,a1_old,a1_new),a2_old,a2_new);
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_catalog.pg_proc WHERE oid = c_sig::regprocedure;
  PERFORM set_config('search_path','pg_catalog',true);
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_sig::regprocedure) <> p THEN
    RAISE EXCEPTION 'START_WEEK_P3_POSTIMAGE: % is %', c_sig, md5(pg_get_functiondef(c_sig::regprocedure)) USING ERRCODE='55000';
  END IF;
  PERFORM set_config('search_path',prev,true);
END
$p3_week_clubs$;

-- public.fn_accounting_tournament_week_quality(uuid,timestamptz,timestamptz)
DO $p3_quality$
DECLARE
  c_sig constant text := 'public.fn_accounting_tournament_week_quality(uuid,timestamptz,timestamptz)';
  c_md5 constant text := 'c9e08ef6460bc1b9d27af7339f3c42cc';
  a1_old constant text := $o1$   UNION SELECT tournament_id FROM public.tournament_satellite_settlements WHERE settled_at>=p_from AND settled_at<p_to
  ), candidates AS (
$o1$;
  a1_new constant text := $n1$   UNION SELECT tournament_id FROM public.tournament_satellite_settlements WHERE settled_at>=p_from AND settled_at<p_to
   -- START-WEEK ATTRIBUTION (20261116): an event that started in this week and finished in a
   -- later one is this week's; it is found by its attribution, not its bank time.
   UNION SELECT tournament_id FROM public.accounting_tournament_week_attributions WHERE attributed_at>=p_from AND attributed_at<p_to
  ), candidates AS (
$n1$;
  a2_old constant text := $o2$  ), ev AS (
$o2$;
  a2_new constant text := $n2$  ), week_attributed AS MATERIALIZED (
   -- START-WEEK ATTRIBUTION (20261116): the start-week attribution of every candidate that has
   -- one (only events that finished in a later week than they started do).
   SELECT wa.tournament_id,min(wa.attributed_at) AS attributed_at
    FROM public.accounting_tournament_week_attributions wa
    WHERE wa.tournament_id IN (SELECT c.tournament_id FROM candidates c)
    GROUP BY wa.tournament_id
  ), ev AS (
$n2$;
  a3_old constant text := $o3$      WHERE s.tournament_id=e.tournament_id GROUP BY s.tournament_id OFFSET 0
    ) f ON true
$o3$;
  a3_new constant text := $n3$      WHERE s.tournament_id=e.tournament_id GROUP BY s.tournament_id OFFSET 0
    ) f ON true
    LEFT JOIN week_attributed wa ON wa.tournament_id=e.tournament_id
$n3$;
  a4_old constant text := $o4$    WHERE COALESCE(e.bank_at,e.recognized_at) IS NULL
       OR (COALESCE(e.bank_at,e.recognized_at)>=p_from AND COALESCE(e.bank_at,e.recognized_at)<p_to)
       OR (e.recognized_at IS NOT NULL AND e.recognized_at>=p_from AND e.recognized_at<p_to)
$o4$;
  a4_new constant text := $n4$    -- START-WEEK ATTRIBUTION (20261116): an attributed event is this week's exactly when its
    -- attribution is; its bank and recognition facts are still checked below.
    WHERE (wa.tournament_id IS NULL AND (COALESCE(e.bank_at,e.recognized_at) IS NULL
       OR (COALESCE(e.bank_at,e.recognized_at)>=p_from AND COALESCE(e.bank_at,e.recognized_at)<p_to)
       OR (e.recognized_at IS NOT NULL AND e.recognized_at>=p_from AND e.recognized_at<p_to)))
       OR (wa.attributed_at>=p_from AND wa.attributed_at<p_to)
$n4$;
  d text; p text; m jsonb; m2 jsonb; prev text := current_setting('search_path');
BEGIN
  PERFORM set_config('search_path','pg_catalog',true);
  d := pg_get_functiondef(c_sig::regprocedure);
  PERFORM set_config('search_path',prev,true);
  IF md5(d) IS DISTINCT FROM c_md5 THEN
    RAISE EXCEPTION 'START_WEEK_P3_PREIMAGE_CHANGED: % is %', c_sig, md5(d) USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a1_old,'')))/length(a1_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P3_ANCHOR: % anchor 1 is not unique', c_sig USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a2_old,'')))/length(a2_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P3_ANCHOR: % anchor 2 is not unique', c_sig USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a3_old,'')))/length(a3_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P3_ANCHOR: % anchor 3 is not unique', c_sig USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a4_old,'')))/length(a4_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P3_ANCHOR: % anchor 4 is not unique', c_sig USING ERRCODE='55000';
  END IF;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_catalog.pg_proc WHERE oid = c_sig::regprocedure;
  p := replace(replace(replace(replace(d,a1_old,a1_new),a2_old,a2_new),a3_old,a3_new),a4_old,a4_new);
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_catalog.pg_proc WHERE oid = c_sig::regprocedure;
  PERFORM set_config('search_path','pg_catalog',true);
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_sig::regprocedure) <> p THEN
    RAISE EXCEPTION 'START_WEEK_P3_POSTIMAGE: % is %', c_sig, md5(pg_get_functiondef(c_sig::regprocedure)) USING ERRCODE='55000';
  END IF;
  PERFORM set_config('search_path',prev,true);
END
$p3_quality$;

-- public.fn_club_weekly_accounting_summary(uuid)
DO $p3_summary$
DECLARE
  c_sig constant text := 'public.fn_club_weekly_accounting_summary(uuid)';
  c_md5 constant text := '0b5f87114dd95cb3f2b9802f20a564ec';
  a1_old constant text := $o1$private_burned numeric:=0;
 expected numeric:=0;$o1$;
  a1_new constant text := $n1$private_burned numeric:=0;private_bank_basis numeric:=0;
 expected numeric:=0;$n1$;
  a2_old constant text := $o2$ source_issues:=source_issues+bad_sources;
 IF NOT EXISTS(SELECT 1 FROM public.accounting_cash_accrual_cutover WHERE singleton AND starts_at<=period.start_at) THEN source_issues:=source_issues+1;END IF;
$o2$;
  a2_new constant text := $n2$ source_issues:=source_issues+bad_sources;
 IF NOT EXISTS(SELECT 1 FROM public.accounting_cash_accrual_cutover WHERE singleton AND starts_at<=period.start_at) THEN source_issues:=source_issues+1;END IF;
 -- START-WEEK ATTRIBUTION (20261116): private_basis is the week's private earnings by the
 -- week each tournament started in. The retirement and standalone bank proofs
 -- below are bank facts, on bank time, so they are compared with the same
 -- earnings on bank time: plus a private source banked in this week but
 -- attributed to an earlier one, minus one attributed here but banked later.
 SELECT private_basis+COALESCE(sum(CASE WHEN wa.attributed_at<period.start_at THEN s.rake_credit ELSE -s.rake_credit END),0)
   INTO private_bank_basis
   FROM public.accounting_tournament_week_attributions wa
   JOIN public.accounting_effective_tournament_fee_sources s ON s.id=wa.source_id AND s.tournament_id=wa.tournament_id
   JOIN public.accounting_tournament_recognized_sources rs ON rs.source_id=s.id AND rs.tournament_id=s.tournament_id
   JOIN public.accounting_tournament_fee_recognitions r ON r.tournament_id=s.tournament_id
   LEFT JOIN public.fn_ca_launch_accounting_club_cutoffs() bd(club_id,cutoff_at) ON bd.club_id=s.club_id
  WHERE s.club_id=period.club_id AND s.union_id IS NULL
    AND ((period.union_id IS NULL AND s.coordinator_union_id IS NULL)
      OR (period.union_id IS NOT NULL AND s.coordinator_union_id=period.union_id))
    AND ((wa.recognized_at>=period.start_at AND wa.recognized_at<period.end_at AND wa.attributed_at<period.start_at)
      OR (wa.attributed_at>=period.start_at AND wa.attributed_at<period.end_at AND wa.recognized_at>=period.end_at))
    AND (bd.cutoff_at IS NULL OR s.charged_at IS NOT NULL AND isfinite(s.charged_at) AND s.charged_at>=bd.cutoff_at)
    AND (bd.cutoff_at IS NULL OR rs.recognized_at IS NOT NULL AND isfinite(rs.recognized_at) AND rs.recognized_at>=bd.cutoff_at)
    AND rs.disposition='earned' AND r.status='recognized' AND rs.rake_credit=s.rake_credit
    AND rs.recognized_at=r.recognized_at AND NOT s.union_id IS DISTINCT FROM r.union_id;
$n2$;
  a3_old constant text := $o3$   -- Payable tournament earnings use their original recognition timestamp.
$o3$;
  a3_new constant text := $n3$   -- A tournament deposit is a bank fact: it is read on its recognition (bank)
   -- time. Which week its earnings belong to is the source's own earned_at,
   -- the week the tournament started in (START-WEEK ATTRIBUTION (20261116)).
$n3$;
  a4_old constant text := $o4$     AND s.earned_at>=period.start_at AND s.earned_at<period.end_at
    OFFSET 0))
$o4$;
  a4_new constant text := $n4$     AND COALESCE((SELECT wa.recognized_at FROM public.accounting_tournament_week_attributions wa WHERE wa.source_id=s.source_id),s.earned_at)>=period.start_at
     AND COALESCE((SELECT wa.recognized_at FROM public.accounting_tournament_week_attributions wa WHERE wa.source_id=s.source_id),s.earned_at)<period.end_at
    OFFSET 0))
$n4$;
  a5_old constant text := $o5$    OR s.coordinator_union_id IS DISTINCT FROM period.union_id OR s.earned_at IS DISTINCT FROM k.banked_at) AS bad,
   bool_or(s.club_id=period.club_id AND s.coordinator_union_id IS NOT DISTINCT FROM period.union_id) AS mine
  FROM (SELECT source_group,banked_at FROM deposit_source_keys
$o5$;
  a5_new constant text := $n5$    OR s.coordinator_union_id IS DISTINCT FROM period.union_id OR s.earned_at IS DISTINCT FROM s.member_at) AS bad,
   bool_or(s.club_id=period.club_id AND s.coordinator_union_id IS NOT DISTINCT FROM period.union_id) AS mine
  FROM (SELECT source_group,banked_at FROM deposit_source_keys
$n5$;
  a6_old constant text := $o6$    SELECT e.rake_credit,e.club_id,e.union_id,e.coordinator_union_id,e.earned_at
    FROM public.accounting_payable_earning_sources e
    WHERE e.tournament_id=k.source_group AND e.source_type='tournament_fee_accrual'
$o6$;
  a6_new constant text := $n6$    SELECT e.rake_credit,e.club_id,e.union_id,e.coordinator_union_id,e.earned_at,
     -- START-WEEK ATTRIBUTION (20261116): a source is earned at its deposit's bank time
     -- unless it is attributed to the week its tournament started in.
     COALESCE(wa.attributed_at,k.banked_at) AS member_at
    FROM public.accounting_payable_earning_sources e
    LEFT JOIN public.accounting_tournament_week_attributions wa ON wa.source_id=e.source_id
    WHERE e.tournament_id=k.source_group AND e.source_type='tournament_fee_accrual'
$n6$;
  a7_old constant text := $o7$ IF private_banked+private_burned IS DISTINCT FROM private_basis THEN$o7$;
  a7_new constant text := $n7$ IF private_banked+private_burned IS DISTINCT FROM private_bank_basis THEN$n7$;
  a8_old constant text := $o8$  IF standalone_expected IS DISTINCT FROM private_basis THEN$o8$;
  a8_new constant text := $n8$  IF standalone_expected IS DISTINCT FROM private_bank_basis THEN$n8$;
  a9_old constant text := $o9$   IF private_basis>0 AND standalone_expected IS NOT DISTINCT FROM private_basis AND standalone_registers=1$o9$;
  a9_new constant text := $n9$   IF private_bank_basis>0 AND standalone_expected IS NOT DISTINCT FROM private_bank_basis AND standalone_registers=1$n9$;
  a10_old constant text := $o10$  ELSIF private_basis<>0 OR standalone_legs<>0$o10$;
  a10_new constant text := $n10$  ELSIF private_bank_basis<>0 OR standalone_legs<>0$n10$;
  d text; p text; m jsonb; m2 jsonb; prev text := current_setting('search_path');
BEGIN
  PERFORM set_config('search_path','pg_catalog',true);
  d := pg_get_functiondef(c_sig::regprocedure);
  PERFORM set_config('search_path',prev,true);
  IF md5(d) IS DISTINCT FROM c_md5 THEN
    RAISE EXCEPTION 'START_WEEK_P3_PREIMAGE_CHANGED: % is %', c_sig, md5(d) USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a1_old,'')))/length(a1_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P3_ANCHOR: % anchor 1 is not unique', c_sig USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a2_old,'')))/length(a2_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P3_ANCHOR: % anchor 2 is not unique', c_sig USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a3_old,'')))/length(a3_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P3_ANCHOR: % anchor 3 is not unique', c_sig USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a4_old,'')))/length(a4_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P3_ANCHOR: % anchor 4 is not unique', c_sig USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a5_old,'')))/length(a5_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P3_ANCHOR: % anchor 5 is not unique', c_sig USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a6_old,'')))/length(a6_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P3_ANCHOR: % anchor 6 is not unique', c_sig USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a7_old,'')))/length(a7_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P3_ANCHOR: % anchor 7 is not unique', c_sig USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a8_old,'')))/length(a8_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P3_ANCHOR: % anchor 8 is not unique', c_sig USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a9_old,'')))/length(a9_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P3_ANCHOR: % anchor 9 is not unique', c_sig USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a10_old,'')))/length(a10_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P3_ANCHOR: % anchor 10 is not unique', c_sig USING ERRCODE='55000';
  END IF;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_catalog.pg_proc WHERE oid = c_sig::regprocedure;
  p := replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(d,a1_old,a1_new),a2_old,a2_new),a3_old,a3_new),a4_old,a4_new),a5_old,a5_new),a6_old,a6_new),a7_old,a7_new),a8_old,a8_new),a9_old,a9_new),a10_old,a10_new);
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_catalog.pg_proc WHERE oid = c_sig::regprocedure;
  PERFORM set_config('search_path','pg_catalog',true);
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_sig::regprocedure) <> p THEN
    RAISE EXCEPTION 'START_WEEK_P3_POSTIMAGE: % is %', c_sig, md5(pg_get_functiondef(c_sig::regprocedure)) USING ERRCODE='55000';
  END IF;
  PERFORM set_config('search_path',prev,true);
END
$p3_summary$;

-- public.fn_union_rake_basis_refresh(uuid,timestamptz,timestamptz)
DO $p3_refresh$
DECLARE
  c_sig constant text := 'public.fn_union_rake_basis_refresh(uuid,timestamptz,timestamptz)';
  c_md5 constant text := '9fdc0af3d23759ab843ce122ecaefb03';
  a1_old constant text := $o1$    'agreements', (SELECT jsonb_build_array(count(*), max(h.id)) FROM public.accounting_agreement_history h));
$o1$;
  a1_new constant text := $n1$    'agreements', (SELECT jsonb_build_array(count(*), max(h.id)) FROM public.accounting_agreement_history h))
    -- START-WEEK ATTRIBUTION (20261116): a tournament attributed to this week lands in it
    -- when its fee is recognized, after the week; a new attribution restamps.
    -- Absent while there is none, so every earlier stamp is unchanged.
    || COALESCE((SELECT jsonb_build_object('attributed', jsonb_build_array(count(*), max(a.created_at)))
                  FROM public.accounting_tournament_week_attributions a
                 WHERE a.attributed_at >= p_start AND a.attributed_at < v_through
                HAVING count(*) > 0), '{}'::jsonb);
$n1$;
  d text; p text; m jsonb; m2 jsonb; prev text := current_setting('search_path');
BEGIN
  PERFORM set_config('search_path','pg_catalog',true);
  d := pg_get_functiondef(c_sig::regprocedure);
  PERFORM set_config('search_path',prev,true);
  IF md5(d) IS DISTINCT FROM c_md5 THEN
    RAISE EXCEPTION 'START_WEEK_P3_PREIMAGE_CHANGED: % is %', c_sig, md5(d) USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a1_old,'')))/length(a1_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P3_ANCHOR: % anchor 1 is not unique', c_sig USING ERRCODE='55000';
  END IF;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_catalog.pg_proc WHERE oid = c_sig::regprocedure;
  p := replace(d,a1_old,a1_new);
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_catalog.pg_proc WHERE oid = c_sig::regprocedure;
  PERFORM set_config('search_path','pg_catalog',true);
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_sig::regprocedure) <> p THEN
    RAISE EXCEPTION 'START_WEEK_P3_POSTIMAGE: % is %', c_sig, md5(pg_get_functiondef(c_sig::regprocedure)) USING ERRCODE='55000';
  END IF;
  PERFORM set_config('search_path',prev,true);
END
$p3_refresh$;

-- public.fn_union_rake_basis_windowed(uuid,timestamptz,timestamptz)
DO $p3_windowed$
DECLARE
  c_sig constant text := 'public.fn_union_rake_basis_windowed(uuid,timestamptz,timestamptz)';
  c_md5 constant text := '4d70fdc60dd94d338d4437443716844f';
  a1_old constant text := $o1$ v_sref text; digest text; bank numeric; src numeric; detail jsonb; platform_digest text; current_stamp boolean;
$o1$;
  a1_new constant text := $n1$ v_sref text; digest text; bank numeric; src numeric; detail jsonb; platform_digest text; current_stamp boolean;
 attr_in numeric:=0; attr_out numeric:=0;
$n1$;
  a2_old constant text := $o2$  WHERE b.earned_at>=p_start AND b.earned_at<p_through GROUP BY 1)
 SELECT jsonb_object_agg($o2$;
  a2_new constant text := $n2$  WHERE b.earned_at>=p_start AND b.earned_at<p_through GROUP BY 1),
 -- START-WEEK ATTRIBUTION (20261116): a window restamps when a tournament is attributed to it
 -- (its fee is recognized after the window closed). Absent while there is none.
 attr AS (SELECT date_bin('2 hours',a.attributed_at,p_start) AS ws,count(*) AS n FROM public.accounting_tournament_week_attributions a
  WHERE a.attributed_at>=p_start AND a.attributed_at<p_through GROUP BY 1)
 SELECT jsonb_object_agg($n2$;
  a3_old constant text := $o3$   'clubs',digest))
  INTO stamps
$o3$;
  a3_new constant text := $n3$   'clubs',digest)||CASE WHEN COALESCE(attr.n,0)>0 THEN jsonb_build_object('attributed',attr.n) ELSE '{}'::jsonb END)
  INTO stamps
$n3$;
  a4_old constant text := $o4$LEFT JOIN bat ON bat.ws=win.window_start;
$o4$;
  a4_new constant text := $n4$LEFT JOIN bat ON bat.ws=win.window_start
   LEFT JOIN attr ON attr.ws=win.window_start;
$n4$;
  a5_old constant text := $o5$ IF src IS DISTINCT FROM bank THEN RETURN NULL; END IF;
$o5$;
  a5_new constant text := $n5$ -- START-WEEK ATTRIBUTION (20261116): the windows carry earnings by the week each
 -- tournament started in and the bank on bank time. They can differ only by
 -- a tournament attributed into this range but banked after it, or banked in
 -- it but attributed before it; the bank moved by exactly those fees is
 -- accepted, and nothing else is.
 IF src IS DISTINCT FROM bank THEN
  SELECT COALESCE(sum(f.net_rake) FILTER(WHERE x.attributed_at>=p_start AND x.attributed_at<p_through AND f.recognized_at>=p_through),0),
         COALESCE(sum(f.net_rake) FILTER(WHERE f.recognized_at>=p_start AND f.recognized_at<p_through AND x.attributed_at<p_start),0)
    INTO attr_in,attr_out
    FROM (SELECT a.tournament_id,min(a.attributed_at) AS attributed_at FROM public.accounting_tournament_week_attributions a
           WHERE (a.attributed_at>=p_start AND a.attributed_at<p_through) OR (a.recognized_at>=p_start AND a.recognized_at<p_through)
           GROUP BY a.tournament_id) x
    JOIN public.accounting_tournament_fee_recognitions f ON f.tournament_id=x.tournament_id
   WHERE f.union_id=p_union_id AND f.status='recognized' AND f.net_rake>0;
  IF src IS DISTINCT FROM bank+attr_in-attr_out THEN RETURN NULL; END IF;
 END IF;
$n5$;
  d text; p text; m jsonb; m2 jsonb; prev text := current_setting('search_path');
BEGIN
  PERFORM set_config('search_path','pg_catalog',true);
  d := pg_get_functiondef(c_sig::regprocedure);
  PERFORM set_config('search_path',prev,true);
  IF md5(d) IS DISTINCT FROM c_md5 THEN
    RAISE EXCEPTION 'START_WEEK_P3_PREIMAGE_CHANGED: % is %', c_sig, md5(d) USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a1_old,'')))/length(a1_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P3_ANCHOR: % anchor 1 is not unique', c_sig USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a2_old,'')))/length(a2_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P3_ANCHOR: % anchor 2 is not unique', c_sig USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a3_old,'')))/length(a3_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P3_ANCHOR: % anchor 3 is not unique', c_sig USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a4_old,'')))/length(a4_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P3_ANCHOR: % anchor 4 is not unique', c_sig USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a5_old,'')))/length(a5_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P3_ANCHOR: % anchor 5 is not unique', c_sig USING ERRCODE='55000';
  END IF;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_catalog.pg_proc WHERE oid = c_sig::regprocedure;
  p := replace(replace(replace(replace(replace(d,a1_old,a1_new),a2_old,a2_new),a3_old,a3_new),a4_old,a4_new),a5_old,a5_new);
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_catalog.pg_proc WHERE oid = c_sig::regprocedure;
  PERFORM set_config('search_path','pg_catalog',true);
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_sig::regprocedure) <> p THEN
    RAISE EXCEPTION 'START_WEEK_P3_POSTIMAGE: % is %', c_sig, md5(pg_get_functiondef(c_sig::regprocedure)) USING ERRCODE='55000';
  END IF;
  PERFORM set_config('search_path',prev,true);
END
$p3_windowed$;


-- ===========================================================================
-- P4: START-WEEK ATTRIBUTION (20261116) - the scope processor's standalone
-- discovery reads the attributed instant, and every weekly book waits until
-- each event that started in its week has finished and its fee is recognized.
-- Migration-body DO blocks only (the parent wraps them in BEGIN/COMMIT).
-- Requires P1 (public.accounting_tournament_week_attributions) to be installed
-- earlier in the same transaction or before.
-- ===========================================================================

-- P4.0 Preimages, and the transition assumption the gate's lower bound rests on.
DO $p4_pre$
DECLARE previous text := current_setting('search_path');
BEGIN
  PERFORM set_config('search_path', 'pg_catalog', true);
  IF md5(pg_get_functiondef('public.fn_process_weekly_accounting_scope(uuid,uuid)'::regprocedure)) <> '4179282ab83f30094d4c3b2885102917'
     OR md5(pg_get_functiondef('smarter_private.weekly_payout_eligible_scopes(timestamptz,timestamptz)'::regprocedure)) <> 'f1a135b2555d4dfee67836d0b43af390'
     OR md5(pg_get_functiondef('public.fn_prepare_accounting_week(uuid,uuid,timestamptz,timestamptz)'::regprocedure)) <> '39a7e057da9a65dab5d0b2f761428f13'
     OR md5(pg_get_functiondef('smarter_private.weekly_prep_shard(integer,integer)'::regprocedure)) <> 'bb29caec19261452661e3c6c4ec3bbba'
     OR md5(pg_get_functiondef('public.fn_accounting_close_windows_advance_due()'::regprocedure)) <> '701d0c2c2bed0549ad3789e4a8923aa6'
     OR md5(pg_get_functiondef('public.fn_accounting_preparation_calculating(jsonb)'::regprocedure)) <> 'f4aa91b57724614f78a206eb66de7334' THEN
    RAISE EXCEPTION 'START_WEEK_P4_PREIMAGE_CHANGED: a function this part patches was edited since it was qualified' USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('search_path', previous, true);
  IF to_regclass('public.accounting_tournament_week_attributions') IS NULL THEN
    RAISE EXCEPTION 'START_WEEK_P4_REQUIRES_P1: public.accounting_tournament_week_attributions does not exist' USING ERRCODE = '55000';
  END IF;
  -- The transition week (2026-11-16 to 2026-11-23) waits on events started from
  -- 2026-11-09 08:00Z. That is complete only while no event started before it is
  -- still unfinished or unrecognized (measured read-only 2026-11-14 19:05Z: none).
  IF EXISTS (
    SELECT 1 FROM public.tournaments t
     WHERE t.started_at < '2026-11-09 08:00:00+00'::timestamptz
       AND NOT EXISTS (SELECT 1 FROM public.accounting_tournament_fee_recognitions r WHERE r.tournament_id = t.id)
       AND (upper(COALESCE(t.status::text, '')) NOT IN ('COMPLETED', 'CANCELLED')
            OR EXISTS (SELECT 1 FROM public.accounting_tournament_fee_sources s WHERE s.tournament_id = t.id))) THEN
    RAISE EXCEPTION 'START_WEEK_P4_TRANSITION_ASSUMPTION_BROKEN: an event started before 2026-11-09 08:00Z is still unfinished or unrecognized' USING ERRCODE = '55000';
  END IF;
END
$p4_pre$;

-- P4.1 The gate.
CREATE FUNCTION smarter_private.week_tournaments_pending(p_kind text, p_scope uuid, p_from timestamptz, p_to timestamptz)
 RETURNS TABLE(tournament_id uuid, name text, started_at timestamptz, status text, reason text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
-- START-WEEK ATTRIBUTION (20261116): an event (MTT, spin, sit & go,
-- satellite) belongs to the week it started in (owner, 2026-11-14). The
-- events this scope's week [p_from, p_to) is still waiting on: started in it,
-- and either not finished or finished with fees but no recognition yet. A week
-- ending on or before 2026-11-16 08:00Z keeps the old rule and waits on nothing.
-- The transition week also waits on events started from 2026-11-09 08:00Z,
-- because an event started before 2026-11-16 that finishes later belongs to it.
DECLARE lb timestamptz;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('union', 'club') OR p_scope IS NULL OR p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'week_tournaments_scope_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_to <= '2026-11-16 08:00:00+00'::timestamptz THEN RETURN; END IF;
  lb := CASE WHEN p_from <= '2026-11-16 08:00:00+00'::timestamptz
             THEN '2026-11-09 08:00:00+00'::timestamptz ELSE p_from END;
  IF p_kind = 'union' THEN
    RETURN QUERY
    SELECT t.id, t.name::text, t.started_at, t.status::text,
           CASE WHEN upper(COALESCE(t.status::text, '')) NOT IN ('COMPLETED', 'CANCELLED')
                THEN 'not_finished' ELSE 'fee_not_recognized' END
      FROM public.tournaments t
     WHERE t.union_id = p_scope AND t.started_at < p_to AND t.started_at >= lb
       AND NOT EXISTS (SELECT 1 FROM public.accounting_tournament_fee_recognitions r WHERE r.tournament_id = t.id)
       AND (upper(COALESCE(t.status::text, '')) NOT IN ('COMPLETED', 'CANCELLED')
            OR EXISTS (SELECT 1 FROM public.accounting_tournament_fee_sources s WHERE s.tournament_id = t.id))
     ORDER BY t.started_at, t.id;
  ELSE
    RETURN QUERY
    SELECT t.id, t.name::text, t.started_at, t.status::text,
           CASE WHEN upper(COALESCE(t.status::text, '')) NOT IN ('COMPLETED', 'CANCELLED')
                THEN 'not_finished' ELSE 'fee_not_recognized' END
      FROM public.tournaments t
     WHERE t.union_id IS NULL AND t.club_id = p_scope AND t.started_at < p_to AND t.started_at >= lb
       AND NOT EXISTS (SELECT 1 FROM public.accounting_tournament_fee_recognitions r WHERE r.tournament_id = t.id)
       AND (upper(COALESCE(t.status::text, '')) NOT IN ('COMPLETED', 'CANCELLED')
            OR EXISTS (SELECT 1 FROM public.accounting_tournament_fee_sources s WHERE s.tournament_id = t.id))
     ORDER BY t.started_at, t.id;
  END IF;
END
$function$;

CREATE FUNCTION smarter_private.week_tournaments_settled(p_kind text, p_scope uuid, p_from timestamptz, p_to timestamptz)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 -- START-WEEK ATTRIBUTION (20261116): true once nothing in
 -- week_tournaments_pending is left for this scope's week.
 SELECT NOT EXISTS (SELECT 1 FROM smarter_private.week_tournaments_pending(p_kind, p_scope, p_from, p_to))
$function$;

REVOKE ALL ON FUNCTION smarter_private.week_tournaments_pending(text, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION smarter_private.week_tournaments_settled(text, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- P4.2 The scope processor's standalone discovery reads the attributed instant.
DO $p4_scope$
DECLARE
  c_sig constant text := 'public.fn_process_weekly_accounting_scope(uuid,uuid)';
  c_join_old constant text := $o$              JOIN public.accounting_tournament_fee_recognitions r ON r.tournament_id=s.tournament_id
              LEFT JOIN public.fn_ca_launch_accounting_club_cutoffs() bd(club_id,cutoff_at) ON bd.club_id=s.club_id
$o$;
  c_join_new constant text := $n$              JOIN public.accounting_tournament_fee_recognitions r ON r.tournament_id=s.tournament_id
              LEFT JOIN public.fn_ca_launch_accounting_club_cutoffs() bd(club_id,cutoff_at) ON bd.club_id=s.club_id
              -- START-WEEK ATTRIBUTION (20261116): a straddler earns at the last instant of its start week.
              LEFT JOIN public.accounting_tournament_week_attributions wa ON wa.source_id=s.id
$n$;
  c_clamp_old constant text := $o$                AND NOT s.union_id IS DISTINCT FROM r.union_id AND rs.recognized_at<v_to AND rs.recognized_at<tf.floor)
$o$;
  c_clamp_new constant text := $n$                AND NOT s.union_id IS DISTINCT FROM r.union_id AND COALESCE(wa.attributed_at,rs.recognized_at)<v_to AND COALESCE(wa.attributed_at,rs.recognized_at)<tf.floor)
$n$;
  c_min_old constant text := $o$            SELECT tm.earned_at FROM (SELECT min(rs.recognized_at) AS m,min(rs.recognized_at) FILTER(WHERE isfinite(rs.recognized_at)) AS mf
$o$;
  c_min_new constant text := $n$            SELECT tm.earned_at FROM (SELECT min(COALESCE(wa.attributed_at,rs.recognized_at)) AS m,min(COALESCE(wa.attributed_at,rs.recognized_at)) FILTER(WHERE isfinite(COALESCE(wa.attributed_at,rs.recognized_at))) AS mf
$n$;
  c_ta_old constant text := $o$                AND NOT s.union_id IS DISTINCT FROM r.union_id AND rs.recognized_at<v_to) ta
$o$;
  c_ta_new constant text := $n$                AND NOT s.union_id IS DISTINCT FROM r.union_id AND COALESCE(wa.attributed_at,rs.recognized_at)<v_to) ta
$n$;
  c_tc_old constant text := $o$ r.status AS recognition_status,r.recognized_at AS recognition_at,r.union_id AS recognition_union_id
 FROM public.accounting_tournament_fee_sources s
 JOIN public.accounting_tournament_recognized_sources rs ON rs.source_id=s.id AND rs.tournament_id=s.tournament_id
 JOIN public.accounting_tournament_fee_recognitions r ON r.tournament_id=s.tournament_id
 WHERE s.coordinator_union_id IS NULL AND rs.recognized_at<v_to AND (p_club_id IS NULL OR s.club_id=p_club_id)
$o$;
  c_tc_new constant text := $n$ r.status AS recognition_status,r.recognized_at AS recognition_at,r.union_id AS recognition_union_id,
 COALESCE(wa.attributed_at,rs.recognized_at) AS earned_instant
 FROM public.accounting_tournament_fee_sources s
 JOIN public.accounting_tournament_recognized_sources rs ON rs.source_id=s.id AND rs.tournament_id=s.tournament_id
 JOIN public.accounting_tournament_fee_recognitions r ON r.tournament_id=s.tournament_id
 -- START-WEEK ATTRIBUTION (20261116): a straddler earns at the last instant of its start week.
 LEFT JOIN public.accounting_tournament_week_attributions wa ON wa.source_id=s.id
 WHERE s.coordinator_union_id IS NULL AND COALESCE(wa.attributed_at,rs.recognized_at)<v_to AND (p_club_id IS NULL OR s.club_id=p_club_id)
$n$;
  c_acc_old constant text := $o$ SELECT s.club_id,s.recognized_at AS earned_at FROM tournament_candidates s
$o$;
  c_acc_new constant text := $n$ SELECT s.club_id,s.earned_instant AS earned_at FROM tournament_candidates s
$n$;
  d text; p text; m jsonb; m2 jsonb;
BEGIN
  d := pg_get_functiondef(c_sig::regprocedure);
  IF (length(d) - length(replace(d, c_join_old, ''))) / length(c_join_old) <> 2
     OR (length(d) - length(replace(d, c_clamp_old, ''))) / length(c_clamp_old) <> 1
     OR (length(d) - length(replace(d, c_min_old, ''))) / length(c_min_old) <> 1
     OR (length(d) - length(replace(d, c_ta_old, ''))) / length(c_ta_old) <> 1
     OR (length(d) - length(replace(d, c_tc_old, ''))) / length(c_tc_old) <> 1
     OR (length(d) - length(replace(d, c_acc_old, ''))) / length(c_acc_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P4_SCOPE_ANCHORS: an anchor in fn_process_weekly_accounting_scope is missing or not unique' USING ERRCODE = '55000';
  END IF;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_proc WHERE oid = c_sig::regprocedure;
  p := replace(replace(replace(replace(replace(replace(d,
         c_join_old, c_join_new), c_clamp_old, c_clamp_new), c_min_old, c_min_new),
         c_ta_old, c_ta_new), c_tc_old, c_tc_new), c_acc_old, c_acc_new);
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_sig::regprocedure;
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_sig::regprocedure) <> p THEN
    RAISE EXCEPTION 'START_WEEK_P4_SCOPE_POSTIMAGE %', md5(pg_get_functiondef(c_sig::regprocedure)) USING ERRCODE = '55000';
  END IF;
END
$p4_scope$;

-- P4.3 weekly_payout_eligible_scopes carries the same standalone discovery,
-- byte for byte, and pins the processor's body: both follow.
DO $p4_eligible$
DECLARE
  c_sig  constant text := 'smarter_private.weekly_payout_eligible_scopes(timestamptz,timestamptz)';
  c_proc constant text := 'public.fn_process_weekly_accounting_scope(uuid,uuid)';
  old_proc constant text := '4179282ab83f30094d4c3b2885102917';
  c_join_old constant text := $o$              JOIN public.accounting_tournament_fee_recognitions r ON r.tournament_id=s.tournament_id
              LEFT JOIN public.fn_ca_launch_accounting_club_cutoffs() bd(club_id,cutoff_at) ON bd.club_id=s.club_id
$o$;
  c_join_new constant text := $n$              JOIN public.accounting_tournament_fee_recognitions r ON r.tournament_id=s.tournament_id
              LEFT JOIN public.fn_ca_launch_accounting_club_cutoffs() bd(club_id,cutoff_at) ON bd.club_id=s.club_id
              -- START-WEEK ATTRIBUTION (20261116): a straddler earns at the last instant of its start week.
              LEFT JOIN public.accounting_tournament_week_attributions wa ON wa.source_id=s.id
$n$;
  c_clamp_old constant text := $o$                AND NOT s.union_id IS DISTINCT FROM r.union_id AND rs.recognized_at<v_to AND rs.recognized_at<tf.floor)
$o$;
  c_clamp_new constant text := $n$                AND NOT s.union_id IS DISTINCT FROM r.union_id AND COALESCE(wa.attributed_at,rs.recognized_at)<v_to AND COALESCE(wa.attributed_at,rs.recognized_at)<tf.floor)
$n$;
  c_min_old constant text := $o$            SELECT tm.earned_at FROM (SELECT min(rs.recognized_at) AS m,min(rs.recognized_at) FILTER(WHERE isfinite(rs.recognized_at)) AS mf
$o$;
  c_min_new constant text := $n$            SELECT tm.earned_at FROM (SELECT min(COALESCE(wa.attributed_at,rs.recognized_at)) AS m,min(COALESCE(wa.attributed_at,rs.recognized_at)) FILTER(WHERE isfinite(COALESCE(wa.attributed_at,rs.recognized_at))) AS mf
$n$;
  c_ta_old constant text := $o$                AND NOT s.union_id IS DISTINCT FROM r.union_id AND rs.recognized_at<v_to) ta
$o$;
  c_ta_new constant text := $n$                AND NOT s.union_id IS DISTINCT FROM r.union_id AND COALESCE(wa.attributed_at,rs.recognized_at)<v_to) ta
$n$;
  new_proc text; new_proc_pub text; d text; p text; m jsonb; m2 jsonb; previous text := current_setting('search_path');
BEGIN
  -- The pin is computed under the function's own search_path (pg_catalog, public);
  -- the stale-pin checker computes it under pg_catalog. They must agree.
  PERFORM set_config('search_path', 'pg_catalog', true);
  new_proc := md5(pg_get_functiondef(c_proc::regprocedure));
  PERFORM set_config('search_path', 'pg_catalog, public', true);
  new_proc_pub := md5(pg_get_functiondef(c_proc::regprocedure));
  PERFORM set_config('search_path', previous, true);
  IF new_proc IS DISTINCT FROM new_proc_pub OR new_proc = old_proc THEN
    RAISE EXCEPTION 'START_WEEK_P4_PROCESSOR_PIN_UNREADABLE: % %', new_proc, new_proc_pub USING ERRCODE = '55000';
  END IF;
  d := pg_get_functiondef(c_sig::regprocedure);
  IF (length(d) - length(replace(d, c_join_old, ''))) / length(c_join_old) <> 2
     OR (length(d) - length(replace(d, c_clamp_old, ''))) / length(c_clamp_old) <> 1
     OR (length(d) - length(replace(d, c_min_old, ''))) / length(c_min_old) <> 1
     OR (length(d) - length(replace(d, c_ta_old, ''))) / length(c_ta_old) <> 1
     OR (length(d) - length(replace(d, old_proc, ''))) / length(old_proc) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P4_ELIGIBLE_ANCHORS: an anchor in weekly_payout_eligible_scopes is missing or not unique' USING ERRCODE = '55000';
  END IF;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_proc WHERE oid = c_sig::regprocedure;
  p := replace(replace(replace(replace(replace(d,
         c_join_old, c_join_new), c_clamp_old, c_clamp_new), c_min_old, c_min_new),
         c_ta_old, c_ta_new), old_proc, new_proc);
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_sig::regprocedure;
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_sig::regprocedure) <> p THEN
    RAISE EXCEPTION 'START_WEEK_P4_ELIGIBLE_POSTIMAGE %', md5(pg_get_functiondef(c_sig::regprocedure)) USING ERRCODE = '55000';
  END IF;
END
$p4_eligible$;

-- P4.4 Every weekly book is prepared only once its week's events are settled.
DO $p4_prepare$
DECLARE
  c_sig constant text := 'public.fn_prepare_accounting_week(uuid,uuid,timestamptz,timestamptz)';
  c_old constant text := $o$ -- The original R0 transition qualifies historical interpretation before any
$o$;
  c_new constant text := $n$ -- START-WEEK ATTRIBUTION (20261116): an event (MTT, spin, sit & go,
 -- satellite) belongs to the week it started in, its rake and its results
 -- (owner, 2026-11-14). A week from 2026-11-16 08:00Z on is prepared only once
 -- every event of this scope that started in it has finished and its fee is
 -- recognized: before that nothing is calculated, proved or paid, and every
 -- caller retries (the chunked close commits the wait as a step). An hour past
 -- the payout time the wait is reported once, naming the events; it resolves
 -- itself the first time the week is found settled.
 source_check:=(SELECT COALESCE(jsonb_agg(to_jsonb(w) ORDER BY w.started_at,w.tournament_id),'[]'::jsonb)
  FROM (SELECT * FROM smarter_private.week_tournaments_pending(CASE WHEN p_union_id IS NOT NULL THEN 'union' ELSE 'club' END,
    COALESCE(p_union_id,p_club_id),p_from,p_to) LIMIT 25) w);
 IF source_check IS DISTINCT FROM '[]'::jsonb THEN
  IF clock_timestamp()>=public.fn_union_accounting_run_at(p_to)+interval '1 hour'
   AND NOT EXISTS(SELECT 1 FROM public.financial_alerts a WHERE NOT a.resolved
    AND a.source=CASE WHEN p_union_id IS NOT NULL THEN 'union_accounting_scheduler' ELSE 'weekly_club_accounting' END
    AND a.message='Weekly accounting is waiting for tournaments to finish'
    AND a.context->>'scope_id'=COALESCE(p_union_id,p_club_id)::text
    AND (a.context->>'period_end')::timestamptz=p_to) THEN
   INSERT INTO public.financial_alerts(source,severity,message,context)
   VALUES(CASE WHEN p_union_id IS NOT NULL THEN 'union_accounting_scheduler' ELSE 'weekly_club_accounting' END,'warning',
    'Weekly accounting is waiting for tournaments to finish',
    jsonb_build_object('scope_kind',CASE WHEN p_union_id IS NOT NULL THEN 'union' ELSE 'club' END,
     'scope_id',COALESCE(p_union_id,p_club_id),'union_id',p_union_id,'club_id',p_club_id,
     'period_start',p_from,'period_end',p_to,'waiting',source_check));
  END IF;
  RETURN jsonb_build_object('success',false,'accounting_version',3,
   'union_id',p_union_id,'club_id',p_club_id,'period_start',p_from,'period_end',p_to,'clubs',0,
   'problems',jsonb_build_array(jsonb_build_object('reason','tournaments_started_in_week_not_terminal',
    'waiting',source_check)));
 END IF;
 IF p_to>'2026-11-16 08:00:00+00'::timestamptz THEN
  UPDATE public.financial_alerts a SET resolved=true,resolved_at=clock_timestamp(),
   resolution='verified: every tournament that started in the week '||p_from::text||' to '||p_to::text
    ||' has finished and its fee is recognized.'
   WHERE NOT a.resolved
    AND a.source=CASE WHEN p_union_id IS NOT NULL THEN 'union_accounting_scheduler' ELSE 'weekly_club_accounting' END
    AND a.message='Weekly accounting is waiting for tournaments to finish'
    AND a.context->>'scope_id'=COALESCE(p_union_id,p_club_id)::text
    AND (a.context->>'period_end')::timestamptz=p_to;
 END IF;
 -- The original R0 transition qualifies historical interpretation before any
$n$;
  d text; p text; m jsonb; m2 jsonb;
BEGIN
  d := pg_get_functiondef(c_sig::regprocedure);
  IF (length(d) - length(replace(d, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P4_PREPARE_ANCHOR: the R0 transition comment is missing or not unique' USING ERRCODE = '55000';
  END IF;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_proc WHERE oid = c_sig::regprocedure;
  p := replace(d, c_old, c_new);
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_sig::regprocedure;
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_sig::regprocedure) <> p THEN
    RAISE EXCEPTION 'START_WEEK_P4_PREPARE_POSTIMAGE %', md5(pg_get_functiondef(c_sig::regprocedure)) USING ERRCODE = '55000';
  END IF;
END
$p4_prepare$;

-- P4.5 The scope processor commits the wait as a step, for a union and a club
-- book alike: its only reader of "calculating" is this helper.
DO $p4_calculating$
DECLARE
  c_sig constant text := 'public.fn_accounting_preparation_calculating(jsonb)';
  c_old constant text := $o$     WHERE x->>'reason' IS DISTINCT FROM 'weekly_calculation_in_progress')
$o$;
  c_new constant text := $n$     WHERE x->>'reason' IS DISTINCT FROM 'weekly_calculation_in_progress'
      -- START-WEEK ATTRIBUTION (20261116): a week waiting for its events to
      -- finish is the same committed, retried step, never a failure.
      AND x->>'reason' IS DISTINCT FROM 'tournaments_started_in_week_not_terminal')
$n$;
  d text; p text; m jsonb; m2 jsonb;
BEGIN
  d := pg_get_functiondef(c_sig::regprocedure);
  IF (length(d) - length(replace(d, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P4_CALCULATING_ANCHOR' USING ERRCODE = '55000';
  END IF;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_proc WHERE oid = c_sig::regprocedure;
  p := replace(d, c_old, c_new);
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_sig::regprocedure;
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_sig::regprocedure) <> p THEN
    RAISE EXCEPTION 'START_WEEK_P4_CALCULATING_POSTIMAGE %', md5(pg_get_functiondef(c_sig::regprocedure)) USING ERRCODE = '55000';
  END IF;
END
$p4_calculating$;

-- P4.6 The prep shards prove nothing for a scope before its week is settled.
DO $p4_shard$
DECLARE
  c_sig constant text := 'smarter_private.weekly_prep_shard(integer,integer)';
  c_old constant text := $o$ plan:=smarter_private.weekly_payout_scope_plan(e,n);
 IF plan IS NULL OR jsonb_array_length(plan)=0 THEN RETURN; END IF;
$o$;
  c_new constant text := $n$ plan:=smarter_private.weekly_payout_scope_plan(e,n);
 IF plan IS NULL OR jsonb_array_length(plan)=0 THEN RETURN; END IF;
 -- START-WEEK ATTRIBUTION (20261116): no scope club list, window or calculator
 -- part of a scope is proved before every event that started in its week has
 -- finished and its fee is recognized; a proof taken earlier would miss them.
 SELECT COALESCE(jsonb_agg(x.value ORDER BY x.ordinality),'[]'::jsonb) INTO plan
  FROM jsonb_array_elements(plan) WITH ORDINALITY x(value,ordinality)
  WHERE smarter_private.week_tournaments_settled(x.value->>'kind',(x.value->>'id')::uuid,
   (x.value->>'period_start')::timestamptz,(x.value->>'period_end')::timestamptz);
 IF jsonb_array_length(plan)=0 THEN RETURN; END IF;
$n$;
  d text; p text; m jsonb; m2 jsonb;
BEGIN
  d := pg_get_functiondef(c_sig::regprocedure);
  IF (length(d) - length(replace(d, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P4_SHARD_ANCHOR' USING ERRCODE = '55000';
  END IF;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_proc WHERE oid = c_sig::regprocedure;
  p := replace(d, c_old, c_new);
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_sig::regprocedure;
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_sig::regprocedure) <> p THEN
    RAISE EXCEPTION 'START_WEEK_P4_SHARD_POSTIMAGE %', md5(pg_get_functiondef(c_sig::regprocedure)) USING ERRCODE = '55000';
  END IF;
END
$p4_shard$;

-- P4.7 The round-window advance skips a book whose week is not settled.
DO $p4_advance$
DECLARE
  c_sig constant text := 'public.fn_accounting_close_windows_advance_due()';
  c_old constant text := $o$  EXIT WHEN clock_timestamp()>stmt_stop;
$o$;
  c_new constant text := $n$  EXIT WHEN clock_timestamp()>stmt_stop;
  -- START-WEEK ATTRIBUTION (20261116): no round window of a week is proved
  -- before every event that started in it has finished and been recognized.
  CONTINUE WHEN smarter_private.week_tournaments_settled(q.scope_kind,q.scope_id,q.period_start,q.period_end) IS NOT TRUE;
$n$;
  d text; p text; m jsonb; m2 jsonb;
BEGIN
  d := pg_get_functiondef(c_sig::regprocedure);
  IF (length(d) - length(replace(d, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_P4_ADVANCE_ANCHOR' USING ERRCODE = '55000';
  END IF;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_proc WHERE oid = c_sig::regprocedure;
  p := replace(d, c_old, c_new);
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_sig::regprocedure;
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_sig::regprocedure) <> p THEN
    RAISE EXCEPTION 'START_WEEK_P4_ADVANCE_POSTIMAGE %', md5(pg_get_functiondef(c_sig::regprocedure)) USING ERRCODE = '55000';
  END IF;
END
$p4_advance$;

-- P4.8 No body this part replaced is still pinned anywhere, the gate is closed
-- to every API role, and an old-rule week never waits.
DO $p4_hold$
DECLARE v_stale text; v_grants int;
BEGIN
  SELECT string_agg(DISTINCT x.md5 || ' is still pinned by ' || q.oid::regprocedure::text, '; ')
    INTO v_stale
    FROM (VALUES ('4179282ab83f30094d4c3b2885102917'), ('f1a135b2555d4dfee67836d0b43af390'),
                 ('39a7e057da9a65dab5d0b2f761428f13'), ('bb29caec19261452661e3c6c4ec3bbba'),
                 ('701d0c2c2bed0549ad3789e4a8923aa6'), ('f4aa91b57724614f78a206eb66de7334')) x(md5)
    JOIN pg_catalog.pg_proc q ON strpos(q.prosrc, x.md5) > 0;
  IF v_stale IS NOT NULL THEN
    RAISE EXCEPTION 'START_WEEK_P4_LEFT_A_STALE_PIN: %', v_stale USING ERRCODE = '55000';
  END IF;
  SELECT count(*) INTO v_grants
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid IN ('smarter_private.week_tournaments_pending(text,uuid,timestamptz,timestamptz)'::regprocedure,
                   'smarter_private.week_tournaments_settled(text,uuid,timestamptz,timestamptz)'::regprocedure)
     AND a.grantee <> p.proowner;
  IF v_grants <> 0 THEN
    RAISE EXCEPTION 'START_WEEK_P4_GATE_EXPOSED: % grant(s) beyond the owner', v_grants USING ERRCODE = '55000';
  END IF;
  IF smarter_private.week_tournaments_settled('union', 'fade0000-0000-0000-0000-000000000001',
       '2026-11-09 08:00:00+00', '2026-11-16 08:00:00+00') IS NOT TRUE THEN
    RAISE EXCEPTION 'START_WEEK_P4_OLD_WEEK_WAITS: a week ending at 2026-11-16 08:00Z must keep the old rule' USING ERRCODE = '55000';
  END IF;
END
$p4_hold$;


-- ============================================================================
-- P5: union P&L boundary carries a started-before tournament at its
-- post-boundary net (START-WEEK ATTRIBUTION (20261116)).
-- MUST INSTALL AFTER 20261114182834_a_satellite_seat_held_with_re_entries_is_in_the_boundary
-- (installed on production by 2026-11-14 ~19:30Z; both preimages read live):
--   fn_union_pnl_boundary(uuid,timestamptz)            62c86dc034062e55790618be187d3eb4
--   original_inventory_proof_sources_match()           50d592f2652e20dd4470bac5986dbe2d
-- Effective only for p_at >= 2026-11-23 08:00:00+00; every earlier boundary
-- computes byte for byte as before (neither new branch is entered).
-- Two additions: (1) a tournament started before p_at is held at what it moves
-- after p_at (wallet flows, seats and tickets out, less entries and seats or
-- tickets in); (2) every satellite ticket in escrow at p_at is held for its
-- holder, basis 'escrowed_satellite_ticket'.
-- ============================================================================

-- P5.1 Preimages.
DO $p5_pre$
BEGIN
  IF md5(pg_get_functiondef('public.fn_union_pnl_boundary(uuid,timestamptz)'::regprocedure)) <> '62c86dc034062e55790618be187d3eb4'
     OR position('A SATELLITE SEAT HELD WITH RE-ENTRIES (20261114182834)' IN pg_get_functiondef('public.fn_union_pnl_boundary(uuid,timestamptz)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'START_WEEK_BOUNDARY_PREIMAGE_CHANGED: fn_union_pnl_boundary is not the 20261114182834 body; install that file first, or requalify' USING ERRCODE = '55000';
  END IF;
  IF md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure)) <> '50d592f2652e20dd4470bac5986dbe2d' THEN
    RAISE EXCEPTION 'START_WEEK_SOURCES_PREIMAGE_CHANGED: original_inventory_proof_sources_match is not the 20261114182834 body' USING ERRCODE = '55000';
  END IF;
  IF smarter_private.original_inventory_proof_sources_match() IS NOT TRUE THEN
    RAISE EXCEPTION 'START_WEEK_SOURCES_ALREADY_DIFFER: the proof source list did not match the catalog before this change' USING ERRCODE = '55000';
  END IF;
END
$p5_pre$;

-- P5.2 The boundary, from the 2026-11-23 boundary on: a tournament that
-- started before p_at is carried at what it moves after p_at, and a satellite
-- ticket in escrow at p_at is held for its holder.
DO $p5_boundary$
DECLARE
  c_sig constant text := 'public.fn_union_pnl_boundary(uuid,timestamptz)';
  c_decl_old constant text := $p5do$ seat_credit_total numeric;
$p5do$;
  c_decl_new constant text := $p5dn$ seat_credit_total numeric;
 sw_started timestamptz; sw_status text; sw_missing int; sw_holdings jsonb; sw_ticket record;
$p5dn$;
  c_old constant text := $p5o$  first_op:=public.fn_union_pnl_first_inventory_operation('tournaments',(t->>'id')::uuid,v_proj);
$p5o$;
  c_new constant text := $p5n$  -- START-WEEK ATTRIBUTION (20261116): from the 2026-11-23 boundary on, an
  -- event belongs to the week it STARTED (Dan, 2026-11-14: "ANY TOURNAMENT,
  -- SPIN, SIT N GO OR SATELLITE GAME THAT STARTS BEFORE THE CUT OFF MUST BE
  -- INCLUDED IN THE WEEK IT STARTED IN"). A tournament that started before
  -- p_at is carried, per club and player, at what it moves after p_at into or
  -- out of everything this boundary measures: credits and refunds paid out,
  -- seats it awards (held by the seat-only branch while their target waits)
  -- and tickets it issues (held below while escrowed), less chip entries
  -- (late registrations included) and seats or tickets admitted into it.
  -- With the flows before p_at that is the whole event in the closing week;
  -- the next week opens with it and its own flows and holdings net it to
  -- zero, exactly as for an event that runs inside one week. Not
  -- yet terminal, terminal without its fee recognition, still owing a player,
  -- holding a non-chip entry, or naming no club or player: refused, never
  -- guessed. A tournament not started at p_at keeps the registration branch.
  IF p_at>='2026-11-23 08:00:00+00'::timestamptz THEN
   sw_started:=NULL; sw_status:=NULL;
   SELECT COALESCE((t->>'started_at')::timestamptz,x.started_at),upper(COALESCE(x.status::text,''))
    INTO sw_started,sw_status FROM public.tournaments x WHERE x.id=(t->>'id')::uuid;
   IF sw_started IS NULL THEN sw_started:=(t->>'started_at')::timestamptz; END IF;
   IF sw_started<p_at THEN
    IF sw_status IS NULL OR sw_status NOT IN('COMPLETED','CANCELLED') THEN
     issues:=issues||jsonb_build_array(jsonb_build_object('reason','open_tournament_started_before_boundary_not_terminal','tournament_id',t->'id')); CONTINUE;
    END IF;
    IF EXISTS(SELECT 1 FROM public.accounting_tournament_fee_sources fs WHERE fs.tournament_id=(t->>'id')::uuid)
       AND NOT EXISTS(SELECT 1 FROM public.accounting_tournament_fee_recognitions fr WHERE fr.tournament_id=(t->>'id')::uuid) THEN
     issues:=issues||jsonb_build_array(jsonb_build_object('reason','open_tournament_started_before_boundary_unrecognized','tournament_id',t->'id')); CONTINUE;
    END IF;
    IF EXISTS(SELECT 1 FROM public.tournament_obligations o WHERE o.tournament_id=(t->>'id')::uuid AND o.amount_owed>o.amount_paid) THEN
     issues:=issues||jsonb_build_array(jsonb_build_object('reason','open_tournament_started_before_boundary_unpaid_obligation','tournament_id',t->'id')); CONTINUE;
    END IF;
    IF EXISTS(SELECT 1 FROM public.tournament_participant_funding_receipts r
      JOIN public.union_pnl_transaction_frames b ON b.transaction_id=r.transaction_id
      WHERE r.tournament_id=(t->>'id')::uuid AND b.observed_at>=p_at AND r.asset IS DISTINCT FROM 'chips') THEN
     issues:=issues||jsonb_build_array(jsonb_build_object('reason','open_tournament_started_before_boundary_nonchip_entry','tournament_id',t->'id')); CONTINUE;
    END IF;
    SELECT count(*) FILTER(WHERE q.club IS NULL OR q.usr IS NULL),
     COALESCE(jsonb_agg(jsonb_build_object('club_id',q.club,'user_id',q.usr,'amount',q.amt,'kind','deferred_tournament_result',
       'source_id',t->'id','basis','start_week_post_boundary_net') ORDER BY q.club,q.usr)
      FILTER(WHERE q.club IS NOT NULL AND q.usr IS NOT NULL AND q.amt<>0),'[]'::jsonb)
     INTO sw_missing,sw_holdings
     FROM (SELECT y.club,y.usr,sum(y.amt) amt FROM (
       SELECT c.credited_club_id club,c.user_id usr,c.amount amt FROM public.tournament_accounting_credit_receipts c
        JOIN public.union_pnl_transaction_frames b ON b.transaction_id=c.transaction_id
        WHERE c.tournament_id=(t->>'id')::uuid AND b.observed_at>=p_at
       UNION ALL
       SELECT r2.source_wallet_club_id,r2.user_id,r2.amount_paid_now FROM public.tournament_refund_tranches r2
        JOIN public.union_pnl_transaction_frames b ON b.transaction_id=r2.transaction_id
        WHERE r2.tournament_id=(t->>'id')::uuid AND b.observed_at>=p_at
         AND NOT EXISTS(SELECT 1 FROM public.tournament_accounting_credit_receipts c WHERE c.ledger_id=r2.credit_ledger_id)
       UNION ALL
       SELECT public.fn_union_pnl_satellite_seat_owner((l.metadata->>'registration_id')::uuid,l.to_entity_id),
        (l.metadata->>'user_id')::uuid,l.amount
        FROM public.chip_ledger l WHERE l.from_type='prize_liability' AND l.from_entity_id=(t->>'id')::uuid
         AND l.status='posted' AND l.row_hash IS NOT NULL AND l.created_at>=p_at
         AND l.category='tournament_buyin' AND l.to_type='prize_liability' AND l.metadata->>'kind'='satellite_seat_pool_transfer'
       UNION ALL
       SELECT (SELECT CASE WHEN (SELECT count(*) FROM public.tournament_satellite_awards a0 WHERE a0.ticket_id=l.to_entity_id AND a0.delivery_kind='ticket')=1
           AND count(*)>0 AND count(*) FILTER(WHERE r.operation='entry')>=1 AND count(DISTINCT r.funding_club_id)=1
           AND count(*) FILTER(WHERE r.asset IS DISTINCT FROM 'chips' OR r.amount IS NULL OR r.amount<=0 OR r.funding_club_id IS NULL OR NOT EXISTS(
            SELECT 1 FROM public.chip_ledger cl WHERE cl.id=r.ledger_id AND cl.status='posted' AND cl.from_type='player_wallet' AND cl.from_entity_id=r.user_id
             AND cl.to_type='prize_liability' AND cl.to_entity_id=r.tournament_id AND cl.tournament_id=r.tournament_id AND cl.amount=r.amount
             AND cl.club_id=r.funding_club_id AND cl.category IN ('tournament_buyin','rebuy','addon') AND cl.row_hash IS NOT NULL))=0
          THEN min(r.funding_club_id::text)::uuid END
         FROM public.tournament_satellite_awards a JOIN public.tournament_participant_funding_receipts r ON r.tournament_id=a.tournament_id AND r.user_id=a.user_id
         WHERE a.ticket_id=l.to_entity_id AND a.delivery_kind='ticket' AND a.tournament_id=(t->>'id')::uuid),
        (l.metadata->>'user_id')::uuid,l.amount
        FROM public.chip_ledger l WHERE l.from_type='prize_liability' AND l.from_entity_id=(t->>'id')::uuid
         AND l.status='posted' AND l.row_hash IS NOT NULL AND l.created_at>=p_at
         AND l.category='ticket_issue' AND l.to_type='escrow' AND l.metadata->>'kind'='direct_satellite_entry_ticket'
       UNION ALL
       SELECT public.fn_union_pnl_satellite_seat_owner((l.metadata->>'registration_id')::uuid,(t->>'id')::uuid),
        (l.metadata->>'user_id')::uuid,-l.amount
        FROM public.chip_ledger l WHERE l.to_type='prize_liability' AND l.to_entity_id=(t->>'id')::uuid
         AND l.status='posted' AND l.row_hash IS NOT NULL AND l.created_at>=p_at
         AND ((l.category='tournament_buyin' AND l.from_type='prize_liability' AND l.metadata->>'kind'='satellite_seat_pool_transfer')
          OR (l.category='ticket_redeem' AND l.from_type='escrow' AND l.metadata->>'kind'='tournament_entry_ticket_admission'))
       UNION ALL
       SELECT public.fn_union_pnl_tournament_entry_club_of(r.asset,r.amount,r.funding_club_id,r.ledger_id,r.entitlement_id,r.registration_snapshot),
        r.user_id,-r.amount
        FROM public.tournament_participant_funding_receipts r
        JOIN public.union_pnl_transaction_frames b ON b.transaction_id=r.transaction_id
        WHERE r.tournament_id=(t->>'id')::uuid AND b.observed_at>=p_at AND r.asset='chips'
      ) y GROUP BY y.club,y.usr) q;
    IF sw_missing>0 THEN
     issues:=issues||jsonb_build_array(jsonb_build_object('reason','open_tournament_started_before_boundary_club_or_player_missing','tournament_id',t->'id')); CONTINUE;
    END IF;
    holdings:=holdings||sw_holdings;
    CONTINUE;
   END IF;
  END IF;
  first_op:=public.fn_union_pnl_first_inventory_operation('tournaments',(t->>'id')::uuid,v_proj);
$p5n$;
  c_esc_old constant text := $p5eo$ IF p_union_id='fade0000-0000-0000-0000-000000000001'::uuid AND p_at>='2026-10-12 07:00:00Z'::timestamptz THEN
$p5eo$;
  c_esc_new constant text := $p5en$ -- START-WEEK ATTRIBUTION (20261116): from the 2026-11-23 boundary on, a
 -- satellite ticket still in escrow at p_at is the holder's, at its issued
 -- value, for the club that funded the satellite entry that won it (the
 -- entry rule of fn_union_pnl_satellite_seat_owner, quality conjunction byte
 -- for byte; an escrowed ticket has no target registration yet). In escrow:
 -- issued before p_at with no escrow release posted before p_at. A ticket
 -- redeemed before p_at has that release, so a seat-only holding of its
 -- admission is never counted twice. An owner it cannot resolve, or a ticket
 -- no longer 'issued' with no release on the ledger, is refused, never guessed.
 IF p_at>='2026-11-23 08:00:00+00'::timestamptz THEN
  FOR sw_ticket IN
   SELECT tt.id ticket_id,tt.holder_id,tt.status,l.amount,
    EXISTS(SELECT 1 FROM public.chip_ledger o WHERE o.from_type='escrow' AND o.from_entity_id=tt.id AND o.status='posted') ever_released,
    (SELECT CASE WHEN (SELECT count(*) FROM public.tournament_satellite_awards a0 WHERE a0.ticket_id=tt.id AND a0.delivery_kind='ticket')=1
           AND count(*)>0 AND count(*) FILTER(WHERE r.operation='entry')>=1 AND count(DISTINCT r.funding_club_id)=1
           AND count(*) FILTER(WHERE r.asset IS DISTINCT FROM 'chips' OR r.amount IS NULL OR r.amount<=0 OR r.funding_club_id IS NULL OR NOT EXISTS(
            SELECT 1 FROM public.chip_ledger cl WHERE cl.id=r.ledger_id AND cl.status='posted' AND cl.from_type='player_wallet' AND cl.from_entity_id=r.user_id
             AND cl.to_type='prize_liability' AND cl.to_entity_id=r.tournament_id AND cl.tournament_id=r.tournament_id AND cl.amount=r.amount
             AND cl.club_id=r.funding_club_id AND cl.category IN ('tournament_buyin','rebuy','addon') AND cl.row_hash IS NOT NULL))=0
          THEN min(r.funding_club_id::text)::uuid END
         FROM public.tournament_satellite_awards a JOIN public.tournament_participant_funding_receipts r ON r.tournament_id=a.tournament_id AND r.user_id=a.user_id
         WHERE a.ticket_id=tt.id AND a.delivery_kind='ticket' AND a.tournament_id=l.from_entity_id) owner
   FROM public.tournament_tickets tt
   JOIN public.chip_ledger l ON l.to_entity_id=tt.id AND l.to_type='escrow' AND l.category='ticket_issue'
    AND l.from_type='prize_liability' AND l.status='posted' AND l.row_hash IS NOT NULL
    AND l.metadata->>'kind'='direct_satellite_entry_ticket' AND l.created_at<p_at
   JOIN public.tournaments s ON s.id=l.from_entity_id AND s.union_id=p_union_id
   WHERE NOT EXISTS(SELECT 1 FROM public.chip_ledger o WHERE o.from_type='escrow' AND o.from_entity_id=tt.id
     AND o.status='posted' AND o.created_at<p_at)
  LOOP
   IF sw_ticket.owner IS NULL OR sw_ticket.holder_id IS NULL OR sw_ticket.amount IS NULL OR sw_ticket.amount<=0 THEN
    issues:=issues||jsonb_build_array(jsonb_build_object('reason','escrowed_satellite_ticket_owner_unresolved','ticket_id',sw_ticket.ticket_id));
   ELSIF sw_ticket.status IS DISTINCT FROM 'issued' AND NOT sw_ticket.ever_released THEN
    issues:=issues||jsonb_build_array(jsonb_build_object('reason','escrowed_satellite_ticket_released_without_ledger','ticket_id',sw_ticket.ticket_id));
   ELSE
    holdings:=holdings||jsonb_build_array(jsonb_build_object('club_id',sw_ticket.owner,'user_id',sw_ticket.holder_id,'amount',sw_ticket.amount,
     'kind','deferred_tournament_result','source_id',sw_ticket.ticket_id,'basis','escrowed_satellite_ticket'));
   END IF;
  END LOOP;
 END IF;
 IF p_union_id='fade0000-0000-0000-0000-000000000001'::uuid AND p_at>='2026-10-12 07:00:00Z'::timestamptz THEN
$p5en$;
  d text; p text; m jsonb; m2 jsonb;
BEGIN
  d := pg_get_functiondef(c_sig::regprocedure);
  IF (length(d) - length(replace(d, c_decl_old, ''))) / length(c_decl_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_BOUNDARY_DECLARE_ANCHOR: the seat_credit_total declaration is not unique' USING ERRCODE = '55000';
  END IF;
  IF (length(d) - length(replace(d, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_BOUNDARY_ANCHOR: the tournament loop''s first_op line is not unique' USING ERRCODE = '55000';
  END IF;
  IF (length(d) - length(replace(d, c_esc_old, ''))) / length(c_esc_old) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_BOUNDARY_ESCROW_ANCHOR: the original erased receivables line is not unique' USING ERRCODE = '55000';
  END IF;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_proc WHERE oid = c_sig::regprocedure;
  p := replace(replace(replace(d, c_decl_old, c_decl_new), c_old, c_new), c_esc_old, c_esc_new);
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_sig::regprocedure;
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_sig::regprocedure) <> p THEN
    RAISE EXCEPTION 'START_WEEK_BOUNDARY_POSTIMAGE %', md5(pg_get_functiondef(c_sig::regprocedure)) USING ERRCODE = '55000';
  END IF;
END
$p5_boundary$;

-- P5.3 The proof source list follows the new boundary body. The new md5 is
-- read back from the catalog under the list's own search_path (pg_catalog).
DO $p5_sources_pin$
DECLARE
  c_psm   constant text := 'smarter_private.original_inventory_proof_sources_match()';
  c_bound constant text := 'public.fn_union_pnl_boundary(uuid,timestamptz)';
  old_bound constant text := '62c86dc034062e55790618be187d3eb4';
  old_psm   constant text := '50d592f2652e20dd4470bac5986dbe2d';
  new_bound text; d text; p text; m jsonb; m2 jsonb; previous text := current_setting('search_path');
BEGIN
  PERFORM set_config('search_path', 'pg_catalog', true);
  new_bound := md5(pg_get_functiondef(c_bound::regprocedure));
  PERFORM set_config('search_path', previous, true);
  IF new_bound IS NOT DISTINCT FROM old_bound THEN
    RAISE EXCEPTION 'START_WEEK_BOUNDARY_UNCHANGED: the boundary body did not change' USING ERRCODE = '55000';
  END IF;
  d := pg_get_functiondef(c_psm::regprocedure);
  IF md5(d) IS DISTINCT FROM old_psm THEN
    RAISE EXCEPTION 'START_WEEK_SOURCES_PREIMAGE %', md5(d) USING ERRCODE = '55000';
  END IF;
  IF (length(d) - length(replace(d, old_bound, ''))) / length(old_bound) <> 1 THEN
    RAISE EXCEPTION 'START_WEEK_SOURCES_ANCHOR: the boundary pin is not unique in the list' USING ERRCODE = '55000';
  END IF;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_proc WHERE oid = c_psm::regprocedure;
  p := replace(d, old_bound, new_bound);
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_psm::regprocedure;
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_psm::regprocedure) <> p THEN
    RAISE EXCEPTION 'START_WEEK_SOURCES_POSTIMAGE %', md5(pg_get_functiondef(c_psm::regprocedure)) USING ERRCODE = '55000';
  END IF;
END
$p5_sources_pin$;

-- P5.4 The pinned set holds again; refuse on exactly the condition
-- scripts/ci/migration-stale-pins.mjs would refuse on.
DO $p5_pins_hold$
DECLARE v_stale text;
BEGIN
  IF smarter_private.original_inventory_proof_sources_match() IS NOT TRUE THEN
    RAISE EXCEPTION 'START_WEEK_SOURCES_STILL_DIFFER: the proof source list does not match the catalog' USING ERRCODE = '55000';
  END IF;
  IF smarter_private.original_inventory_basis_generation() NOT LIKE 'original-inventory-245-v1:%' THEN
    RAISE EXCEPTION 'START_WEEK_GENERATION_SHAPE: %', smarter_private.original_inventory_basis_generation() USING ERRCODE = '55000';
  END IF;
  SELECT string_agg(DISTINCT x.md5 || ' is still pinned by ' || q.oid::regprocedure::text, '; ')
    INTO v_stale
    FROM (VALUES ('62c86dc034062e55790618be187d3eb4'),
                 ('50d592f2652e20dd4470bac5986dbe2d')) x(md5)
    JOIN pg_catalog.pg_proc q ON strpos(q.prosrc, x.md5) > 0;
  IF v_stale IS NOT NULL THEN
    RAISE EXCEPTION 'START_WEEK_LEFT_A_STALE_PIN: %', v_stale USING ERRCODE = '55000';
  END IF;
END
$p5_pins_hold$;

COMMIT;
