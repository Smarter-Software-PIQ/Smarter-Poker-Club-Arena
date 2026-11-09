-- SUPERSEDED BY 20261109064934
-- THE BBJ PROMO SWEEP LABEL STATES THE ALLOCATION ACTUALLY USED (2026-11-08)
--
-- On 2026-11-08 Dan set the Midway Union BBJ pool allocation to 5% main /
-- 20% backup / 75% promo in ca_bbj_pool_policy (pool
-- f9806a7f-e7a2-47d2-a676-36336e3a5337, updated_at
-- 2026-11-08 21:43:21.501583+00). The allocator (fn_bbj_allocate) reads
-- ca_bbj_pool_policy directly, so every contribution since that moment has
-- split 5 / 20 / 75 with zero residue lost.
--
-- However, fn_sweep_bbj_promo_all() still wrote a hardcoded string on every
-- union sweep row in union_wallet_transactions:
--   'BBJ promo slice (25% of contribution) swept from pool'
-- That string has been stale for Midway Union since 2026-10-23 (when
-- migrations 20261023024134 / 20261023030641 moved Midway Union to 10/30/60)
-- and whenever the pool previously crossed the 100k pivot (25/25/50).
--
-- A percentage in a ledger note is a statement about which policy governed the
-- contribution window being swept. Rounding the realized ratio of a window or
-- matching a known split by tolerance alone can show consistency, but cannot
-- identify which rule was in force unless the period is bound to authoritative
-- migration or policy evidence for that pool.
--
-- Therefore:
--   1. public.ca_bbj_rate_periods records each pool's single-rate effective
--      period and its authoritative evidence (migration version or policy row
--      timestamp). Periods under the two-regime 100k pivot where historical
--      per-hand main_balance snapshots do not exist are intentionally omitted:
--      neither 25% nor 50% can be proven as the governing policy for an
--      arbitrary pre-October window without the pool balance at each hand.
--   2. public.fn_bbj_promo_window_share(p_pool_id, p_since, p_until) returns a
--      percentage ONLY when:
--        (a) p_since is known (not the pool's very first sweep),
--        (b) a single authoritative rate governs the entire window (either
--            exactly one row in ca_bbj_rate_periods covers [p_since, p_until],
--            or the pool's current flat-rate row in ca_bbj_pool_policy has
--            updated_at <= p_since),
--        (c) the window in bbj_contributions has total drop >= 5.00 so 0.01
--            chip rounding noise across a handful of hands cannot masquerade as
--            rate drift or agreement,
--        (d) when both temporal halves of the window carry contributions, their
--            realized promo shares agree within 0.5 percentage points, and
--        (e) the window's realized main share ((drop - backup - promo) / drop,
--            computed from the three columns in idx_bbj_contrib_pool_facts so
--            every lookup stays an index-only scan) and realized backup share
--            (backup / drop) each agree with the governing policy's main_rate
--            and backup_rate within 0.05 percentage points.
--      The returned number is (1 - main_rate - backup_rate) * 100 from the
--      governing policy - never a rounded empirical ratio.
--   3. When any condition is not met (first sweep, pre-October pivot era with
--      no single-rate period evidence, straddling a rate change, drop < 5.00,
--      or an anomalous window), fn_bbj_promo_window_share returns NULL and
--      fn_bbj_sweep_note writes neutral wording:
--        'BBJ promo slice swept from pool'
--   4. Existing union_wallet_transactions rows of tx_type = 'bbj_promo_sweep'
--      have their notes updated in place under the same proof rule. No amount,
--      balance_after, direction, wallet, union_id, club_id, created_at, or
--      transaction identity is touched.
--
-- -- @live-proof: SELECT count(*) FILTER (WHERE notes LIKE '%25\%%' ESCAPE '\') AS stale_25, count(*) FILTER (WHERE notes LIKE '%(60% of contribution)%') AS pct_60, count(*) FILTER (WHERE notes LIKE '%(75% of contribution)%') AS pct_75, count(*) FILTER (WHERE notes = 'BBJ promo slice swept from pool') AS neutral FROM public.union_wallet_transactions WHERE tx_type = 'bbj_promo_sweep';

BEGIN;

CREATE TABLE IF NOT EXISTS public.ca_bbj_rate_periods (
  pool_id uuid NOT NULL REFERENCES public.bbj_pools(id) ON DELETE CASCADE,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  main_rate numeric NOT NULL,
  backup_rate numeric NOT NULL,
  evidence text NOT NULL,
  PRIMARY KEY (pool_id, effective_from),
  CONSTRAINT ca_bbj_rate_periods_rates_sane CHECK (
    main_rate >= 0 AND backup_rate >= 0 AND main_rate + backup_rate <= 1
  ),
  CONSTRAINT ca_bbj_rate_periods_window_sane CHECK (
    effective_to IS NULL OR effective_to > effective_from
  )
);

CREATE INDEX IF NOT EXISTS idx_ca_bbj_rate_periods_pool
  ON public.ca_bbj_rate_periods (pool_id, effective_from, effective_to);

ALTER TABLE public.ca_bbj_rate_periods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ca_bbj_rate_periods FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ca_bbj_rate_periods TO service_role;

COMMENT ON TABLE public.ca_bbj_rate_periods IS
  'Authoritative single-rate BBJ allocation periods per pool. Each row binds a pool and effective window [effective_from, effective_to) to the migration or ca_bbj_pool_policy change that established main_rate and backup_rate. Read by fn_bbj_promo_window_share so sweep notes state a percentage only when a single evidenced policy governed the contribution window and the realized shares agree with it.';

INSERT INTO public.ca_bbj_rate_periods (
  pool_id, effective_from, effective_to, main_rate, backup_rate, evidence
)
SELECT bp.id,
       v.effective_from,
       v.effective_to,
       v.main_rate,
       v.backup_rate,
       v.evidence
  FROM public.bbj_pools bp
  CROSS JOIN (
    VALUES
      (
        '2026-10-23 02:42:45+00'::timestamptz,
        '2026-11-08 21:43:21.501583+00'::timestamptz,
        0.10::numeric,
        0.30::numeric,
        'migrations 20261023024134, 20261023030641 (Midway Union 10/30/60)'
      ),
      (
        '2026-11-08 21:43:21.501583+00'::timestamptz,
        NULL::timestamptz,
        0.05::numeric,
        0.20::numeric,
        'ca_bbj_pool_policy @ 2026-11-08 21:43:21.501583+00 (Midway Union 5/20/75)'
      )
  ) AS v(effective_from, effective_to, main_rate, backup_rate, evidence)
 WHERE bp.id = 'f9806a7f-e7a2-47d2-a676-36336e3a5337'
ON CONFLICT (pool_id, effective_from) DO UPDATE
   SET effective_to = EXCLUDED.effective_to,
       main_rate = EXCLUDED.main_rate,
       backup_rate = EXCLUDED.backup_rate,
       evidence = EXCLUDED.evidence;

CREATE OR REPLACE FUNCTION public.fn_bbj_promo_window_share(
  p_pool_id uuid,
  p_since timestamptz,
  p_until timestamptz
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_periods int;
  v_main_rate numeric;
  v_backup_rate numeric;
  v_mid timestamptz;
  v_d numeric;
  v_b numeric;
  v_p numeric;
  v_d1 numeric;
  v_p1 numeric;
  v_d2 numeric;
  v_p2 numeric;
BEGIN
  IF p_pool_id IS NULL OR p_since IS NULL OR p_until IS NULL OR p_until <= p_since THEN
    RETURN NULL;
  END IF;

  SELECT count(*), max(rp.main_rate), max(rp.backup_rate)
    INTO v_periods, v_main_rate, v_backup_rate
    FROM public.ca_bbj_rate_periods rp
   WHERE rp.pool_id = p_pool_id
     AND rp.effective_from <= p_since
     AND (rp.effective_to IS NULL OR rp.effective_to >= p_until);

  -- Fallback to the live flat-rate policy row when it predates p_since and is
  -- not split across a pivot threshold.
  IF v_periods = 0 THEN
    SELECT count(*), max(pp.standard_main), max(pp.standard_backup)
      INTO v_periods, v_main_rate, v_backup_rate
      FROM public.ca_bbj_pool_policy pp
     WHERE pp.pool_id = p_pool_id
       AND pp.updated_at <= p_since
       AND pp.standard_main = pp.pivot_main
       AND pp.standard_backup = pp.pivot_backup;
  END IF;

  IF v_periods <> 1 THEN
    RETURN NULL;
  END IF;

  v_mid := p_since + (p_until - p_since) / 2;

  SELECT sum(bc.amount),
         sum(bc.backup_portion),
         sum(bc.promo_portion),
         sum(bc.amount) FILTER (WHERE bc.created_at <= v_mid),
         sum(bc.promo_portion) FILTER (WHERE bc.created_at <= v_mid),
         sum(bc.amount) FILTER (WHERE bc.created_at > v_mid),
         sum(bc.promo_portion) FILTER (WHERE bc.created_at > v_mid)
    INTO v_d, v_b, v_p, v_d1, v_p1, v_d2, v_p2
    FROM public.bbj_contributions bc
   WHERE bc.pool_id = p_pool_id
     AND bc.created_at > p_since
     AND bc.created_at <= p_until;

  IF COALESCE(v_d, 0) < 5.00 THEN
    RETURN NULL;
  END IF;

  IF COALESCE(v_d1, 0) > 0 AND COALESCE(v_d2, 0) > 0 THEN
    IF abs((v_p1 / v_d1) - (v_p2 / v_d2)) * 100 > 0.5 THEN
      RETURN NULL;
    END IF;
  END IF;

  IF abs(((v_d - v_b - v_p) / v_d) * 100 - (v_main_rate * 100)) > 0.05 THEN
    RETURN NULL;
  END IF;

  IF abs((v_b / v_d) * 100 - (v_backup_rate * 100)) > 0.05 THEN
    RETURN NULL;
  END IF;

  RETURN round((1 - v_main_rate - v_backup_rate) * 100, 2);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_bbj_last_promo_sweep_at(
  p_union_id uuid,
  p_club_id uuid
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_union_id IS NOT NULL THEN (
      SELECT max(uwt.created_at)
        FROM public.union_wallet_transactions uwt
       WHERE uwt.union_id = p_union_id
         AND uwt.tx_type = 'bbj_promo_sweep'
         AND uwt.club_id IS NOT DISTINCT FROM p_club_id
    )
    WHEN p_club_id IS NOT NULL THEN (
      SELECT max(ct.created_at)
        FROM public.chip_transactions ct
       WHERE ct.club_id = p_club_id
         AND ct.transaction_type = 'bbj_promo_sweep'
    )
    ELSE NULL
  END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_bbj_sweep_note(
  p_pct numeric,
  p_suffix text DEFAULT ''
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_pct IS NULL THEN
      'BBJ promo slice swept from pool' || COALESCE(p_suffix, '')
    ELSE
      format(
        'BBJ promo slice (%s%% of contribution) swept from pool%s',
        trim(trailing '.' from trim(trailing '0' from round(p_pct, 2)::text)),
        COALESCE(p_suffix, '')
      )
  END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_sweep_bbj_promo(p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_promo numeric; v_pool_id uuid; v_union_id uuid; v_dest text; v_after numeric;
  v_now timestamptz; v_since timestamptz; v_pct numeric; v_note text;
BEGIN
  SELECT c.union_id INTO v_union_id FROM clubs c WHERE c.id = p_club_id;

  SELECT bp.id, COALESCE(bp.promo_balance, 0) INTO v_pool_id, v_promo
    FROM bbj_pools bp
   WHERE bp.status = 'active'
     AND ((v_union_id IS NOT NULL AND bp.union_id = v_union_id)
       OR (v_union_id IS NULL AND bp.club_id = p_club_id))
   ORDER BY (bp.union_id IS NOT NULL) DESC
   LIMIT 1
   FOR UPDATE;

  IF v_pool_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no bbj pool for club');
  END IF;
  IF v_promo <= 0 THEN
    RETURN jsonb_build_object('success', true, 'swept', 0, 'note', 'nothing to sweep');
  END IF;

  v_now := NOW();
  v_since := public.fn_bbj_last_promo_sweep_at(v_union_id, p_club_id);
  v_pct := public.fn_bbj_promo_window_share(v_pool_id, v_since, v_now);

  -- CHIP STANDARD 1.3 (2026-09-02): THE SWEEP JOURNALS BOTH SIDES IN ONE ROW.
  -- The pool debit below is journaled by the bbj_pools autoledger as
  -- promo bbj_pool -> union_wallet (the union's promo_wallet) or -> promo_wallet
  -- (the club's promo_balance). The credit side is autoskipped so the same move is
  -- not journaled a second time through settlement_suspense (R9); the skip is
  -- cleared right after the credit. A failure branch that puts the balance back is
  -- journaled by the same declaration, in reverse.
  PERFORM public.fn_ca_declare_ledger('promo',
    CASE WHEN v_union_id IS NOT NULL THEN 'union_wallet' ELSE 'promo_wallet' END,
    COALESCE(v_union_id, p_club_id), NULL, NULL, ARRAY['union_wallets', 'clubs']);
  UPDATE bbj_pools SET promo_balance = 0, updated_at = v_now WHERE id = v_pool_id;

  IF v_union_id IS NOT NULL THEN
    INSERT INTO union_wallets (union_id, promo_wallet)
    VALUES (v_union_id, v_promo)
    ON CONFLICT (union_id) DO UPDATE
      SET promo_wallet = COALESCE(union_wallets.promo_wallet, 0) + EXCLUDED.promo_wallet
    RETURNING promo_wallet INTO v_after;
    PERFORM set_config('app.ledger_autoskip_union_wallets', '', true);
    PERFORM set_config('app.ledger_autoskip_clubs', '', true);

    IF v_after IS NULL THEN
      UPDATE bbj_pools SET promo_balance = v_promo WHERE id = v_pool_id;
      RETURN jsonb_build_object('success', false, 'error', 'union wallet credit failed');
    END IF;

    UPDATE unions
       SET promo_funded_from_bbj = COALESCE(promo_funded_from_bbj, 0) + v_promo,
           updated_at = v_now
     WHERE id = v_union_id;

    v_note := public.fn_bbj_sweep_note(v_pct, ' (single-club sweep)');

    INSERT INTO union_wallet_transactions
      (union_id, club_id, wallet, direction, amount, balance_after, tx_type, notes)
    VALUES
      (v_union_id, p_club_id, 'promo_wallet', 'credit', v_promo, v_after,
       'bbj_promo_sweep', v_note);

    v_dest := 'union';
  ELSE
    UPDATE clubs
       SET promo_balance = COALESCE(promo_balance, 0) + v_promo, updated_at = v_now
     WHERE id = p_club_id
    RETURNING promo_balance INTO v_after;
    PERFORM set_config('app.ledger_autoskip_union_wallets', '', true);
    PERFORM set_config('app.ledger_autoskip_clubs', '', true);
    v_dest := 'club';

    v_note := CASE
      WHEN v_pct IS NULL THEN 'BBJ promo slice swept to club promo wallet (club has no union)'
      ELSE format(
        'BBJ promo slice (%s%% of contribution) swept to club promo wallet (club has no union)',
        trim(trailing '.' from trim(trailing '0' from round(v_pct, 2)::text))
      )
    END;

    INSERT INTO chip_transactions (
      id, club_id, from_user_id, to_user_id, amount,
      transaction_type, notes, balance_after, created_at
    ) VALUES (
      gen_random_uuid(), p_club_id, NULL, NULL, v_promo,
      'bbj_promo_sweep',
      v_note,
      v_after, v_now
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'swept', v_promo,
                            'destination', v_dest, 'balance_after', v_after,
                            'promo_share_pct', v_pct);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_sweep_bbj_promo_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r record; v_promo numeric; v_union_id uuid; v_after numeric;
  v_swept numeric := 0; v_pools int := 0; v_to_union int := 0; v_to_club int := 0; v_err int := 0;
  v_busy int := 0; v_unlabelled int := 0;
  v_now timestamptz; v_since timestamptz; v_pct numeric; v_note text;
BEGIN
  FOR r IN SELECT id, club_id, union_id FROM bbj_pools
            WHERE COALESCE(promo_balance,0) > 0 ORDER BY id
  LOOP
    BEGIN
      -- NEVER WAIT WHILE HOLDING A POOL (20261015094402). The hand path
      -- writes union_wallets / clubs (rake) before it locks the pool (BBJ);
      -- this sweep used the opposite order and deadlocked with it. Every row
      -- is taken here with NOWAIT, wallet side first and the pool last, so a
      -- busy row rolls this pool's sub-transaction back and the promo stays
      -- in the pool for the next run. The amount and its destination do not
      -- change.
      v_union_id := r.union_id;
      IF v_union_id IS NULL AND r.club_id IS NOT NULL THEN
        SELECT union_id INTO v_union_id FROM clubs WHERE id = r.club_id;
      END IF;
      IF v_union_id IS NOT NULL THEN
        PERFORM 1 FROM union_wallets WHERE union_id = v_union_id FOR NO KEY UPDATE NOWAIT;
        PERFORM 1 FROM unions WHERE id = v_union_id FOR NO KEY UPDATE NOWAIT;
        IF r.club_id IS NOT NULL THEN
          PERFORM 1 FROM clubs WHERE id = r.club_id FOR KEY SHARE NOWAIT;
        END IF;
      ELSIF r.club_id IS NOT NULL THEN
        PERFORM 1 FROM clubs WHERE id = r.club_id FOR NO KEY UPDATE NOWAIT;
      END IF;
      SELECT COALESCE(promo_balance,0) INTO v_promo FROM bbj_pools WHERE id=r.id FOR UPDATE NOWAIT;
      IF v_promo <= 0 THEN CONTINUE; END IF;

      v_now := NOW();
      v_since := public.fn_bbj_last_promo_sweep_at(v_union_id, r.club_id);
      v_pct := public.fn_bbj_promo_window_share(r.id, v_since, v_now);

      -- CHIP STANDARD 1.3 (2026-09-02): one declared row per sweep, both sides named
      -- (see fn_sweep_bbj_promo). Inside the per-pool sub-transaction: an exception
      -- reverts the settings along with the writes.
      PERFORM public.fn_ca_declare_ledger('promo',
        CASE WHEN v_union_id IS NOT NULL THEN 'union_wallet' ELSE 'promo_wallet' END,
        COALESCE(v_union_id, r.club_id), NULL, NULL, ARRAY['union_wallets', 'clubs']);
      UPDATE bbj_pools SET promo_balance = 0, updated_at = v_now WHERE id = r.id;

      IF v_union_id IS NOT NULL THEN
        INSERT INTO union_wallets (union_id, promo_wallet) VALUES (v_union_id, v_promo)
        ON CONFLICT (union_id) DO UPDATE
          SET promo_wallet = COALESCE(union_wallets.promo_wallet,0) + EXCLUDED.promo_wallet
        RETURNING promo_wallet INTO v_after;
        PERFORM set_config('app.ledger_autoskip_union_wallets', '', true);
        PERFORM set_config('app.ledger_autoskip_clubs', '', true);

        IF v_after IS NULL THEN
          UPDATE bbj_pools SET promo_balance = v_promo WHERE id = r.id;
          v_err := v_err + 1; CONTINUE;
        END IF;

        UPDATE unions SET promo_funded_from_bbj = COALESCE(promo_funded_from_bbj,0) + v_promo,
                          updated_at = v_now
         WHERE id = v_union_id;

        v_note := public.fn_bbj_sweep_note(v_pct);

        INSERT INTO union_wallet_transactions
          (id, union_id, wallet, direction, amount, balance_after, tx_type, club_id, notes, created_at)
        VALUES (gen_random_uuid(), v_union_id, 'promo_wallet', 'credit', v_promo, v_after,
                'bbj_promo_sweep', r.club_id, v_note, v_now);
        v_to_union := v_to_union + 1;

      ELSIF r.club_id IS NOT NULL THEN
        UPDATE clubs SET promo_balance = COALESCE(promo_balance,0) + v_promo, updated_at = v_now
         WHERE id = r.club_id RETURNING promo_balance INTO v_after;
        PERFORM set_config('app.ledger_autoskip_union_wallets', '', true);
        PERFORM set_config('app.ledger_autoskip_clubs', '', true);
        IF v_after IS NULL THEN
          UPDATE bbj_pools SET promo_balance = v_promo WHERE id = r.id;
          v_err := v_err + 1; CONTINUE;
        END IF;

        v_note := CASE
          WHEN v_pct IS NULL THEN 'BBJ promo slice swept to club promo wallet (club has no union)'
          ELSE format(
            'BBJ promo slice (%s%% of contribution) swept to club promo wallet (club has no union)',
            trim(trailing '.' from trim(trailing '0' from round(v_pct, 2)::text))
          )
        END;

        INSERT INTO chip_transactions (id, club_id, from_user_id, to_user_id, amount,
                                       transaction_type, notes, balance_after, created_at)
        VALUES (gen_random_uuid(), r.club_id, NULL, NULL, v_promo, 'bbj_promo_sweep',
                v_note, v_after, v_now);
        v_to_club := v_to_club + 1;
      ELSE
        UPDATE bbj_pools SET promo_balance = v_promo WHERE id = r.id;
        v_err := v_err + 1; CONTINUE;
      END IF;

      IF v_pct IS NULL THEN
        v_unlabelled := v_unlabelled + 1;
      END IF;
      v_swept := v_swept + v_promo; v_pools := v_pools + 1;
    EXCEPTION
      WHEN lock_not_available THEN v_busy := v_busy + 1;
      WHEN OTHERS THEN v_err := v_err + 1;
    END;
  END LOOP;
  PERFORM set_config('app.ledger_autoskip_union_wallets', '', true);
  PERFORM set_config('app.ledger_autoskip_clubs', '', true);

  RETURN jsonb_build_object('success', true, 'pools_swept', v_pools, 'total_swept', v_swept,
                            'to_union', v_to_union, 'to_club', v_to_club, 'errors', v_err,
                            'busy_retry_next_run', v_busy, 'unlabelled', v_unlabelled);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_bbj_promo_window_share(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bbj_promo_window_share(uuid, timestamptz, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.fn_bbj_last_promo_sweep_at(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bbj_last_promo_sweep_at(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.fn_bbj_sweep_note(numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bbj_sweep_note(numeric, text) TO service_role;

REVOKE ALL ON FUNCTION public.fn_sweep_bbj_promo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sweep_bbj_promo(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.fn_sweep_bbj_promo_all() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sweep_bbj_promo_all() TO service_role;

DO $hist$
DECLARE
  v_stale_25 int;
BEGIN
  CREATE TEMP TABLE ca_bbj_sweep_wording ON COMMIT DROP AS
  WITH sweeps AS (
    SELECT uwt.id,
           uwt.union_id,
           uwt.club_id,
           uwt.notes AS old_notes,
           uwt.created_at AS until_at,
           lag(uwt.created_at) OVER (
             PARTITION BY uwt.union_id, uwt.club_id
             ORDER BY uwt.created_at, uwt.id
           ) AS since_at,
           bp.id AS pool_id
      FROM public.union_wallet_transactions uwt
      LEFT JOIN public.clubs c ON c.id = uwt.club_id
      LEFT JOIN LATERAL (
        SELECT bp1.id
          FROM public.bbj_pools bp1
         WHERE bp1.status = 'active'
           AND ((COALESCE(uwt.union_id, c.union_id) IS NOT NULL
                 AND bp1.union_id = COALESCE(uwt.union_id, c.union_id))
             OR (COALESCE(uwt.union_id, c.union_id) IS NULL
                 AND bp1.club_id = uwt.club_id))
         ORDER BY (bp1.union_id IS NOT NULL) DESC
         LIMIT 1
      ) bp ON true
     WHERE uwt.tx_type = 'bbj_promo_sweep'
  )
  SELECT s.id,
         s.pool_id,
         public.fn_bbj_sweep_note(
           public.fn_bbj_promo_window_share(s.pool_id, s.since_at, s.until_at),
           CASE WHEN s.old_notes LIKE '%(single-club sweep)' THEN ' (single-club sweep)' ELSE '' END
         ) AS new_notes
    FROM sweeps s;

  UPDATE public.union_wallet_transactions uwt
     SET notes = w.new_notes
    FROM ca_bbj_sweep_wording w
   WHERE uwt.id = w.id
     AND uwt.notes IS DISTINCT FROM w.new_notes;

  SELECT count(*)
    INTO v_stale_25
    FROM public.union_wallet_transactions uwt
   WHERE uwt.tx_type = 'bbj_promo_sweep'
     AND uwt.notes LIKE '%25\%%' ESCAPE '\'
     AND NOT EXISTS (
       SELECT 1
         FROM public.ca_bbj_rate_periods rp
        WHERE round((1 - rp.main_rate - rp.backup_rate) * 100, 2) = 25
     );

  IF v_stale_25 > 0 THEN
    RAISE EXCEPTION 'ca_bbj_sweep_wording left % sweep rows claiming 25%% without a 25%% rate period', v_stale_25;
  END IF;
END $hist$;

COMMIT;
