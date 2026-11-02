-- Supplemental isolated fixture: actual live guards and payout arithmetic.
CREATE ROLE postgres SUPERUSER;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations(version text);
INSERT INTO supabase_migrations.schema_migrations VALUES('20261102043648');
ALTER FUNCTION public.trg_freeze_finalized_tournament_prize_pool() OWNER TO postgres;
CREATE TABLE public.tournament_entry_close_receipts(tournament_id uuid,final_prize_pool numeric,payout_structure_snapshot jsonb,reprice_completed_at timestamptz,updated_at timestamptz);
CREATE TABLE public.tournament_satellite_settlement_batches(tournament_id uuid);
CREATE TABLE public.tournament_terminal_settlements(tournament_id uuid);
CREATE TABLE public.tournament_cancellation_receipts(tournament_id uuid);
CREATE OR REPLACE FUNCTION public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id uuid, p_table_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tournament_id uuid := p_tournament_id;
BEGIN
  -- Resolve the tournament before any lock, so G's mode can depend on it.
  -- tables.tournament_id is fixed for the life of a table: reading it here
  -- gives the answer reading it under G did.
  IF v_tournament_id IS NULL AND p_table_id IS NOT NULL THEN
    SELECT tb.tournament_id INTO v_tournament_id
    FROM public.tables tb
    WHERE tb.id = p_table_id;
  END IF;

  IF v_tournament_id IS NULL THEN
    -- Nothing to scope to: the whole lane, as it always was - G exclusive,
    -- then B exclusive (the shape of fn_ca_lock_settlement_lane_global).
    PERFORM pg_advisory_xact_lock(
      hashtextextended('ca:tournament-terminal-settlement:v1', 0));
    PERFORM pg_advisory_xact_lock(
      hashtextextended('ca:hand-settlement-barrier:v1', 0));
    RETURN;
  END IF;

  -- G SHARED: waits for, and excludes, terminal authorities (G exclusive)
  -- and nothing else. Rolling authorities of different tournaments run side
  -- by side; the trigger guards take T(id) held exclusively as their proof.
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('ca:tournament-terminal-settlement:v1', 0));

  -- T(id) EXCLUSIVE: one rolling authority per tournament at a time, and
  -- this tournament's hand settlements (T(id) shared) wait for it.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ca:tournament-terminal-settlement:v1:' || v_tournament_id::text, 0));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_ca_lock_settlement_lane_global()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Inside a non-satellite finish (2026-09-17) this transaction already
  -- holds that finish's lane: G shared, F exclusive, T(id) exclusive. The
  -- finish body and the settle functions still call this helper; re-enter
  -- the lane that is held instead of requesting G exclusively, which would
  -- be an upgrade of a shared hold (2026-09-10: no upgrades, they deadlock).
  IF COALESCE(current_setting('ca.finish_lane_tournament', true), '') <> '' THEN
    PERFORM public.fn_ca_lock_settlement_lane_for_finish(NULL);
    RETURN;
  END IF;
  -- G then B. Terminal / rare authorities: serialised against every other
  -- authority AND against every hand settlement, as on 2026-09-09.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ca:tournament-terminal-settlement:v1', 0));
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ca:hand-settlement-barrier:v1', 0));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_ca_prize_ladder(p_pool_cents bigint, p_entries jsonb, p_unit_cents integer DEFAULT 1)
 RETURNS TABLE(place integer, cents bigint)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_unit bigint;
  v_total_bp bigint;
  v_count integer;
  v_places integer[];
  v_bps bigint[];
  v_remaining bigint;
  v_share bigint;
  i integer;
