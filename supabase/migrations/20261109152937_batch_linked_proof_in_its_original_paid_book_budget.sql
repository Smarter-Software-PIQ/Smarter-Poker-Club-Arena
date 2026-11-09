-- Linked evidence previously advanced one nonempty canonical window per
-- five-minute tick, even when most of its original proof budget remained.
-- Continue only the existing nonpaying, already-paid book qualification.
-- Reuse the unchanged canonical reader, witnesses, proof data and generation.
-- Admit another step only while its measured cost and the original statement
-- and scope reserves fit. No progress, refusal or completion ends the batch.
-- @live-proof: md5(pg_get_functiondef('public.fn_process_weekly_accounting_scope(uuid,uuid)'::regprocedure))='4179282ab83f30094d4c3b2885102917' AND md5(pg_get_functiondef('smarter_private.weekly_payout_eligible_scopes(timestamptz,timestamptz)'::regprocedure))='f1a135b2555d4dfee67836d0b43af390' AND smarter_private.original_inventory_proof_sources_match()

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '8s';
DO $patch$
DECLARE
  coordinator text := pg_get_functiondef('public.fn_process_weekly_accounting_scope(uuid,uuid)'::regprocedure);
  eligibility text := pg_get_functiondef('smarter_private.weekly_payout_eligible_scopes(timestamptz,timestamptz)'::regprocedure);
  generation text := smarter_private.original_inventory_basis_generation();
  old_step constant text := $old_step$
          v_postpaid_quality:=public.fn_union_pnl_close_quality(v_union.id,v_from,v_end);
$old_step$;
  batch_step constant text := $batch_step$
          DECLARE
            quality_started timestamptz := clock_timestamp();
            batch_started timestamptz;
            batch_stop timestamptz;
            longest_step interval;
            prior_proof timestamptz;
            next_proof timestamptz;
            advance_result boolean;
          BEGIN
            v_postpaid_quality:=public.fn_union_pnl_close_quality(v_union.id,v_from,v_end);
            -- A canonical linked proof already committed in this attempt.
            -- Reuse the same owner and readers while the original budget fits.
            IF v_postpaid_quality->'issues'='["union_pnl_certification_in_progress"]'::jsonb
              AND EXISTS(SELECT 1 FROM public.accounting_close_partials p
                WHERE p.kind='pnl_linked_window' AND p.union_id=v_union.id
                  AND p.period_start=v_from AND p.period_end=v_end
                  AND p.computed_at>=quality_started) THEN
              batch_stop:=LEAST(
                NULLIF(current_setting('app.weekly_accounting_scope_deadline',true),'')::timestamptz-interval '60 seconds',
                NULLIF(current_setting('app.weekly_accounting_scope_deadline',true),'')::timestamptz
                  -COALESCE(NULLIF(current_setting('app.weekly_accounting_scope_budget',true),''),'8 minutes')::interval
                  +interval '120 seconds');
              IF current_setting('statement_timeout') NOT IN ('0','0ms') THEN
                batch_stop:=LEAST(batch_stop,
                  statement_timestamp()+current_setting('statement_timeout')::interval-interval '60 seconds');
              END IF;
              longest_step:=clock_timestamp()-quality_started;
              LOOP
                -- Reserve the slowest step observed so far and guard overhead.
                EXIT WHEN clock_timestamp()+longest_step+interval '5 seconds'>=batch_stop;
                SELECT max(p.computed_at) INTO prior_proof
                  FROM public.accounting_close_partials p
                 WHERE p.kind IN ('pnl_linked_window','pnl_hands_window')
                   AND p.union_id=v_union.id AND p.period_start=v_from AND p.period_end=v_end;
                batch_started:=clock_timestamp();
                advance_result:=public.fn_accounting_union_earned_plan_advance(v_union.id,v_from,v_end);
                longest_step:=GREATEST(longest_step,clock_timestamp()-batch_started);
                EXIT WHEN advance_result IS DISTINCT FROM false;
                SELECT max(p.computed_at) INTO next_proof
                  FROM public.accounting_close_partials p
                 WHERE p.kind IN ('pnl_linked_window','pnl_hands_window')
                   AND p.union_id=v_union.id AND p.period_start=v_from AND p.period_end=v_end;
                EXIT WHEN next_proof IS NOT DISTINCT FROM prior_proof;
              END LOOP;
            END IF;
            -- This remains a nonpaying certification visit. Ready report
            -- qualification still starts separately with its original budget.
          END;
$batch_step$;
BEGIN
  IF md5(coordinator) IS DISTINCT FROM 'bab099269e6370e48b3d8605c74d1b1d'
     OR md5(eligibility) IS DISTINCT FROM '2562cc56bed6664f2dfbfdee09cf3006'
     OR cardinality(string_to_array(coordinator,old_step)) IS DISTINCT FROM 2
     OR cardinality(string_to_array(eligibility,'bab099269e6370e48b3d8605c74d1b1d')) IS DISTINCT FROM 2
     OR smarter_private.original_inventory_proof_sources_match() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PAID_BOOK_BATCH_PREIMAGE_CHANGED';
  END IF;
  EXECUTE replace(coordinator,old_step,batch_step);
  EXECUTE replace(eligibility,'bab099269e6370e48b3d8605c74d1b1d','4179282ab83f30094d4c3b2885102917');
  IF md5(pg_get_functiondef('public.fn_process_weekly_accounting_scope(uuid,uuid)'::regprocedure))
       IS DISTINCT FROM '4179282ab83f30094d4c3b2885102917'
     OR md5(pg_get_functiondef('smarter_private.weekly_payout_eligible_scopes(timestamptz,timestamptz)'::regprocedure))
       IS DISTINCT FROM 'f1a135b2555d4dfee67836d0b43af390'
     OR smarter_private.original_inventory_proof_sources_match() IS DISTINCT FROM true
     OR smarter_private.original_inventory_basis_generation() IS DISTINCT FROM generation THEN
    RAISE EXCEPTION 'PAID_BOOK_BATCH_POSTIMAGE_OR_PROOF_GENERATION_CHANGED';
  END IF;
END $patch$;
COMMIT;
