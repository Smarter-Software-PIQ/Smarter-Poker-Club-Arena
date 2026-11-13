-- Incident 2b26f12f: five recovery RPCs timed out waiting on T(event)
-- while an in-flight mystery settlement held its lane. The NULL-scope drain
-- selected the oldest event and blocked all independent recovery behind it.
-- Admit one available due event without waiting; keep pending and due-time
-- output for the existing causal contention backoff. Payment, generation,
-- ordering, markers, permissions and lock custody remain unchanged.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $preimage$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=
     'public.fn_sweep_pending_tournament_bounties(uuid,integer)'::regprocedure)
       IS DISTINCT FROM '9a16c59eb58695facd75a2d7406b7c28'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=
     'public.fn_ca_lock_settlement_lane_for_tournament(uuid,uuid)'::regprocedure)
       IS DISTINCT FROM '3acb4c1d763181905cf5b64287f8f28f' THEN
   RAISE EXCEPTION 'Bounty recovery lane source changed; qualify current source';
 END IF;
END $preimage$;
CREATE OR REPLACE FUNCTION public.fn_sweep_pending_tournament_bounties(p_tournament_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  o public.tournament_bounty_obligations%ROWTYPE;
  candidate record;
  v_result jsonb;
  v_reserved jsonb;
  v_award_id uuid;
  v_processed integer := 0;
  v_settled integer := 0;
  v_failed integer := 0;
  v_settled_tournament_ids uuid[] := ARRAY[]::uuid[];
  v_recipients jsonb;
  v_op_hex text;
  v_op_id uuid;
  v_limit integer := GREATEST(1,LEAST(COALESCE(p_limit,20),100));
  v_scope uuid := p_tournament_id;
BEGIN
  -- Admission must not queue behind a busy event while holding the global
  -- shared lane. Try the same G -> T lock order as the rolling authority.
  -- Failed transaction try-locks acquire nothing; success holds the same locks
  -- through commit. Only one tournament lane can be acquired by this call.
  v_scope := NULL;
  IF pg_try_advisory_xact_lock_shared(
       hashtextextended('ca:tournament-terminal-settlement:v1', 0)) THEN
    FOR candidate IN
      SELECT bo.tournament_id, min(bo.next_attempt_at) AS due_at
        FROM public.tournament_bounty_obligations bo
       WHERE bo.state='pending' AND bo.next_attempt_at<=now()
         AND (p_tournament_id IS NULL OR bo.tournament_id=p_tournament_id)
         AND NOT EXISTS (
           SELECT 1 FROM public.tournament_bounty_obligations prior
            WHERE prior.tournament_id=bo.tournament_id AND prior.state='pending'
              AND prior.mode='pko'
              AND (prior.hand_number<bo.hand_number
                   OR (prior.hand_number=bo.hand_number
                       AND prior.eliminated_user_id::text<bo.eliminated_user_id::text))
         )
       GROUP BY bo.tournament_id
       ORDER BY due_at, bo.tournament_id
    LOOP
      IF pg_try_advisory_xact_lock(hashtextextended(
           'ca:tournament-terminal-settlement:v1:' || candidate.tournament_id::text, 0)) THEN
        v_scope := candidate.tournament_id;
        EXIT;
      END IF;
    END LOOP;
  END IF;
  FOR candidate IN
    SELECT bo.id, bo.tournament_id FROM public.tournament_bounty_obligations bo
     WHERE bo.state = 'pending'
       AND bo.next_attempt_at <= now()
       AND bo.tournament_id = v_scope
       AND NOT EXISTS (
         SELECT 1 FROM public.tournament_bounty_obligations prior
          WHERE prior.tournament_id=bo.tournament_id AND prior.state='pending'
            AND prior.mode='pko'
            AND (prior.hand_number < bo.hand_number
                 OR (prior.hand_number=bo.hand_number
                     AND prior.eliminated_user_id::text < bo.eliminated_user_id::text))
       )
     ORDER BY bo.next_attempt_at, bo.tournament_id, bo.hand_number,
              bo.eliminated_user_id
     LIMIT v_limit
  LOOP
    BEGIN
      -- One lock order everywhere: tournament then obligation. Direct manager
      -- collection also locks tournament before its ledger trigger touches the
      -- outbox, so the global lane cannot deadlock it outbox->tournament.
      PERFORM 1 FROM public.tournaments t WHERE t.id=candidate.tournament_id FOR UPDATE;
      SELECT * INTO o FROM public.tournament_bounty_obligations bo
       WHERE bo.id=candidate.id AND bo.state='pending' AND bo.next_attempt_at<=now()
       FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN CONTINUE; END IF;
      -- The candidate query ran before these locks. Re-prove ordering after the
      -- tournament and exact obligation are locked so a predecessor committed
      -- in that window cannot be skipped.
      IF o.mode='pko' AND EXISTS (
        SELECT 1 FROM public.tournament_bounty_obligations prior
         WHERE prior.tournament_id=o.tournament_id AND prior.mode='pko'
           AND prior.state='pending'
           AND (prior.hand_number<o.hand_number
                OR (prior.hand_number=o.hand_number
                    AND prior.eliminated_user_id::text<o.eliminated_user_id::text))
      ) THEN
        CONTINUE;
      END IF;
      v_processed := v_processed + 1;

      -- Response-loss reconciliation before another call.
      IF o.mode <> 'mystery_chest'
         AND public.fn_bounty_obligation_has_complete_marker(o.id) THEN
        UPDATE public.tournament_bounty_obligations SET state='settled', settled_at=now(), last_error=NULL
         WHERE id=o.id;
        v_settled := v_settled + 1;
        IF NOT o.tournament_id=ANY(v_settled_tournament_ids) THEN
          v_settled_tournament_ids := array_append(v_settled_tournament_ids,o.tournament_id);
        END IF;
        CONTINUE;
      ELSIF o.mode = 'mystery_chest'
         AND public.fn_bounty_obligation_has_complete_marker(o.id) THEN
        UPDATE public.tournament_bounty_obligations SET state='settled', settled_at=now(), last_error=NULL
         WHERE id=o.id;
        v_settled := v_settled + 1;
        IF NOT o.tournament_id=ANY(v_settled_tournament_ids) THEN
          v_settled_tournament_ids := array_append(v_settled_tournament_ids,o.tournament_id);
        END IF;
        CONTINUE;
      END IF;

      IF o.mode = 'mystery_chest' THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'user_id', x.user_id, 'weight', x.weight,
          'is_designated_revealer', x.user_id = o.knocker_user_id
        )), '[]'::jsonb)
        INTO v_recipients
        FROM (
          SELECT (e->>'user_id')::uuid AS user_id,
                 GREATEST(COALESCE((e->>'weight')::numeric, 0), 0) AS weight
            FROM jsonb_array_elements(o.claimants) e
           WHERE NULLIF(e->>'user_id','') IS NOT NULL
        ) x;
        v_op_hex := md5('mb:' || o.id::text);
        v_op_id := (substr(v_op_hex,1,8)||'-'||substr(v_op_hex,9,4)||'-4'||substr(v_op_hex,14,3)
          ||'-8'||substr(v_op_hex,18,3)||'-'||substr(v_op_hex,21,12))::uuid;
        v_reserved := public.fn_mystery_bounty_reserve(
          o.tournament_id, o.eliminated_user_id, v_recipients, o.table_id,
          o.hand_id::text, v_op_id, 1);
        IF NOT COALESCE((v_reserved->>'ok')::boolean, false) THEN
          RAISE EXCEPTION 'reserve refused: %', COALESCE(v_reserved->>'reason','unknown');
        END IF;
        v_award_id := (v_reserved->>'award_id')::uuid;
        IF COALESCE(v_reserved->>'status','') <> 'completed' THEN
          v_result := public.fn_mystery_bounty_reveal(v_award_id, NULL, true);
          IF NOT COALESCE((v_result->>'ok')::boolean, false) THEN
            RAISE EXCEPTION 'reveal refused';
          END IF;
          v_result := public.fn_mystery_bounty_pay(v_award_id);
          IF NOT COALESCE((v_result->>'ok')::boolean, false)
             OR COALESCE((v_result->>'refused_recipients')::integer,0) > 0 THEN
            RAISE EXCEPTION 'pay refused or incomplete';
          END IF;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.tournament_bounty_awards a
                        WHERE a.bounty_obligation_id=o.id AND a.status='completed') THEN
          RAISE EXCEPTION 'mystery payout has no completed award marker';
        END IF;
      ELSE
        v_result := public.fn_collect_bounty_obligation(o.id);
        IF NOT COALESCE((v_result->>'ok')::boolean, false)
           AND COALESCE(v_result->>'reason','') <> 'already_collected' THEN
          RAISE EXCEPTION 'collect refused: %', COALESCE(v_result->>'reason','unknown');
        END IF;
        IF NOT public.fn_bounty_obligation_has_complete_marker(o.id) THEN
          RAISE EXCEPTION 'fixed/PKO payout markers do not conserve the full generation head';
        END IF;
      END IF;

      -- Triggers settle only after every canonical claimant (or the completed
      -- award) is durable. Never infer success from an RPC transport response.
      IF NOT EXISTS (SELECT 1 FROM public.tournament_bounty_obligations x
                      WHERE x.id=o.id AND x.state='settled') THEN
        RAISE EXCEPTION 'payout marker did not acknowledge obligation';
      END IF;
      UPDATE public.tournament_bounty_obligations
         SET last_error=NULL, attempt_count=attempt_count+1
       WHERE id=o.id;
      v_settled := v_settled + 1;
      IF NOT o.tournament_id=ANY(v_settled_tournament_ids) THEN
        v_settled_tournament_ids := array_append(v_settled_tournament_ids,o.tournament_id);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.tournament_bounty_obligations
       SET attempt_count=attempt_count+1, last_error=left(SQLERRM,1000),
             next_attempt_at=clock_timestamp()
               + make_interval(secs => LEAST(60, 5 * (attempt_count + 1)))
       WHERE id=candidate.id;
      v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'processed', v_processed,
    'settled', v_settled, 'failed', v_failed,
    'settled_tournament_ids',to_jsonb(v_settled_tournament_ids),
    'pending', (SELECT count(*) FROM public.tournament_bounty_obligations
      WHERE state='pending' AND (p_tournament_id IS NULL OR tournament_id=p_tournament_id)),
    -- Return a DATABASE-CLOCK RELATIVE delay for the first order-eligible
    -- head. A later PKO row can have due=now while an earlier generation is
    -- backed off; using the raw minimum would spin the engine until the head
    -- became due. A host timestamp would repeat that bug under clock skew.
    'retry_after_ms',(
      SELECT CASE WHEN due_at IS NULL THEN NULL ELSE
        GREATEST(0,ceil(extract(epoch FROM (due_at-clock_timestamp()))*1000)::bigint)
      END
      FROM (
        SELECT min(bo.next_attempt_at) AS due_at
          FROM public.tournament_bounty_obligations bo
         WHERE bo.state='pending'
           AND (p_tournament_id IS NULL OR bo.tournament_id=p_tournament_id)
           AND NOT EXISTS (
             SELECT 1 FROM public.tournament_bounty_obligations prior
              WHERE prior.tournament_id=bo.tournament_id AND prior.state='pending'
                AND prior.mode='pko'
                AND (prior.hand_number<bo.hand_number
                     OR (prior.hand_number=bo.hand_number
                         AND prior.eliminated_user_id::text<bo.eliminated_user_id::text))
           )
      ) eligible_head
    ));
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_sweep_pending_tournament_bounties(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sweep_pending_tournament_bounties(uuid,integer) TO service_role;
COMMIT;