BEGIN
  v_unit := CASE WHEN p_unit_cents IS NOT NULL AND p_unit_cents >= 1
                 THEN p_unit_cents::bigint ELSE 1 END;
  IF p_pool_cents IS NULL OR p_pool_cents <= 0
     OR p_entries IS NULL OR jsonb_typeof(p_entries) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_entries) = 0 THEN
    RETURN;
  END IF;

  SELECT array_agg((e->>'place')::integer ORDER BY (e->>'place')::integer),
         array_agg((e->>'bp')::bigint ORDER BY (e->>'place')::integer),
         COALESCE(sum((e->>'bp')::bigint), 0),
         count(*)
    INTO v_places, v_bps, v_total_bp, v_count
    FROM jsonb_array_elements(p_entries) e;
  IF v_total_bp <= 0 OR v_count = 0 THEN RETURN; END IF;

  -- THE SHORT FIELD. A pool holding fewer units than there are places pays the
  -- places it CAN, one unit each from the top. Left alone, every share below
  -- rounds to zero and the last place absorbs the pool as its "residual": the
  -- whole prize to the last finisher and nothing to the first. An indivisible
  -- unit cannot be split nine ways, and every other answer pays somebody more
  -- than the player who beat them.
  IF v_unit > 1 AND (p_pool_cents / v_unit) < v_count THEN
    FOR i IN 1..v_count LOOP
      place := v_places[i];
      cents := CASE WHEN i <= (p_pool_cents / v_unit) THEN v_unit ELSE 0 END;
      RETURN NEXT;
    END LOOP;
    RETURN;
  END IF;

  -- Spend down in place order; the LAST paid place takes whatever remains, so
  -- the places sum to the pool exactly rather than by hoping the rounding
  -- cancels, and the adjustment lands on the smallest prize.
  v_remaining := p_pool_cents;
  FOR i IN 1..v_count LOOP
    IF i = v_count THEN
      v_share := v_remaining;
    ELSE
      v_share := LEAST(v_remaining,
        (round(round((p_pool_cents::numeric * v_bps[i]::numeric) / v_total_bp::numeric)
               / v_unit::numeric) * v_unit)::bigint);
    END IF;
    v_share := GREATEST(v_share, 0);
    v_remaining := v_remaining - v_share;
    place := v_places[i];
    cents := v_share;
    RETURN NEXT;
  END LOOP;

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'prize ladder left % cents undistributed', v_remaining
      USING ERRCODE = '23514';
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_ca_prize_ladder_versioned(p_pool_cents bigint, p_entries jsonb, p_unit_cents integer, p_version integer)
 RETURNS TABLE(place integer, cents bigint)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_version=1 THEN
    RETURN QUERY SELECT l.place,l.cents FROM public.fn_ca_prize_ladder(p_pool_cents,p_entries,p_unit_cents) l;
  ELSIF p_version=2 THEN
    RETURN QUERY SELECT l.place,l.cents FROM public.fn_ca_prize_ladder_v2(p_pool_cents,p_entries,p_unit_cents) l;
  ELSE
    RAISE EXCEPTION 'Unsupported tournament payout math version' USING ERRCODE='22023';
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_ca_tournament_place_amounts(p_tournament_id uuid)
 RETURNS TABLE(place integer, amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_t record;
  v_pool numeric;
  v_ladder_pool numeric;
  v_bubble_amount numeric := 0;
  v_expected_pool numeric;
  v_pool_cents bigint;
  v_remaining bigint;
  v_share bigint;
  v_total_bp bigint := 0;
  v_bp bigint;
  v_field integer;
  v_struct jsonb;
  v_work jsonb := '[]'::jsonb;
  v_trimmed jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_place_numeric numeric;
  v_pct numeric;
  v_place integer;
  v_valid boolean := true;
  v_is_spin boolean;
  v_known_spin boolean := false;
  v_count integer;
  v_max_place integer;
  v_index integer := 0;
BEGIN
  IF p_tournament_id IS NULL THEN
    RAISE EXCEPTION 'place amount derivation requires a tournament id'
      USING ERRCODE = '22004';
  END IF;

  SELECT t.id, t.prize_pool, t.payout_structure, t.variant,
         t.tournament_type, t.is_premium_spin, t.spin_multiplier,
         t.buy_in_amount, t.satellite_target_id, t.satellite_target,
         t.bubble_protection,t.payout_math_version,t.payout_unit_cents
    INTO v_t FROM public.tournaments t
   WHERE t.id = p_tournament_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament % does not exist', p_tournament_id
      USING ERRCODE = 'P0002';
  END IF;
  IF lower(COALESCE(v_t.variant, '')) = 'satellite'
     OR upper(COALESCE(v_t.tournament_type, '')) = 'SATELLITE'
     OR v_t.satellite_target_id IS NOT NULL
     OR v_t.satellite_target IS NOT NULL THEN
    RAISE EXCEPTION 'tournament % is a satellite, not a cash ladder',
      p_tournament_id USING ERRCODE = '22023';
  END IF;

  IF v_t.payout_math_version=2 AND v_t.payout_unit_cents IS DISTINCT FROM public.fn_ca_tournament_unit_cents(p_tournament_id) THEN
    RAISE EXCEPTION 'Tournament denomination differs from its prize contract' USING ERRCODE='23514';
  END IF;
  v_pool := v_t.prize_pool;
  IF v_pool IS NULL
     OR v_pool::text IN ('NaN','Infinity','-Infinity')
     OR v_pool < 0
     OR v_pool IS DISTINCT FROM round(v_pool, 2) THEN
    RAISE EXCEPTION 'tournament % has invalid whole-cent prize pool %',
      p_tournament_id, v_pool USING ERRCODE = '22003';
  END IF;
  SELECT count(*) INTO v_field FROM public.tournament_players
   WHERE tournament_id = p_tournament_id;
  IF v_field < 1 THEN
    RAISE EXCEPTION 'tournament % has no roster', p_tournament_id
      USING ERRCODE = 'P0002';
  END IF;

  v_is_spin := lower(COALESCE(v_t.variant, '')) = 'spin'
               OR COALESCE(v_t.is_premium_spin, false)
               OR upper(COALESCE(v_t.tournament_type, '')) = 'SPIN';
  IF v_is_spin THEN
    IF v_t.spin_multiplier IS NULL
       OR v_t.spin_multiplier::text IN ('NaN','Infinity','-Infinity')
       OR v_t.spin_multiplier <= 0
       OR v_t.buy_in_amount IS NULL
       OR v_t.buy_in_amount::text IN ('NaN','Infinity','-Infinity')
       OR v_t.buy_in_amount < 0
       OR v_t.buy_in_amount IS DISTINCT FROM round(v_t.buy_in_amount, 2) THEN
      RAISE EXCEPTION 'Spin % has invalid locked buy-in/multiplier evidence',
        p_tournament_id USING ERRCODE = '22003';
    END IF;
    v_expected_pool := round(v_t.buy_in_amount * v_t.spin_multiplier, 2);
    IF v_expected_pool::text IN ('NaN','Infinity','-Infinity')
       OR v_pool IS DISTINCT FROM v_expected_pool THEN
      RAISE EXCEPTION
        'Spin % pool % does not equal buy-in % x multiplier % (= %)',
        p_tournament_id, v_pool, v_t.buy_in_amount, v_t.spin_multiplier,
        v_expected_pool USING ERRCODE = '23514';
    END IF;

    IF v_t.spin_multiplier IN (2,3,4,5) THEN
      v_struct := '[{"place":1,"percentage":100}]'::jsonb;
      v_known_spin := true;
    ELSIF v_t.spin_multiplier = 10 THEN
      v_struct := '[{"place":1,"percentage":80},{"place":2,"percentage":20}]'::jsonb;
      v_known_spin := true;
    ELSIF v_t.spin_multiplier IN (25,50,100) THEN
      v_struct := '[{"place":1,"percentage":80},{"place":2,"percentage":12},{"place":3,"percentage":8}]'::jsonb;
      v_known_spin := true;
    END IF;
  END IF;

  -- Unknown/retired Spin multipliers and non-Spins read the stored structure.
  IF NOT v_known_spin THEN
    BEGIN
      v_struct := NULLIF(btrim(COALESCE(v_t.payout_structure::text, '')), '')::jsonb;
    EXCEPTION WHEN invalid_text_representation THEN
      v_struct := NULL;
    END;
  END IF;
  IF v_struct IS NULL OR jsonb_typeof(v_struct) <> 'array'
     OR jsonb_array_length(v_struct) = 0 THEN
    v_valid := false;
  END IF;

  -- Fractional places and non-finite/non-positive shares fail this candidate.
  -- As in computePlacePrize, the first entry for a duplicate place wins.
  IF v_valid THEN
    FOR v_entry IN SELECT value FROM jsonb_array_elements(v_struct) LOOP
      IF jsonb_typeof(v_entry) <> 'object'
         OR v_entry->>'place' IS NULL
         OR v_entry->>'percentage' IS NULL THEN
        v_valid := false; EXIT;
      END IF;
      BEGIN
        v_place_numeric := (v_entry->>'place')::numeric;
        v_pct := (v_entry->>'percentage')::numeric;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        v_valid := false; EXIT;
      END;
      IF v_place_numeric::text IN ('NaN','Infinity','-Infinity')
         OR v_pct::text IN ('NaN','Infinity','-Infinity')
         OR v_place_numeric < 1 OR v_place_numeric <> trunc(v_place_numeric)
         OR v_place_numeric > 2147483647 OR v_pct <= 0 THEN
        v_valid := false; EXIT;
      END IF;
      IF v_t.payout_math_version=2 AND
         (v_pct>100 OR v_pct<>round(v_pct,2) OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_work) e WHERE (e->>'place')::numeric=v_place_numeric
         )) THEN
        RAISE EXCEPTION 'Version 2 requires unique whole-hundredth payout shares' USING ERRCODE='22023';
      END IF;
      v_place := v_place_numeric::integer;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_work) e
                  WHERE (e->>'place')::integer = v_place) THEN
        CONTINUE;
      END IF;
      BEGIN
        v_bp := round(v_pct * 100)::bigint;
      EXCEPTION WHEN numeric_value_out_of_range THEN
        v_valid := false; EXIT;
      END;
      IF v_bp <= 0 THEN
        v_valid := false; EXIT;
      END IF;
      v_work := v_work || jsonb_build_object('place',v_place,'bp',v_bp);
    END LOOP;
  END IF;
  IF v_valid AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_work) e
     WHERE (e->>'place')::integer = 1
  ) THEN
    v_valid := false;
  END IF;

  IF NOT v_valid THEN
    RAISE EXCEPTION
      'tournament % has no usable canonical payout ladder',
      p_tournament_id USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'place')::integer),'[]'::jsonb)
    INTO v_trimmed FROM jsonb_array_elements(v_work) e
   WHERE (e->>'place')::integer <= v_field;
  IF jsonb_array_length(v_trimmed) = 0 THEN
    RAISE EXCEPTION 'tournament % ladder has no place in final field %',
      p_tournament_id, v_field USING ERRCODE = '22023';
  END IF;
  SELECT count(*), COALESCE(sum((e->>'bp')::bigint),0)
    INTO v_count, v_total_bp FROM jsonb_array_elements(v_trimmed) e;
  IF v_total_bp <= 0 THEN
    RAISE EXCEPTION 'tournament % ladder has no positive percentage',
      p_tournament_id USING ERRCODE = '22023';
  END IF;

  SELECT max((e->>'place')::integer)
    INTO v_max_place
    FROM jsonb_array_elements(v_trimmed) e;

  -- Bubble protection is part of the tournament pool, not a house overlay.
  -- When the final field contains a stone bubble, reserve exactly one base
  -- buy-in before pricing the percentage ladder. The bubble and all places
  -- therefore spend the locked prize_pool exactly once between them.
  IF COALESCE(v_t.bubble_protection, false) AND v_field > v_max_place THEN
    IF v_t.buy_in_amount IS NULL
       OR v_t.buy_in_amount::text IN ('NaN','Infinity','-Infinity')
       OR v_t.buy_in_amount <= 0
       OR v_t.buy_in_amount IS DISTINCT FROM round(v_t.buy_in_amount, 2) THEN
      RAISE EXCEPTION
        'tournament % has bubble protection but invalid whole-cent buy-in %',
        p_tournament_id, v_t.buy_in_amount USING ERRCODE = '22003';
    END IF;
    v_bubble_amount := round(v_t.buy_in_amount, 2);
    IF v_bubble_amount > v_pool THEN
      RAISE EXCEPTION
        'tournament % bubble amount % exceeds locked prize pool %',
        p_tournament_id, v_bubble_amount, v_pool USING ERRCODE = '23514';
    END IF;
  END IF;

  v_ladder_pool := round(v_pool - v_bubble_amount, 2);
  v_pool_cents := round(v_ladder_pool * 100)::bigint;

  -- Mirror computePlacePrize: normalize to surviving basis points, spend down
  -- in place order, and give the exact remaining cents to the last place.
  v_remaining := v_pool_cents;
  FOR v_entry IN
    SELECT jsonb_build_object('place', l.place, 'cents', l.cents)
      FROM public.fn_ca_prize_ladder_versioned(
             v_pool_cents,
             v_trimmed,
             public.fn_ca_tournament_unit_cents(p_tournament_id),v_t.payout_math_version) l
     ORDER BY l.place
  LOOP
    v_index := v_index + 1;
    v_place := (v_entry->>'place')::integer;
    v_share := (v_entry->>'cents')::bigint;
    v_remaining := v_remaining - v_share;
    place := v_place;
    amount := (v_share::numeric / 100)::numeric(15,2);
    IF amount::text IN ('NaN','Infinity','-Infinity')
       OR amount < 0 OR amount IS DISTINCT FROM round(amount,2) THEN
      RAISE EXCEPTION 'derived invalid amount % for tournament %, place %',
        amount, p_tournament_id, place USING ERRCODE = '22003';
    END IF;
    RETURN NEXT;
  END LOOP;
  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'tournament % ladder left % cents undistributed',
      p_tournament_id, v_remaining USING ERRCODE = '23514';
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_ca_tournament_unit_cents(p_tournament_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.tournaments t
      JOIN public.clubs c ON c.id = t.club_id
     WHERE t.id = p_tournament_id
       AND c.asset = 'diamonds' AND c.is_platform IS TRUE AND c.union_id IS NULL
  ) THEN 100 ELSE 1 END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_tournament_payout_key_is_place_evidence(p_tournament_id uuid, p_idempotency_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.tournament_obligations o
     WHERE o.tournament_id = p_tournament_id
       AND o.kind = 'place'
       AND p_idempotency_key LIKE
           'tourney:' || p_tournament_id::text || ':obl:' || o.id::text || ':%'
  );
