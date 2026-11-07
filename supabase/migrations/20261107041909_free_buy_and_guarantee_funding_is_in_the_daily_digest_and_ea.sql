-- 20261107041909_free_buy_and_guarantee_funding_is_in_the_daily_digest_and_ea
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch.
--
-- FREE BUY AND GUARANTEE FUNDING IS A LINE IN THE DAILY DIGEST, AND A PRIZE
-- PROMO POSTED WHILE REGISTRATION IS OPEN IS WATCHED
--
-- Owner, 2026-11-06: "fully build, fix and enhance all of these and make sure
-- they are fully wired in and tested". Two of those items live here.
--
--  1. A daily digest line for guarantee and Free Buy funding accuracy.
--     fn_sp_digest_free_buy_funding(day) reads, for every guaranteed event
--     (gross rule since 20261105222502) and every Midway Free Buy that
--     started on that Central day, what the platform owed and what it
--     actually posted:
--       guaranteed:      required H = max(0, G - C), posted = net house and
--                        promo legs (fn_ca_guarantee_funding, unchanged);
--       Free Buy, no G:  required H = V (one chip per first entry), posted =
--                        net Midway promo legs (the watch's own rule).
--     Each event is exact, over, under, or pending (not finalized yet), with
--     the promo part (Midway Union Promo Wallet) and the house part (union
--     bank or club treasury) kept apart. It also reports that gaming day's
--     Free Buy tickets (redeemed, returned, players, players who used all
--     five) and every open Free Buy watch finding. The World Hub digest
--     (src/lib/dailyDigest) loads it the way it loads
--     fn_sp_digest_spins_spend and prints it as its own card. Read-only;
--     service_role only.
--
--  2. A watch kind for a prize promo posted while registration is open.
--     Since 20261106195136 (#9726, live 2026-11-06 21:06 UTC) a first entry's
--     PRIZE promo is posted once, at registration close
--     ('tourney:<id>:free_buy_cutoff_funding'); a sign-up still posts the
--     bounty part only (prize_part 0). Read from production 04:20 UTC
--     2026-11-07: the last sign-up head with prize_part > 0 was posted
--     2026-11-06 21:05:26 UTC, and all 185 heads since carry prize_part 0.
--     fn_ca_free_buy_funding_watch gains 'early_prize_promo' (critical): any
--     Midway promo head after that moment with a prize part, or a cutoff
--     funding leg on an event that is not finalized. It starts with nothing
--     to report (asserted below) and stays read-only like every other kind.
--
-- The start-up handling inside fn_ca_fund_free_buy_at_cutoff_locked (legacy
-- prize parts netted from V, legacy funded heads counted as first entries) is
-- deliberately KEPT. It is exact accounting, not an exception: once the last
-- event holding legacy prize heads settles, both terms are zero for every new
-- event, and the new watch kind proves no legacy-shaped leg can reappear.
-- Removing it would only remove the netting that keeps a stray head from
-- being paid twice.
--
-- No chips move.
--
-- @live-proof: jsonb_typeof(public.fn_sp_digest_free_buy_funding(((now() AT TIME ZONE 'America/Chicago')::date - 1))) = 'object' AND position('early_prize_promo' in pg_get_functiondef('public.fn_ca_free_buy_funding_watch()'::regprocedure)) > 0
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

DO $pre$ BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_free_buy_funding_watch()'::regprocedure))
     IS DISTINCT FROM '44fc0264d2fc445ab2a9b696468d7add' THEN
    RAISE EXCEPTION 'Inspected definition changed: fn_ca_free_buy_funding_watch';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_guarantee_funding(uuid)'::regprocedure))
     IS DISTINCT FROM '6d99e12842f473688ef656d577561863' THEN
    RAISE EXCEPTION 'Inspected definition changed: fn_ca_guarantee_funding';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_midway_free_buy_format(uuid)'::regprocedure))
     IS DISTINCT FROM 'f9522dffe07a3d8d446e5e3bebd11f68' THEN
    RAISE EXCEPTION 'Inspected definition changed: fn_ca_midway_free_buy_format';
  END IF;
  IF to_regprocedure('public.fn_sp_digest_free_buy_funding(date)') IS NOT NULL THEN
    RAISE EXCEPTION 'fn_sp_digest_free_buy_funding already exists';
  END IF;
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
       WHERE c.conrelid = 'public.ca_free_buy_watch_findings'::regclass
         AND c.conname = 'ca_free_buy_watch_findings_kind_check')
     IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''guarantee_overfunded''::text, ''guarantee_underfunded''::text, ''voucher_overfunded''::text, ''voucher_underfunded''::text, ''ticket_day_mismatch''::text, ''ticket_without_entry''::text, ''ticket_on_cancelled_event''::text, ''entry_without_ticket''::text, ''free_buy_without_format''::text])))' THEN
    RAISE EXCEPTION 'Inspected definition changed: ca_free_buy_watch_findings_kind_check';
  END IF;
