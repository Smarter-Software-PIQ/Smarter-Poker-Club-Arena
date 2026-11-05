-- 20261105220120_a_guarantee_counts_the_full_buy_in
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-05.
--
-- A GUARANTEE COUNTS THE FULL BUY-IN (owner rule, 2026-11-05)
--
-- The full qualifying player payment counts toward a tournament's buy-in
-- guarantee BEFORE bounty or rake allocations are deducted. A player who pays
-- 40 chips split 26 prize / 10 bounty / 4 rake has put 40 toward the
-- guarantee, not 26 and not 36. With
--   G = the advertised guarantee (tournaments.guaranteed_prize),
--   C = the gross qualifying player payments, net of refunds
--     = player prize contributions + player bounty contributions + rake,
--   H = max(0, G - C) is the TOTAL house/promo funding the event may receive.
-- Once C >= G, H is zero on every path. H goes to the regular prize pool (the
-- event's existing overlay policy: overlay funds places); bounty and rake
-- allocations are never touched by it.
--
-- WHY THIS IS THE ONE FORMULA EVERY WRITER ALREADY SHARES
-- Every funding writer, guard and settlement check sizes the pool against one
-- "place floor", fn_ca_place_guarantee(G, bounty_pool) = G - bounty_pool, and
-- funds max(0, floor - prize_pool). Before finalization prize_pool holds the
-- players' prize contributions, bounty_pool their cumulative bounty
-- contributions (it does not fall when bounties are awarded; awards are
-- tracked in bounty_pool_paid) and total_rake their fees (net of refunds;
-- 0 mismatches against escrow fee_entries_in + satellite_fee_in - refund_fee
-- across 466 guaranteed events, read 2026-11-05). So
--   floor - prize_pool = G - bounty - prize   = (G - C) + rake.
-- The old floor left rake out of C and overfunded every short event by its
-- rake, and funded events whose C already met G (13 x 40 against 500:
-- prize 338 + bounty 130 = 468 < 500 paid a 32 overlay; the rule says 0).
-- The corrected floor is G - bounty_pool - total_rake, which gives exactly
--   floor - prize_pool = G - C.
--
-- WHAT IT CHANGES
--  1. fn_ca_place_guarantee(guarantee, bounty_pool, rake): the floor above.
--  2. Every writer and guard that reads the floor passes total_rake, so no
--     path keeps the old arithmetic: the close-out (fn_apply_prize_guarantee
--     -> core -> before_atomic_proof), the start trigger (satellite seats
--     only since 20261105034239), the start-overlay excess return, the
--     shortfall reader, both settlement doors and their atomic twins, the
--     completion guard, the two conservation detectors and the Diamond floor.
--     Each is md5-guarded against production as read 2026-11-05 and patched
--     at exact anchors counted before the rewrite.
--  3. fn_ca_backpay_guarantee_shortfalls loses its last EXECUTE grant
--     (service_role): it topped events up to the FULL guarantee in prizes and
--     bounties paid, ignoring rake, through a second bank path. Its body is
--     unchanged; nothing can call it.
--  4. fn_tournament_guarantee_check counts rake as part of what the
--     guarantee delivered, so a met gross guarantee is not alerted as short.
--  5. fn_ca_tournament_prize_funding also returns gross_collected (C), rake
--     and bounty, so screens can compare the guarantee with C and show the
--     prize pool separately.
--  6. fn_ca_guarantee_coverage(event): the reconcilable breakdown (G, C and
--     its prize/bounty/rake parts, house and promo funding, required H and the
--     variance), and ca_guarantee_funding_variances + a 15-minute scan that
--     records any finalized guaranteed event whose house funding is above or
--     below H. Detection only; it moves no chips and sends no alerts.
-- Nothing in this migration moves a chip or rewrites a settled event.
-- Native proof: scripts/ci/test-guarantee-counts-the-full-buy-in.py
--
-- @live-proof: to_regprocedure('public.fn_ca_place_guarantee(numeric,numeric,numeric)') IS NOT NULL AND position('t.total_rake' IN pg_get_functiondef('public.fn_ca_apply_prize_guarantee_core(uuid,text)'::regprocedure))>0 AND position('t.total_rake' IN pg_get_functiondef('public.fn_apply_prize_guarantee_before_atomic_proof(uuid,text)'::regprocedure))>0 AND to_regclass('public.ca_guarantee_funding_variances') IS NOT NULL AND EXISTS(SELECT 1 FROM cron.job WHERE jobname='ca-guarantee-funding-variance-15m')
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='30s';

-- ── 1. The floor ────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_ca_place_guarantee(p_guarantee numeric, p_bounty_pool numeric, p_rake numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- The regular prize pool's floor: the guarantee less what the players
  -- already put toward it outside the prize pool (bounty contributions and
  -- rake). prize_pool + bounty + rake >= G  <=>  prize_pool >= this floor.
  SELECT greatest(0, round(coalesce(p_guarantee,0),2)
                     - greatest(0, round(coalesce(p_bounty_pool,0),2))
                     - greatest(0, round(coalesce(p_rake,0),2)));
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_place_guarantee(numeric,numeric,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ca_place_guarantee(numeric,numeric,numeric) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_ca_place_guarantee(numeric,numeric,numeric) IS
 'Owner rule 2026-11-05: the full buy-in (prize + bounty + rake) counts toward the guarantee. Floor = G - bounty_pool - total_rake; house funding = max(0, floor - prize_pool) = max(0, G - C).';

-- ── 1b. The reconcilable breakdown of one event ─────────────────────────────
CREATE FUNCTION public.fn_ca_guarantee_coverage(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Every chip once:
  --   house_prize  = guarantee/promo money the house put into the prize pool
  --                  (overlay legs in, less excess returned to its source,
  --                  plus Midway promo entry chips' prize share, net);
  --   promo_bounty = promo-funded bounty heads (net of returns);
  --   player_prize = prize_pool - house_prize;
  --   player_bounty= bounty_pool - promo_bounty (cumulative: awards do not
  --                  reduce it; bounty_pool_paid tracks them);
  --   rake         = total_rake (player fees, net of refunds);
  --   C            = player_prize + player_bounty + rake;
  --   required H   = max(0, G - C) for a guaranteed event;
  --   variance     = house_prize - H (positive = overfunded).
  WITH t AS (SELECT * FROM public.tournaments WHERE id = p_tournament_id),
  legs AS (
    SELECT
      COALESCE(sum(l.amount) FILTER (WHERE l.category = 'overlay' AND l.to_type = 'prize_liability'
                                      AND l.to_entity_id = p_tournament_id), 0)
      - COALESCE(sum(l.amount) FILTER (WHERE l.category = 'reversal' AND l.from_type = 'prize_liability'
                                        AND l.from_entity_id = p_tournament_id
                                        AND l.to_type IN ('union_bank', 'club_treasury')), 0) AS overlay_net,
      COALESCE(sum(CASE WHEN l.category = 'promo_send' THEN 1 ELSE -1 END
                   * (l.amount - COALESCE((l.metadata->>'bounty_part')::numeric, l.amount)))
               FILTER (WHERE l.metadata->>'kind' = 'midway_free_buy_promo_head'
                         AND l.category IN ('promo_send', 'reversal')), 0) AS promo_prize,
      COALESCE(sum(CASE WHEN l.category = 'promo_send' THEN 1 ELSE -1 END
                   * COALESCE((l.metadata->>'bounty_part')::numeric, l.amount))
               FILTER (WHERE l.metadata->>'kind' = 'midway_free_buy_promo_head'
                         AND l.category IN ('promo_send', 'reversal')), 0) AS promo_bounty
      FROM public.chip_ledger l
     WHERE l.tournament_id = p_tournament_id
       AND l.category IN ('overlay', 'reversal', 'promo_send')),
  parts AS (
    SELECT t.id, round(COALESCE(t.guaranteed_prize, 0), 2) AS g,
           COALESCE(t.prize_pool_finalized, false) AS finalized,
           round(legs.overlay_net + legs.promo_prize, 2) AS house_prize,
           round(legs.promo_bounty, 2) AS promo_bounty,
           round(COALESCE(t.prize_pool, 0) - legs.overlay_net - legs.promo_prize, 2) AS player_prize,
           round(greatest(0, COALESCE(t.bounty_pool, 0) - legs.promo_bounty), 2) AS player_bounty,
           round(greatest(0, COALESCE(t.total_rake, 0)), 2) AS rake,
           round(COALESCE(t.bounty_pool_paid, 0), 2) AS bounty_awarded
      FROM t CROSS JOIN legs)
  SELECT jsonb_build_object(
    'tournament_id', p.id, 'guarantee', p.g, 'finalized', p.finalized,
    'gross_collected', p.player_prize + p.player_bounty + p.rake,
    'player_prize', p.player_prize, 'player_bounty', p.player_bounty, 'rake', p.rake,
    'bounty_awarded', p.bounty_awarded,
    'house_prize', p.house_prize, 'promo_bounty', p.promo_bounty,
    'house_required', CASE WHEN p.g > 0
                           THEN greatest(0, p.g - (p.player_prize + p.player_bounty + p.rake)) ELSE NULL END,
    'variance', CASE WHEN p.g > 0
                     THEN round(p.house_prize - greatest(0, p.g - (p.player_prize + p.player_bounty + p.rake)), 2)
                     ELSE NULL END)
  FROM parts p;
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_guarantee_coverage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_guarantee_coverage(uuid) TO service_role;

-- ── 2. Every reader of the floor passes total_rake ──────────────────────────
DO $patch$
DECLARE
  v_t  constant text := 'fn_ca_place_guarantee(t.guaranteed_prize, t.bounty_pool)';
  v_t3 constant text := 'fn_ca_place_guarantee(t.guaranteed_prize, t.bounty_pool, t.total_rake)';
  v_n  constant text := 'fn_ca_place_guarantee(NEW.guaranteed_prize, NEW.bounty_pool)';
  v_n3 constant text := 'fn_ca_place_guarantee(NEW.guaranteed_prize, NEW.bounty_pool, NEW.total_rake)';
  v_v  constant text := 'fn_ca_place_guarantee(v_t.guaranteed_prize, v_t.bounty_pool)';
  v_v3 constant text := 'fn_ca_place_guarantee(v_t.guaranteed_prize, v_t.bounty_pool, v_t.total_rake)';
  -- These two read v_t as a record of named columns without total_rake; the
  -- row is already locked FOR UPDATE by the same transaction.
  v_vq constant text := 'fn_ca_place_guarantee(v_t.guaranteed_prize, v_t.bounty_pool, (SELECT x.total_rake FROM public.tournaments x WHERE x.id = v_t.id))';
  r record;
  v_def text;
  v_got int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fn_ca_overlay_shortfall(uuid)',                         '0630537f09ae8d3ed797988b1c9b4990', v_t, v_t3, 1),
    ('public.fn_ca_apply_prize_guarantee_core(uuid,text)',           'f333ee1a4bde10ed83ca182bf874c63f', v_t, v_t3, 2),
    ('public.fn_apply_prize_guarantee_before_atomic_proof(uuid,text)','034cf42764b4ab248bc9609b6d1eee63', v_t, v_t3, 1),
    ('public.fn_poker_diamond_tournament_effective_guarantee(uuid)', '03ba26d681a35fa50cfe7162bc255f67', v_t, v_t3, 1),
    ('public.fn_ca_prize_overpay_unexplained(interval)',             'a43e855986f115dac0b87db90047e2f1', v_t, v_t3, 1),
    ('public.fn_ca_tournament_settlement_mismatch(interval)',        '6b2d9fad3c99a9feea7670fc4aeda076', v_t, v_t3, 1),
    ('public.fn_settle_tournament_places_atomic(uuid,text)',         '47cc6d0aa8afe41478e921fda70f2441', v_t, v_t3, 1),
    ('public.fn_settle_final_table_deal_atomic(uuid)',               'fafec2dc06bd2b91de0cc46146dd787d', v_t, v_t3, 1),
    ('public.fn_ca_fund_overlay_on_lock()',                          '7d5257cc66ae2e73a66bd673267fb3a5', v_n, v_n3, 1),
    ('public.trg_tournament_atomic_place_completion_guard()',        'defc95c3015be5750d65881369b538db', v_n, v_n3, 1),
    ('public.fn_ca_return_excess_start_overlay_locked(uuid)',        'f11d9cfc1eda88c392f234d1dd877699', v_v, v_v3, 1),
    ('public.fn_settle_tournament_places(uuid,uuid)',                '731d720726fc00ca9aebb108b3a33a9c', v_v, v_vq, 1),
    ('public.fn_settle_tournament_final_table_deal(uuid)',           'e0e067768fc6545474a82f952befe202', v_v, v_vq, 1)
  ) AS x(sig, md5, old_text, new_text, expected)
  LOOP
    v_def := pg_get_functiondef(r.sig::regprocedure);
    IF md5(v_def) IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'Inspected definition changed: %', r.sig;
    END IF;
    v_got := (length(v_def) - length(replace(v_def, r.old_text, ''))) / length(r.old_text);
    IF v_got <> r.expected
       OR (length(v_def) - length(replace(v_def, 'fn_ca_place_guarantee(', ''))) / length('fn_ca_place_guarantee(') <> r.expected THEN
      RAISE EXCEPTION '% has % floor anchors, expected %; refusing to patch', r.sig, v_got, r.expected;
    END IF;
    EXECUTE replace(v_def, r.old_text, r.new_text);
  END LOOP;
END
$patch$;

-- ── 3. The legacy back-pay can no longer be called by anyone ───────────────
-- fn_ca_backpay_guarantee_shortfalls topped a completed event up to its FULL
-- guarantee in prizes and bounties paid, ignoring rake, from a second bank
-- path. Nothing schedules or calls it (no cron job, no function, no client;
-- read 2026-11-05), but service_role could still run it by hand. The only
-- funder of a guarantee is the close-out (fn_apply_prize_guarantee), which
-- pays H = max(0, G - C) once, when the last contribution window closes.
DO $pre$ BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_backpay_guarantee_shortfalls(boolean,integer)'::regprocedure))
     IS DISTINCT FROM '53e5ad913ee86a700b71004d2175f87f' THEN
    RAISE EXCEPTION 'Inspected definition changed: fn_ca_backpay_guarantee_shortfalls';
  END IF;
  IF md5(pg_get_functiondef('public.fn_tournament_guarantee_check(integer)'::regprocedure))
     IS DISTINCT FROM '787d0f9fc35a63caa76b464e1bd57c1d' THEN
    RAISE EXCEPTION 'Inspected definition changed: fn_tournament_guarantee_check';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_tournament_prize_funding(uuid)'::regprocedure))
     IS DISTINCT FROM '5c6239e24a84b01033c0de9f01af525b' THEN
    RAISE EXCEPTION 'Inspected definition changed: fn_ca_tournament_prize_funding';
  END IF;
END $pre$;

-- The function body is left exactly as it is; no role can call it any more.
REVOKE ALL ON FUNCTION public.fn_ca_backpay_guarantee_shortfalls(boolean,integer)
  FROM PUBLIC, anon, authenticated, service_role;

-- ── 4. The guarantee check counts the rake the guarantee collected ──────────
DO $check$
DECLARE
  v_def text := pg_get_functiondef('public.fn_tournament_guarantee_check(integer)'::regprocedure);
  a text[] := ARRAY[
    E'      SELECT t.id, t.name, t.club_id, t.guaranteed_prize,\n             COALESCE(t.prize_pool, 0) AS pool,',
    E'    CONTINUE WHEN round(r.paid, 2) >= round(r.guaranteed_prize, 2);',
    E'    v_chips := v_chips + (r.guaranteed_prize - r.paid);',
    E'          ''shortfall'',        round(r.guaranteed_prize - r.paid, 2),'];
  b text[] := ARRAY[
    E'      SELECT t.id, t.name, t.club_id, t.guaranteed_prize,\n             COALESCE(t.total_rake, 0) AS rake,\n             COALESCE(t.prize_pool, 0) AS pool,',
    E'    -- A GUARANTEE COUNTS THE FULL BUY-IN (owner 2026-11-05): the rake the\n    -- players paid is part of what met it, so places + bounties + rake.\n    CONTINUE WHEN round(r.paid + r.rake, 2) >= round(r.guaranteed_prize, 2);',
    E'    v_chips := v_chips + (r.guaranteed_prize - r.paid - r.rake);',
    E'          ''shortfall'',        round(r.guaranteed_prize - r.paid - r.rake, 2),\n          ''rake'',             r.rake,'];
  i int;
BEGIN
  FOR i IN 1..4 LOOP
    IF (length(v_def) - length(replace(v_def, a[i], ''))) / length(a[i]) <> 1 THEN
      RAISE EXCEPTION 'fn_tournament_guarantee_check anchor % not found exactly once', i;
    END IF;
    v_def := replace(v_def, a[i], b[i]);
  END LOOP;
  EXECUTE v_def;
END
$check$;
REVOKE ALL ON FUNCTION public.fn_tournament_guarantee_check(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tournament_guarantee_check(integer) TO service_role;

-- ── 5. What a screen needs to tell G, C, prizes, bounties and rake apart ────
CREATE OR REPLACE FUNCTION public.fn_ca_tournament_prize_funding(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'tournament_id', t.id,
    -- prize + bounty money the entries brought in (unchanged meaning)
    'collected', greatest(0, round(e.gross_in - e.fee_entries_in + e.satellite_in
                                   - e.refund_prize - e.refund_bounty, 2)),
    'overlay', greatest(0, round(e.overlay_in, 2)),
    -- A GUARANTEE COUNTS THE FULL BUY-IN (owner 2026-11-05): C is the gross
    -- the players paid toward the guarantee, before bounty and rake.
    'gross_collected', round(c.gross, 2),
    'player_prize', round(c.prize, 2),
    'player_bounty', round(c.bounty, 2),
    'rake', round(c.rake, 2),
    'guarantee', round(COALESCE(t.guaranteed_prize, 0), 2),
    'house_required', CASE WHEN COALESCE(t.guaranteed_prize, 0) > 0
                           THEN greatest(0, round(t.guaranteed_prize - c.gross, 2)) ELSE 0 END)
  FROM public.tournaments t
  JOIN public.tournament_escrow e ON e.tournament_id=t.id
  CROSS JOIN LATERAL (
    SELECT (cov->>'player_prize')::numeric AS prize, (cov->>'player_bounty')::numeric AS bounty,
           (cov->>'rake')::numeric AS rake, (cov->>'gross_collected')::numeric AS gross
      FROM (SELECT public.fn_ca_guarantee_coverage(t.id) AS cov) z) c
  WHERE t.id=p_tournament_id AND e.enforced
    AND (auth.role()='service_role' OR NOT coalesce(t.is_private,false)
         OR t.club_id IS NULL OR public.is_club_member(t.club_id,auth.uid())
         OR EXISTS (SELECT 1 FROM public.clubs c2 WHERE c2.id=t.club_id AND c2.owner_id=auth.uid()));
$function$;

-- ── 6. Over- and under-funding are detected, never silently repaired ────────
CREATE TABLE public.ca_guarantee_funding_variances(
  tournament_id uuid NOT NULL PRIMARY KEY,
  name text,
  guarantee numeric(18,2) NOT NULL,
  gross_collected numeric(18,2) NOT NULL,
  house_required numeric(18,2) NOT NULL,
  house_prize numeric(18,2) NOT NULL,
  variance numeric(18,2) NOT NULL,
  detail jsonb NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp());
COMMENT ON TABLE public.ca_guarantee_funding_variances IS
 'Finalized guaranteed events whose house/promo prize funding differs from H = max(0, G - C) (owner rule 2026-11-05). Positive variance = overfunded, negative = underfunded. Detection only: nothing here moves chips.';
ALTER TABLE public.ca_guarantee_funding_variances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_guarantee_funding_variances FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ca_guarantee_funding_variances TO service_role;

CREATE FUNCTION public.fn_ca_guarantee_funding_variance_scan(p_since timestamptz DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- Events that start after this rule shipped; earlier events were funded
  -- under the old floor and are reconciled in the change's own report.
  v_since timestamptz := COALESCE(p_since, '2026-11-05 22:01:20+00'::timestamptz);
  n integer;
BEGIN
  WITH cov AS (
    SELECT t.id, t.name, public.fn_ca_guarantee_coverage(t.id) AS c
      FROM public.tournaments t
     WHERE COALESCE(t.guaranteed_prize, 0) > 0
       AND COALESCE(t.prize_pool_finalized, false)
       AND COALESCE(t.variant, '') NOT IN ('satellite', 'spin')
       AND COALESCE(t.satellite_seats, 0) = 0
       AND t.start_time >= v_since
       AND t.start_time >= now() - interval '14 days')
  INSERT INTO public.ca_guarantee_funding_variances AS v
    (tournament_id, name, guarantee, gross_collected, house_required, house_prize, variance, detail)
  SELECT id, name, (c->>'guarantee')::numeric, (c->>'gross_collected')::numeric,
         (c->>'house_required')::numeric, (c->>'house_prize')::numeric, (c->>'variance')::numeric, c
    FROM cov
   WHERE abs((c->>'variance')::numeric) > 0.01
  ON CONFLICT (tournament_id) DO UPDATE
     SET variance = EXCLUDED.variance, house_prize = EXCLUDED.house_prize,
         house_required = EXCLUDED.house_required, gross_collected = EXCLUDED.gross_collected,
         detail = EXCLUDED.detail, last_seen_at = clock_timestamp();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_guarantee_funding_variance_scan(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_guarantee_funding_variance_scan(timestamptz) TO service_role;

-- periodic-work: the owner requires that a guarantee is never under- or over-funded (H = max(0, G - C)); this records any finalized guaranteed event whose house funding differs from H so it is seen within 15 minutes. Read-only toward money.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ca-guarantee-funding-variance-15m';
SELECT cron.schedule('ca-guarantee-funding-variance-15m', '7,22,37,52 * * * *',
  $c$SET statement_timeout = '60s'; SELECT public.fn_ca_guarantee_funding_variance_scan();$c$);

COMMIT;
