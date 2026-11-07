-- The same checks that refuse the original award report the first failed invariant.
-- No state, award, caller permission, or external SQLSTATE changes.
-- @live-proof: md5(pg_get_functiondef('public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure))='0b914a047324b07b4fd8387a44cc36c6' AND md5(pg_get_functiondef('public.fn_settle_satellite_tournament_pre_money_path_gate(uuid,uuid)'::regprocedure))='6f086ea3f75dcc75a4b235ad9ba0f97c'
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $migration$
DECLARE
  owner record;
  candidate text;
BEGIN
  FOR owner IN SELECT * FROM (VALUES
    ('public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure, '125892fc05cff0f9433813fcfa8fca2b', '0b914a047324b07b4fd8387a44cc36c6'),
    ('public.fn_settle_satellite_tournament_pre_money_path_gate(uuid,uuid)'::regprocedure, 'c8abcf05ff594c44e0007fdd73128ad9', '6f086ea3f75dcc75a4b235ad9ba0f97c')
  ) AS expected(routine, before_hash, after_hash) LOOP
    candidate := pg_get_functiondef(owner.routine);
    IF md5(candidate) IS DISTINCT FROM owner.before_hash THEN
      RAISE EXCEPTION 'SATELLITE_REFUSAL_PREIMAGE_CHANGED %',owner.routine;
    END IF;
    candidate := replace(candidate, $before$    IF v_target.current_players IS DISTINCT FROM v_target_counter_before
       OR v_target.prize_pool IS DISTINCT FROM v_target_prize_before
       OR v_target.total_rake IS DISTINCT FROM v_target_fee_before
       OR v_target_bounty_before IS DISTINCT FROM 0::numeric
       OR v_target_prize_before + v_target_fee_before IS DISTINCT FROM v_target_custody_before THEN
      RAISE EXCEPTION
        'satellite % cannot deliver a Diamond target seat against malformed aggregate or bank state',
        p_tournament_id USING ERRCODE = 'P0404';
    END IF;$before$, $after$    DECLARE
      failed_invariant text;
    BEGIN
      failed_invariant := CASE
        WHEN v_target.current_players IS DISTINCT FROM v_target_counter_before THEN 'players_mismatch'
        WHEN v_target.prize_pool IS DISTINCT FROM v_target_prize_before THEN 'prize_pool_mismatch'
        WHEN v_target.total_rake IS DISTINCT FROM v_target_fee_before THEN 'fee_pool_mismatch'
        WHEN v_target_bounty_before IS DISTINCT FROM 0::numeric THEN 'bounty_nonzero'
        WHEN v_target_prize_before + v_target_fee_before IS DISTINCT FROM v_target_custody_before THEN 'custody_mismatch'
        ELSE NULL
      END;
      IF failed_invariant IS NOT NULL THEN
        RAISE EXCEPTION 'satellite % cannot deliver a Diamond target seat against malformed aggregate or bank state [invariant=%]',
          p_tournament_id, failed_invariant USING ERRCODE = 'P0404';
      END IF;
    END;$after$);
    candidate := replace(candidate, $before$  IF v_seat_count > 0 AND NOT v_diamond AND (
       v_target.current_players IS NULL
       OR v_target.current_players < 0
       OR v_target.current_players IS DISTINCT FROM v_target_counter_before
       OR v_target.prize_pool IS NULL
       OR v_target.prize_pool::text IN ('NaN','Infinity','-Infinity')
       OR v_target.prize_pool < 0
       OR v_target.prize_pool IS DISTINCT FROM round(v_target.prize_pool, 2)
       OR v_target.total_rake IS NULL
       OR v_target.total_rake::text IN ('NaN','Infinity','-Infinity')
       OR v_target.total_rake < 0
       OR v_target.total_rake IS DISTINCT FROM round(v_target.total_rake, 2)
       OR (v_target_fee > 0 AND v_target.club_id IS NULL)
       OR v_target_escrow.tournament_id IS NULL
       OR v_target_escrow.enforced IS DISTINCT FROM true
       OR v_target_escrow.closed_at IS NOT NULL
       OR v_target_escrow.close_note IS NOT NULL
       OR v_target_escrow.prize_balance IS NULL
       OR v_target_escrow.prize_balance::text IN ('NaN','Infinity','-Infinity')
       OR v_target_escrow.prize_balance < 0
       OR v_target_escrow.prize_balance IS DISTINCT FROM
            round(v_target_escrow.prize_balance, 2)
       OR v_target.prize_pool IS DISTINCT FROM v_target_escrow.prize_balance
       -- A bounty target's bounty bank is exactly its published pool less
       -- what knockouts have already paid from it (2026-10-16).
       OR v_target_escrow.bounty_balance IS DISTINCT FROM
            (CASE WHEN v_target_is_bounty
                  THEN round(COALESCE(v_target.bounty_pool, 0)
                             - COALESCE(v_target.bounty_pool_paid, 0), 2)
                  ELSE 0::numeric END)
       OR v_target_escrow.fee_balance IS NULL
       OR v_target_escrow.fee_balance::text IN ('NaN','Infinity','-Infinity')
       OR v_target_escrow.fee_balance < 0
       OR v_target_escrow.fee_balance IS DISTINCT FROM
            round(v_target_escrow.fee_balance, 2)
       OR v_target.total_rake IS DISTINCT FROM v_target_escrow.fee_balance
       OR EXISTS (
         SELECT 1
           FROM unnest(ARRAY[
             'gross_in','fee_entries_in','satellite_fee_in','bounty_in',
             'overlay_in','satellite_in','prize_out','bounty_out','fee_out',
             'refund_prize','refund_bounty','refund_fee',
             'reserve_out','reserve_in'
           ]::text[]) AS component(name)
           CROSS JOIN LATERAL (
             SELECT (to_jsonb(v_target_escrow)->>component.name)::numeric AS amount
           ) AS persisted
          WHERE persisted.amount IS NULL
             OR CASE
                  WHEN persisted.amount::text IN ('NaN','Infinity','-Infinity')
                    THEN true
                  ELSE persisted.amount < 0
                    OR persisted.amount IS DISTINCT FROM round(persisted.amount,2)
                END
       )
     ) THEN
    RAISE EXCEPTION
      'satellite % cannot deliver a target seat against malformed aggregate or escrow state',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;$before$, $after$  IF v_seat_count > 0 AND NOT v_diamond THEN
    DECLARE
      failed_invariant text;
    BEGIN
      failed_invariant := CASE
        WHEN v_target.current_players IS NULL THEN 'players_missing'
        WHEN v_target.current_players < 0 THEN 'players_negative'
        WHEN v_target.current_players IS DISTINCT FROM v_target_counter_before THEN 'players_mismatch'
        WHEN v_target.prize_pool IS NULL THEN 'prize_missing'
        WHEN v_target.prize_pool::text IN ('NaN','Infinity','-Infinity') THEN 'prize_nonfinite'
        WHEN v_target.prize_pool < 0 THEN 'prize_negative'
        WHEN v_target.prize_pool IS DISTINCT FROM round(v_target.prize_pool, 2) THEN 'prize_precision'
        WHEN v_target.total_rake IS NULL THEN 'rake_missing'
        WHEN v_target.total_rake::text IN ('NaN','Infinity','-Infinity') THEN 'rake_nonfinite'
        WHEN v_target.total_rake < 0 THEN 'rake_negative'
        WHEN v_target.total_rake IS DISTINCT FROM round(v_target.total_rake, 2) THEN 'rake_precision'
        WHEN (v_target_fee > 0 AND v_target.club_id IS NULL) THEN 'fee_club_missing'
        WHEN v_target_escrow.tournament_id IS NULL THEN 'escrow_missing'
        WHEN v_target_escrow.enforced IS DISTINCT FROM true THEN 'escrow_unenforced'
        WHEN v_target_escrow.closed_at IS NOT NULL THEN 'escrow_closed'
        WHEN v_target_escrow.close_note IS NOT NULL THEN 'escrow_close_note'
        WHEN v_target_escrow.prize_balance IS NULL THEN 'escrow_prize_missing'
        WHEN v_target_escrow.prize_balance::text IN ('NaN','Infinity','-Infinity') THEN 'escrow_prize_nonfinite'
        WHEN v_target_escrow.prize_balance < 0 THEN 'escrow_prize_negative'
        WHEN v_target_escrow.prize_balance IS DISTINCT FROM
            round(v_target_escrow.prize_balance, 2) THEN 'escrow_prize_precision'
        WHEN v_target.prize_pool IS DISTINCT FROM v_target_escrow.prize_balance THEN 'prize_balance_mismatch'
        WHEN v_target_escrow.bounty_balance IS DISTINCT FROM
            (CASE WHEN v_target_is_bounty
                  THEN round(COALESCE(v_target.bounty_pool, 0)
                             - COALESCE(v_target.bounty_pool_paid, 0), 2)
                  ELSE 0::numeric END) THEN 'bounty_balance_mismatch'
        WHEN v_target_escrow.fee_balance IS NULL THEN 'escrow_fee_missing'
        WHEN v_target_escrow.fee_balance::text IN ('NaN','Infinity','-Infinity') THEN 'escrow_fee_nonfinite'
        WHEN v_target_escrow.fee_balance < 0 THEN 'escrow_fee_negative'
        WHEN v_target_escrow.fee_balance IS DISTINCT FROM
            round(v_target_escrow.fee_balance, 2) THEN 'escrow_fee_precision'
        WHEN v_target.total_rake IS DISTINCT FROM v_target_escrow.fee_balance THEN 'fee_balance_mismatch'
        WHEN EXISTS (
         SELECT 1
           FROM unnest(ARRAY[
             'gross_in','fee_entries_in','satellite_fee_in','bounty_in',
             'overlay_in','satellite_in','prize_out','bounty_out','fee_out',
             'refund_prize','refund_bounty','refund_fee',
             'reserve_out','reserve_in'
           ]::text[]) AS component(name)
           CROSS JOIN LATERAL (
             SELECT (to_jsonb(v_target_escrow)->>component.name)::numeric AS amount
           ) AS persisted
          WHERE persisted.amount IS NULL
             OR CASE
                  WHEN persisted.amount::text IN ('NaN','Infinity','-Infinity')
                    THEN true
                  ELSE persisted.amount < 0
                    OR persisted.amount IS DISTINCT FROM round(persisted.amount,2)
                END
       ) THEN 'component_invalid'
        ELSE NULL
      END;
      IF failed_invariant IS NOT NULL THEN
        RAISE EXCEPTION 'satellite % cannot deliver a target seat against malformed aggregate or escrow state [invariant=%]',
          p_tournament_id, failed_invariant USING ERRCODE = 'P0404';
      END IF;
    END;
  END IF;$after$);
    EXECUTE candidate;
    IF md5(pg_get_functiondef(owner.routine)) IS DISTINCT FROM owner.after_hash THEN
      RAISE EXCEPTION 'SATELLITE_REFUSAL_POSTIMAGE_CHANGED %',owner.routine;
    END IF;
  END LOOP;
END $migration$;
COMMIT;