END $pre$;

-- The findings table is written only by the watch (every 15 minutes) and read
-- by nothing hot, so its brief lock is harmless; lock_timeout bounds it.
ALTER TABLE public.ca_free_buy_watch_findings
  DROP CONSTRAINT ca_free_buy_watch_findings_kind_check,
  ADD CONSTRAINT ca_free_buy_watch_findings_kind_check CHECK (kind = ANY (ARRAY[
    'guarantee_overfunded', 'guarantee_underfunded', 'voucher_overfunded', 'voucher_underfunded',
    'ticket_day_mismatch', 'ticket_without_entry', 'ticket_on_cancelled_event', 'entry_without_ticket',
    'free_buy_without_format', 'early_prize_promo']));

CREATE FUNCTION public.fn_sp_digest_free_buy_funding(p_day date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'smarter_private', 'pg_temp'
AS $function$
  WITH b AS (
    SELECT (p_day::timestamp AT TIME ZONE 'America/Chicago') AS s,
           ((p_day + 1)::timestamp AT TIME ZONE 'America/Chicago') AS e
  ), ev AS (
    SELECT t.id, t.name, t.status, t.start_time,
           coalesce(t.prize_pool_finalized, false) AS fin,
           round(greatest(coalesce(t.guaranteed_prize, 0), 0), 2) AS g,
           CASE WHEN coalesce(t.free_buy, false)
                 AND (t.union_id = 'fade0000-0000-0000-0000-000000000001'::uuid
                      OR t.club_id = 'fade0000-0000-0000-0000-000000000001'::uuid)
                THEN public.fn_ca_midway_free_buy_format(t.id) END AS fmt,
           coalesce(t.variant, '') NOT IN ('satellite', 'spin') AND coalesce(t.satellite_seats, 0) = 0 AS prize_event
      FROM public.tournaments t, b
     WHERE t.start_time >= b.s AND t.start_time < b.e
       AND t.start_time >= '2026-11-05 22:25:02+00'
       AND coalesce(t.status, '') <> 'CANCELLED'
  ), scoped AS (
    SELECT ev.* FROM ev WHERE (ev.g > 0 AND ev.prize_event) OR ev.fmt IS NOT NULL
  ), m AS (
    SELECT s.*,
      CASE WHEN s.g > 0 THEN public.fn_ca_guarantee_funding(s.id) END AS gf,
      (SELECT count(*) FROM public.tournament_players p WHERE p.tournament_id = s.id) AS entries,
      (SELECT count(*) FROM smarter_private.free_buy_ticket_redemptions x
        WHERE x.tournament_id = s.id AND x.returned_at IS NULL) AS tickets,
      (SELECT coalesce(sum(l.amount), 0) FROM public.chip_ledger l
        WHERE l.to_entity_id = s.id AND l.to_type = 'prize_liability' AND coalesce(l.status, 'posted') = 'posted'
          AND l.category = 'promo_send' AND l.from_type = 'union_wallet')
      - (SELECT coalesce(sum(l.amount), 0) FROM public.chip_ledger l
        WHERE l.from_entity_id = s.id AND l.from_type = 'prize_liability' AND coalesce(l.status, 'posted') = 'posted'
          AND l.category = 'reversal' AND l.to_type = 'union_wallet') AS promo,
      (SELECT coalesce(sum(l.amount), 0) FROM public.chip_ledger l
        WHERE l.to_entity_id = s.id AND l.to_type = 'prize_liability' AND coalesce(l.status, 'posted') = 'posted'
          AND l.category IN ('overlay', 'promo_send') AND l.from_type IN ('union_bank', 'club_treasury'))
      - (SELECT coalesce(sum(l.amount), 0) FROM public.chip_ledger l
        WHERE l.from_entity_id = s.id AND l.from_type = 'prize_liability' AND coalesce(l.status, 'posted') = 'posted'
          AND l.category = 'reversal' AND l.to_type IN ('union_bank', 'club_treasury')) AS house
      FROM scoped s
  ), r AS (
    SELECT m.*,
      CASE WHEN m.g > 0 THEN (m.gf->>'gross_coverage')::numeric ELSE 0 END AS player_coverage,
      CASE WHEN m.g > 0 THEN (m.gf->>'house_required')::numeric ELSE m.entries::numeric END AS required,
      CASE WHEN m.g > 0 THEN (m.gf->>'house_posted')::numeric ELSE round(m.promo, 2) END AS posted
      FROM m
  ), v AS (
    SELECT r.*,
      CASE WHEN NOT r.fin THEN 'pending'
           WHEN abs(r.posted - r.required) <= 0.01 THEN 'exact'
           WHEN r.posted > r.required THEN 'over' ELSE 'under' END AS verdict
      FROM r
  ), ej AS (
    SELECT jsonb_build_object(
      'tournament_id', v.id, 'name', v.name, 'status', v.status,
      'starts', v.start_time,
      'starts_ct', to_char(v.start_time AT TIME ZONE 'America/Chicago', 'FMHH12:MI AM'),
      'free_buy_format', v.fmt, 'guarantee', v.g, 'finalized', v.fin,
      'entries', v.entries, 'tickets', v.tickets,
      'player_coverage', round(v.player_coverage, 2),
      'required', round(v.required, 2), 'posted', round(v.posted, 2),
      'promo', round(v.promo, 2), 'house', round(v.house, 2),
      'variance', round(v.posted - v.required, 2), 'verdict', v.verdict) AS j,
      v.fmt IS NOT NULL AS is_free_buy, v.verdict, v.start_time,
      v.required, v.posted, v.promo, v.house
      FROM v
  ), tk AS (
    SELECT count(*) FILTER (WHERE x.returned_at IS NULL) AS redeemed,
           count(*) FILTER (WHERE x.returned_at IS NOT NULL) AS returned,
           count(DISTINCT x.user_id) FILTER (WHERE x.returned_at IS NULL) AS players
      FROM smarter_private.free_buy_ticket_redemptions x WHERE x.gaming_day = p_day
  ), lim AS (
    SELECT count(*) AS at_limit FROM smarter_private.free_buy_ticket_days d
     WHERE d.gaming_day = p_day AND d.used >= 5
  ), wf AS (
    SELECT coalesce(jsonb_object_agg(k.kind, k.n), '{}'::jsonb) AS by_kind, coalesce(sum(k.n), 0) AS total
      FROM (SELECT w.kind, count(*) AS n FROM public.ca_free_buy_watch_findings w
             WHERE w.cleared_at IS NULL GROUP BY w.kind) k
  )
  SELECT jsonb_build_object(
    'day', p_day,
    'rule', 'Guaranteed: H = max(0, G - C), where C is every qualifying player buy-in, rebuy and add-on. Free Buy without a guarantee: H = V, one chip per first entry. Promo is the Midway Union Promo Wallet; house is the union bank or club treasury.',
    'events', (SELECT count(*) FROM ej),
    'free_buy_events', (SELECT count(*) FROM ej WHERE is_free_buy),
    'exact', (SELECT count(*) FROM ej WHERE verdict = 'exact'),
    'over', (SELECT count(*) FROM ej WHERE verdict = 'over'),
    'under', (SELECT count(*) FROM ej WHERE verdict = 'under'),
    'pending', (SELECT count(*) FROM ej WHERE verdict = 'pending'),
    'required_total', (SELECT round(coalesce(sum(required) FILTER (WHERE verdict <> 'pending'), 0), 2) FROM ej),
    'posted_total', (SELECT round(coalesce(sum(posted) FILTER (WHERE verdict <> 'pending'), 0), 2) FROM ej),
    'promo_total', (SELECT round(coalesce(sum(promo) FILTER (WHERE verdict <> 'pending'), 0), 2) FROM ej),
    'house_total', (SELECT round(coalesce(sum(house) FILTER (WHERE verdict <> 'pending'), 0), 2) FROM ej),
    'free_buy', (SELECT coalesce(jsonb_agg(j ORDER BY start_time), '[]'::jsonb) FROM ej WHERE is_free_buy),
    'off', (SELECT coalesce(jsonb_agg(o.j ORDER BY abs((o.j->>'variance')::numeric) DESC), '[]'::jsonb)
              FROM (SELECT j FROM ej WHERE verdict IN ('over', 'under')
                     ORDER BY abs(posted - required) DESC LIMIT 20) o),
    'tickets', (SELECT jsonb_build_object('gaming_day', p_day, 'allotment', 5,
                  'redeemed', tk.redeemed, 'returned', tk.returned,
                  'players', tk.players, 'players_at_limit', lim.at_limit) FROM tk, lim),
    'open_findings', (SELECT jsonb_build_object('total', wf.total, 'by_kind', wf.by_kind) FROM wf),
    'generated_at', clock_timestamp());
$function$;
COMMENT ON FUNCTION public.fn_sp_digest_free_buy_funding(date) IS
 'Daily digest: required vs posted funding for every guaranteed event and Midway Free Buy that started on the Central day, that gaming day''s Free Buy tickets, and open Free Buy watch findings (20261107041909). Read-only.';
REVOKE ALL ON FUNCTION public.fn_sp_digest_free_buy_funding(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sp_digest_free_buy_funding(date) TO service_role;

DO $watch$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_free_buy_funding_watch()'::regprocedure);
  a1 constant text := E'  c_tickets_live constant timestamptz := ''2026-11-05 23:18:46+00'';\n';
  b1 constant text := a1
    || E'  -- #9726: a first entry''s prize promo is posted at registration close;\n'
    || E'  -- the last sign-up head carrying a prize part is 21:05:26 UTC (20261107041909).\n'
    || E'  c_cutoff_live constant timestamptz := ''2026-11-06 21:06:19+00'';\n';
  a2 constant text := E'    UNION ALL\n    SELECT ''free_buy_without_format'', fb.id::text, fb.id,\n';
  b2 constant text := E'    UNION ALL\n'
    || E'    SELECT ''early_prize_promo'', l.id::text, fb.id,\n'
    || E'           jsonb_build_object(''name'', fb.name, ''ledger_id'', l.id, ''idempotency_key'', l.idempotency_key,\n'
    || E'             ''amount'', l.amount, ''prize_part'', l.metadata->>''prize_part'', ''created_at'', l.created_at,\n'
    || E'             ''finalized'', fb.fin)\n'
    || E'      FROM fb JOIN public.chip_ledger l ON l.to_entity_id = fb.id\n'
    || E'     WHERE l.to_type = ''prize_liability'' AND l.category = ''promo_send'' AND l.from_type = ''union_wallet''\n'
    || E'       AND coalesce(l.status, ''posted'') = ''posted''\n'
    || E'       AND l.metadata->>''kind'' = ''midway_free_buy_promo_head''\n'
    || E'       AND l.created_at >= c_cutoff_live\n'
    || E'       AND ((l.idempotency_key LIKE ''tourney:%:promo_head:%''\n'
    || E'             AND coalesce((l.metadata->>''prize_part'')::numeric, l.amount) > 0)\n'
    || E'         OR (l.idempotency_key = ''tourney:'' || fb.id::text || '':free_buy_cutoff_funding''\n'
    || E'             AND NOT fb.fin))\n'
    || a2;
  a3 constant text := E'      CASE WHEN f.kind LIKE ''guarantee_%'' OR f.kind LIKE ''voucher_%'' THEN ''critical'' ELSE ''warning'' END,\n';
  b3 constant text := E'      CASE WHEN f.kind LIKE ''guarantee_%'' OR f.kind LIKE ''voucher_%'' OR f.kind = ''early_prize_promo''\n'
    || E'           THEN ''critical'' ELSE ''warning'' END,\n';
  a4 constant text := E'        ELSE format(''Midway Free Buy %s has no Free Buy format';
  b4 constant text := E'        WHEN ''early_prize_promo'' THEN format(''%s holds a prize promo of %s chips posted while registration was open (ledger %s); prize promo is posted once, at registration close.'',\n'
    || E'          coalesce(f.detail->>''name'', f.subject), coalesce(f.detail->>''prize_part'', f.detail->>''amount''), f.subject)\n'
    || a4;
  n integer;
BEGIN
  FOREACH n IN ARRAY ARRAY[
      (length(v_def) - length(replace(v_def, a1, ''))) / length(a1),
      (length(v_def) - length(replace(v_def, a2, ''))) / length(a2),
      (length(v_def) - length(replace(v_def, a3, ''))) / length(a3),
      (length(v_def) - length(replace(v_def, a4, ''))) / length(a4)] LOOP
    IF n <> 1 THEN RAISE EXCEPTION 'fn_ca_free_buy_funding_watch anchor not found exactly once'; END IF;
  END LOOP;
  EXECUTE replace(replace(replace(replace(v_def, a1, b1), a2, b2), a3, b3), a4, b4);
END
$watch$;
REVOKE ALL ON FUNCTION public.fn_ca_free_buy_funding_watch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_free_buy_funding_watch() TO service_role;

-- The new kind starts with nothing to report (read 04:20 UTC 2026-11-07).
DO $post$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.chip_ledger l
   WHERE l.to_type = 'prize_liability' AND l.category = 'promo_send' AND l.from_type = 'union_wallet'
     AND l.metadata->>'kind' = 'midway_free_buy_promo_head'
     AND l.created_at >= '2026-11-06 21:06:19+00'
     AND l.idempotency_key LIKE 'tourney:%:promo_head:%'
     AND coalesce((l.metadata->>'prize_part')::numeric, l.amount) > 0;
  IF v_n <> 0 THEN RAISE EXCEPTION '% sign-up heads posted a prize part after the cutoff went live', v_n; END IF;
END
$post$;

COMMIT;