$function$
;

INSERT INTO clubs(id,asset) VALUES('fade0000-0000-0000-0000-000000000001','chips');
INSERT INTO union_wallets(union_id,chip_balance) VALUES('fade0000-0000-0000-0000-000000000001',100000);
INSERT INTO tournaments(id,club_id,union_id,name,status,prize_pool,guaranteed_prize,bounty_pool,variant,buy_in_amount,buy_in_fee,bounty_amount,total_rake,prize_pool_finalized,payout_structure,payout_math_version,payout_unit_cents)
VALUES('6b72abc3-bd16-488c-aea5-54b1eace98d5','fade0000-0000-0000-0000-000000000001','fade0000-0000-0000-0000-000000000001','Bounty fixture','RUNNING',5000,5000,950,'bounty',36,4,10,380,true,'[{"place":1,"percentage":23.74},{"place":2,"percentage":13.63},{"place":3,"percentage":9.86},{"place":4,"percentage":7.83},{"place":5,"percentage":6.55},{"place":6,"percentage":5.66},{"place":7,"percentage":5},{"place":8,"percentage":4.5},{"place":9,"percentage":4.09},{"place":10,"percentage":3.76},{"place":11,"percentage":3.49},{"place":12,"percentage":3.25},{"place":13,"percentage":3.05},{"place":14,"percentage":2.87},{"place":15,"percentage":2.72}]',1,1);
INSERT INTO tournament_players(id,tournament_id,user_id,position,status,prize)
SELECT md5('roster:'||i)::uuid,'6b72abc3-bd16-488c-aea5-54b1eace98d5',md5('user:'||i)::uuid,i,
CASE WHEN i<=13 THEN 'playing' ELSE 'eliminated' END,CASE i WHEN 15 THEN 136 WHEN 14 THEN 143.5 ELSE 0 END FROM generate_series(1,95)i;
INSERT INTO tournament_payouts(tournament_id,user_id,position,amount,source,idempotency_key)
SELECT tournament_id,user_id,position,prize,'structure','paid:'||position FROM tournament_players WHERE position IN(14,15);
INSERT INTO tournament_obligations(tournament_id,user_id,place,amount_owed,amount_paid,kind)
SELECT tournament_id,user_id,position,prize,prize,'place' FROM tournament_players WHERE position IN(14,15);
INSERT INTO tournament_escrow(tournament_id,enforced,gross_in,fee_entries_in,satellite_fee_in,bounty_in,prize_out,prize_balance,bounty_balance,fee_balance,closed_at,terminal_closed_at)
VALUES('6b72abc3-bd16-488c-aea5-54b1eace98d5',true,3796,376,4,950,279.5,2190.5,950,380,NULL,NULL);
INSERT INTO chip_ledger(id,tournament_id,category,amount,from_type,from_entity_id,to_type,to_entity_id)
VALUES('579ab0ec-a7c8-4752-b65f-2544415918c0','6b72abc3-bd16-488c-aea5-54b1eace98d5','overlay',4896,'union_bank','fade0000-0000-0000-0000-000000000001','prize_liability','6b72abc3-bd16-488c-aea5-54b1eace98d5'),
('dec229a8-7753-4a20-b3c4-5efa1eacae43','6b72abc3-bd16-488c-aea5-54b1eace98d5','reversal',2366,'prize_liability','6b72abc3-bd16-488c-aea5-54b1eace98d5','union_bank','fade0000-0000-0000-0000-000000000001');
SELECT fn_ca_escrow_apply('6b72abc3-bd16-488c-aea5-54b1eace98d5','prior return',p_overlay_in=>-2366);
INSERT INTO tournament_entry_close_receipts VALUES('6b72abc3-bd16-488c-aea5-54b1eace98d5',5000,'[{"place":1,"percentage":23.74},{"place":2,"percentage":13.63},{"place":3,"percentage":9.86},{"place":4,"percentage":7.83},{"place":5,"percentage":6.55},{"place":6,"percentage":5.66},{"place":7,"percentage":5},{"place":8,"percentage":4.5},{"place":9,"percentage":4.09},{"place":10,"percentage":3.76},{"place":11,"percentage":3.49},{"place":12,"percentage":3.25},{"place":13,"percentage":3.05},{"place":14,"percentage":2.87},{"place":15,"percentage":2.72}]',now(),now());
CREATE TRIGGER exact_finalized_guard BEFORE UPDATE ON tournaments FOR EACH ROW EXECUTE FUNCTION trg_freeze_finalized_tournament_prize_pool();
CREATE TRIGGER exact_managed_guard BEFORE UPDATE ON tournaments FOR EACH ROW EXECUTE FUNCTION fn_guard_managed_game_lifecycle();

