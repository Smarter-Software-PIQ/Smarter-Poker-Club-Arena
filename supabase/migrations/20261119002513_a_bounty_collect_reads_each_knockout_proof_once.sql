-- Incident 2026-11-18 19:15 UTC, Midday Free Buy eb0c2d80 (547 entrants, 943 knockouts).
-- Every bounty collect re-proved the accepted evidence of EVERY knockout of
-- its event while holding the event's settlement lane exclusive: 406 to 557 ms
-- measured read-only at 944 candidates, growing with each knockout, so the
-- event's cost was quadratic and every table queued behind each payout.
-- The accepted scope of one candidate is a pure function of four row versions
-- (candidate, atomic commit, settlement key, hand history). This migration
-- stores that proof once per candidate beside the exact row versions it was
-- computed from. The payer accepts a stored proof only while all four live
-- versions (tableoid, ctid, xmin; absence included) still equal the stored
-- ones and the proof is under 24 hours old; any other candidate is proved
-- inline by the unchanged reviewed pipeline. New proofs are written before
-- the lane is taken. Verdicts, UNKNOWN refusals, ordering and the 10000
-- overflow are unchanged; fn_pko_predecessor_accepted_scopes_v1 is kept
-- byte for byte as the oracle. No foreign key: a hot table is never locked.
-- The MTT admission guard pinned the two changed bodies for its one-time
-- legacy-capacity-v1 to unlimited-mtt-v2 transition, which production has
-- already made; the guard is left untouched.
-- @stale-pin-ok: 153611739262ec90c83bf3c08340da9e activation transition already made; predecessor proof now reads validated stored scopes
-- @stale-pin-ok: a1e36b2a6907d83c606d08ed5eb888d7 activation transition already made; obligation collector proves new evidence before the lane
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $preimage$
DECLARE item jsonb;p record;identity oid;
BEGIN
 FOR item IN SELECT value FROM jsonb_array_elements($manifest$[
  {"signature":"public.fn_pko_predecessor_accepted_scopes_v1(uuid,uuid)","before":"028fc1f4d728d5ff246dee7a5eeb8e31","after":"028fc1f4d728d5ff246dee7a5eeb8e31","acl":"{postgres=X/postgres}","volatile":"s"},
  {"signature":"public.fn_pko_claim_predecessor_status_v1(uuid,uuid,uuid,uuid,bigint,timestamp with time zone)","before":"7526f67c6eda86052d7d38c76f1410e9","after":"87e6efccbe1a83b52c740dfe3ff9bc9f","acl":"{postgres=X/postgres}","volatile":"s"},
  {"signature":"public.fn_collect_bounty_obligation(uuid)","before":"dde145f7b818e905ecf8f6354e55f055","after":"919f48c3b6513d6cd4e79ea893863ecd","acl":"{postgres=X/postgres,service_role=X/postgres}","volatile":"v"}
 ]$manifest$::jsonb) LOOP
  identity:=to_regprocedure(item->>'signature');
  IF identity IS NULL THEN RAISE EXCEPTION 'PKO stored proof source missing: %',item->>'signature'; END IF;
  SELECT f.*,r.rolname owner INTO p FROM pg_proc f JOIN pg_roles r ON r.oid=f.proowner WHERE f.oid=identity;
  IF md5(p.prosrc) NOT IN (item->>'before',item->>'after')
    OR p.owner IS DISTINCT FROM 'postgres' OR p.proacl::text IS DISTINCT FROM item->>'acl'
    OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
    OR p.prosecdef IS DISTINCT FROM true OR p.provolatile::text IS DISTINCT FROM item->>'volatile' THEN
   RAISE EXCEPTION 'PKO stored proof unreviewed source or metadata: %',item->>'signature';
  END IF;
 END LOOP;
END $preimage$;

CREATE TABLE IF NOT EXISTS public.tournament_pko_candidate_scope_proofs(
 candidate_id uuid PRIMARY KEY,
 tournament_id uuid NOT NULL,
 candidate_version text NOT NULL,
 commit_version text,
 settlement_hand_id uuid,
 settlement_version text,
 history_version text,
 scope jsonb NOT NULL,
 narrative_strings text[] NOT NULL,
 proved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.tournament_pko_candidate_scope_proofs OWNER TO postgres;
ALTER TABLE public.tournament_pko_candidate_scope_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tournament_pko_candidate_scope_proofs FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE public.tournament_pko_candidate_scope_proofs IS
 'One accepted-scope proof per knockout candidate with the exact row versions it was computed from. Read only through fn_pko_candidate_scope_proof_states_v2, which accepts a row only while every version still matches. Never a source of truth; deleting any row is always safe.';

-- The reviewed evidence pipeline of fn_pko_predecessor_accepted_scopes_v1,
-- restricted to named candidates, returning the row versions it read and
-- every string scalar of pots and winners in place of one player's flag.
CREATE OR REPLACE FUNCTION public.fn_pko_candidate_scope_evidence_v2(p_tournament_id uuid,p_candidate_ids uuid[])
RETURNS TABLE(candidate_id uuid,candidate_version text,commit_version text,settlement_hand_id uuid,
 settlement_version text,history_version text,scope jsonb,narrative_strings text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
WITH candidates AS MATERIALIZED (
 SELECT c,c.tableoid::text||':'||c.ctid::text||':'||c.xmin::text AS candidate_version
 FROM public.tournament_knockout_candidates c
 WHERE c.tournament_id=p_tournament_id AND c.id=ANY(p_candidate_ids)
), evidence AS (
 SELECT c.c AS candidate,a.committed_at,a.stack_result,
        k.status AS settlement_status,k.completed_at,k.result,
        h.created_at AS history_created_at,h.players,
        ARRAY(SELECT DISTINCT s.item #>> '{}' FROM (
          SELECT item FROM jsonb_path_query(h.pots,'$.** ? (@.type() == "string")') item
          UNION ALL
          SELECT item FROM jsonb_path_query(h.winners,'$.** ? (@.type() == "string")') item) s
          ORDER BY 1) AS narrative_strings,
        c.candidate_version,
        a.tableoid::text||':'||a.ctid::text||':'||a.xmin::text AS commit_version,
        CASE WHEN coalesce(a.stack_result->>'hand_id','') ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (a.stack_result->>'hand_id')::uuid END AS settlement_hand_id,
        k.tableoid::text||':'||k.ctid::text||':'||k.xmin::text AS settlement_version,
        h.tableoid::text||':'||h.ctid::text||':'||h.xmin::text AS history_version
 FROM candidates c
 LEFT JOIN public.hand_atomic_commits a
   ON a.table_id=(c.c).table_id AND a.hand_number=(c.c).hand_number AND a.hand_id=(c.c).hand_id
 LEFT JOIN public.settlement_idempotency_keys k
   ON k.table_id=(c.c).table_id AND k.hand_id=CASE
     WHEN coalesce(a.stack_result->>'hand_id','') ~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     THEN (a.stack_result->>'hand_id')::uuid END
 LEFT JOIN public.hand_history h
   ON h.id=(c.c).hand_id AND h.table_id=(c.c).table_id
     AND h.hand_number=(c.c).hand_number AND h.tournament_id=(c.c).tournament_id
), maps AS (
 SELECT e.*,w.valid AS written_valid,w.items AS written_count
 FROM evidence e CROSS JOIN LATERAL (
  SELECT count(*) AS items,coalesce(bool_and(CASE
    WHEN key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR coalesce(value,'') !~ '^[0-9]+([.][0-9]+)?$' OR length(coalesce(value,''))>32 THEN false
    ELSE true END),true) AS valid
  FROM jsonb_each_text(CASE WHEN jsonb_typeof(e.stack_result->'written')='object'
    THEN e.stack_result->'written' ELSE '{}'::jsonb END)
 ) w
), rosters AS (
 SELECT m.*,r.items AS roster_count,r.participants,r.first_error
 FROM maps m CROSS JOIN LATERAL (
  WITH people AS (
   SELECT hp,ordinal,coalesce(hp->>'userId',hp->>'user_id') AS uid
   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.players)='array'
     THEN m.players ELSE '[]'::jsonb END) WITH ORDINALITY p(hp,ordinal)
  ), checked AS (
   SELECT p.*,count(*) OVER(PARTITION BY uid ORDER BY ordinal) AS seen FROM people p
  ), errors AS (
   SELECT p.*,CASE
     WHEN seen>1 OR NOT coalesce(m.stack_result->'written' ? uid,false)
       THEN 'accepted_roster_unproven'
     WHEN m.written_valid AND hp->>'stack' IS NOT DISTINCT FROM m.stack_result->'written'->>uid
       THEN NULL
     WHEN coalesce(hp->>'stack','') !~ '^[0-9]+([.][0-9]+)?$'
       OR length(coalesce(hp->>'stack',''))>32 OR NOT m.written_valid
       THEN 'accepted_roster_unproven'
     WHEN (hp->>'stack')::numeric IS DISTINCT FROM (m.stack_result->'written'->>uid)::numeric
       THEN 'accepted_roster_stack_conflict'
     END AS error
   FROM checked p
  )
  SELECT count(*) AS items,coalesce(jsonb_agg(uid ORDER BY ordinal),'[]'::jsonb) AS participants,
    (array_agg(error ORDER BY ordinal) FILTER(WHERE error IS NOT NULL))[1] AS first_error
  FROM errors
 ) r
), verdicts AS (
 SELECT r.*,CASE
  WHEN (candidate).id IS NULL OR (candidate).table_id IS NULL OR (candidate).hand_id IS NULL
    OR (candidate).hand_number<1000000 OR (candidate).seat_joined_at IS NULL
    OR (candidate).created_at IS NULL OR (candidate).stack_after IS DISTINCT FROM 0
    OR (candidate).stack_before IS NULL OR (candidate).stack_before<=0 THEN 'candidate_identity_unproven'
  WHEN committed_at IS NULL OR (candidate).created_at>committed_at
    OR stack_result->>'table_id' IS DISTINCT FROM (candidate).table_id::text
    OR stack_result->>'hand_number' IS DISTINCT FROM (candidate).hand_number::text
    OR jsonb_typeof(stack_result->'written') IS DISTINCT FROM 'object' THEN 'atomic_identity_unproven'
  WHEN coalesce(stack_result->>'hand_id','') !~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'settlement_identity_unproven'
  WHEN settlement_status IS DISTINCT FROM 'succeeded' OR completed_at IS NULL
    OR completed_at<(candidate).seat_joined_at OR completed_at>committed_at
    OR result->>'table_id' IS DISTINCT FROM (candidate).table_id::text
    OR result->>'hand_number' IS DISTINCT FROM (candidate).hand_number::text
    OR jsonb_typeof(result->'written') IS DISTINCT FROM 'object'
    OR result->'written' IS DISTINCT FROM stack_result->'written' THEN 'accepted_settlement_unproven'
  WHEN NOT written_valid THEN 'accepted_stack_map_unproven'
  WHEN NOT coalesce(stack_result->'written' ? (candidate).eliminated_user_id::text,false)
    THEN 'accepted_zero_unproven'
  WHEN CASE WHEN written_valid THEN (stack_result->'written'->>(candidate).eliminated_user_id::text)::numeric
    IS DISTINCT FROM 0 ELSE true END THEN 'accepted_zero_unproven'
  WHEN history_created_at IS NULL OR history_created_at<completed_at
    OR history_created_at<(candidate).seat_joined_at OR history_created_at>committed_at
    OR jsonb_typeof(players) IS DISTINCT FROM 'array' THEN 'accepted_history_unproven'
  WHEN roster_count=0 THEN 'accepted_roster_unproven'
  WHEN first_error IS NOT NULL THEN first_error
  WHEN roster_count<>written_count THEN 'accepted_roster_incomplete'
  END AS reason
 FROM rosters r
)
SELECT (candidate).id,candidate_version,commit_version,settlement_hand_id,settlement_version,history_version,
 CASE WHEN reason IS NOT NULL THEN jsonb_build_object('ok',false,'reason',reason)
 ELSE jsonb_build_object('ok',true,'candidate_id',(candidate).id,
   'tournament_id',(candidate).tournament_id,'table_id',(candidate).table_id,'hand_id',(candidate).hand_id,
   'hand_number',(candidate).hand_number,'eliminated_user_id',(candidate).eliminated_user_id,
   'seat_joined_at',(candidate).seat_joined_at,'settlement_completed_at',completed_at,
   'committed_at',committed_at,'participants',participants) END,narrative_strings
FROM verdicts ORDER BY (candidate).id;
$function$;

-- fresh is true only when the stored proof was computed from exactly the row
-- versions that are live now. A NULL excluded player means every candidate.
CREATE OR REPLACE FUNCTION public.fn_pko_candidate_scope_proof_states_v2(p_tournament_id uuid,p_excluded_user_id uuid)
RETURNS TABLE(candidate public.tournament_knockout_candidates,fresh boolean,scope jsonb,narrative_strings text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
WITH candidates AS MATERIALIZED (
 SELECT c,c.tableoid::text||':'||c.ctid::text||':'||c.xmin::text AS candidate_version
 FROM public.tournament_knockout_candidates c
 WHERE c.tournament_id=p_tournament_id
   AND (p_excluded_user_id IS NULL OR c.eliminated_user_id<>p_excluded_user_id)
 ORDER BY c.hand_number,c.eliminated_user_id LIMIT 10001
)
SELECT c.c,
 coalesce(m.tournament_id=p_tournament_id
   AND m.proved_at>now()-interval '24 hours'
   AND m.candidate_version=c.candidate_version
   AND m.commit_version IS NOT DISTINCT FROM (a.tableoid::text||':'||a.ctid::text||':'||a.xmin::text)
   AND m.settlement_version IS NOT DISTINCT FROM (k.tableoid::text||':'||k.ctid::text||':'||k.xmin::text)
   AND m.history_version IS NOT DISTINCT FROM (h.tableoid::text||':'||h.ctid::text||':'||h.xmin::text),false),
 m.scope,m.narrative_strings
FROM candidates c
LEFT JOIN public.tournament_pko_candidate_scope_proofs m ON m.candidate_id=(c.c).id
LEFT JOIN public.hand_atomic_commits a
  ON a.table_id=(c.c).table_id AND a.hand_number=(c.c).hand_number AND a.hand_id=(c.c).hand_id
LEFT JOIN public.settlement_idempotency_keys k
  ON k.table_id=(c.c).table_id AND k.hand_id=m.settlement_hand_id
LEFT JOIN public.hand_history h
  ON h.id=(c.c).hand_id AND h.table_id=(c.c).table_id
    AND h.hand_number=(c.c).hand_number AND h.tournament_id=(c.c).tournament_id
ORDER BY (c.c).hand_number,(c.c).eliminated_user_id;
$function$;

-- Same rows, order, bound and values as fn_pko_predecessor_accepted_scopes_v1.
CREATE OR REPLACE FUNCTION public.fn_pko_predecessor_proved_scopes_v2(p_tournament_id uuid,p_excluded_user_id uuid)
RETURNS TABLE(candidate public.tournament_knockout_candidates,scope jsonb,conflicting_recipient_narrative boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
WITH states AS MATERIALIZED (
 SELECT s.candidate,s.fresh,s.scope,s.narrative_strings
 FROM public.fn_pko_candidate_scope_proof_states_v2(p_tournament_id,p_excluded_user_id) s
 WHERE p_excluded_user_id IS NOT NULL
), computed AS MATERIALIZED (
 SELECT e.candidate_id,e.scope,e.narrative_strings
 FROM public.fn_pko_candidate_scope_evidence_v2(p_tournament_id,
   coalesce((SELECT array_agg((s.candidate).id) FROM states s WHERE NOT s.fresh),'{}'::uuid[])) e
)
SELECT s.candidate,
 CASE WHEN s.fresh THEN s.scope ELSE e.scope END,
 CASE WHEN s.fresh THEN p_excluded_user_id::text=ANY(s.narrative_strings)
      ELSE coalesce(p_excluded_user_id::text=ANY(e.narrative_strings),false) END
FROM states s LEFT JOIN computed e ON NOT s.fresh AND e.candidate_id=(s.candidate).id
ORDER BY (s.candidate).hand_number,(s.candidate).eliminated_user_id;
$function$;

-- Writes proofs for candidates whose stored proof is missing or stale. Never
-- waits: a second prover of the same event leaves the work to the first.
CREATE OR REPLACE FUNCTION public.fn_pko_prove_candidate_scopes_v2(p_tournament_id uuid)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE stale uuid[]; written integer:=0;
BEGIN
 IF p_tournament_id IS NULL THEN RETURN 0; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtext('ca:pko-candidate-scope-proofs:v2'),hashtext(p_tournament_id::text)) THEN
  RETURN -1;
 END IF;
 SELECT array_agg((s.candidate).id ORDER BY (s.candidate).id) INTO stale
   FROM public.fn_pko_candidate_scope_proof_states_v2(p_tournament_id,NULL) s WHERE NOT s.fresh;
 IF stale IS NULL THEN RETURN 0; END IF;
 INSERT INTO public.tournament_pko_candidate_scope_proofs AS m
   (candidate_id,tournament_id,candidate_version,commit_version,settlement_hand_id,
    settlement_version,history_version,scope,narrative_strings,proved_at)
 SELECT e.candidate_id,p_tournament_id,e.candidate_version,e.commit_version,e.settlement_hand_id,
        e.settlement_version,e.history_version,e.scope,e.narrative_strings,clock_timestamp()
   FROM public.fn_pko_candidate_scope_evidence_v2(p_tournament_id,stale) e
  ORDER BY e.candidate_id
 ON CONFLICT (candidate_id) DO UPDATE SET
   tournament_id=EXCLUDED.tournament_id,candidate_version=EXCLUDED.candidate_version,
   commit_version=EXCLUDED.commit_version,settlement_hand_id=EXCLUDED.settlement_hand_id,
   settlement_version=EXCLUDED.settlement_version,history_version=EXCLUDED.history_version,
   scope=EXCLUDED.scope,narrative_strings=EXCLUDED.narrative_strings,proved_at=EXCLUDED.proved_at;
 GET DIAGNOSTICS written=ROW_COUNT;
 RETURN written;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_pko_claim_predecessor_status_v1(p_tournament_id uuid, p_eliminated_user_id uuid, p_table_id uuid, p_hand_id uuid, p_hand_number bigint, p_seat_joined_at timestamp with time zone)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  evidence_row record;
  target public.tournament_knockout_candidates%ROWTYPE;
  c public.tournament_knockout_candidates%ROWTYPE;
  o public.tournament_bounty_obligations%ROWTYPE;
  target_scope jsonb; prior_scope jsonb; claims jsonb;
  target_commit timestamptz; prior_commit timestamptz;
  inspected integer:=0; checked integer:=0;
  -- Reviewable work bound; never a truncated successful dependency proof.
  scope_limit constant integer:=10000;
  blocked jsonb:='[]'::jsonb; unknown jsonb:='[]'::jsonb;
  detail jsonb; known_marker boolean; conflicting_recipient_narrative boolean;
  same_accepted_hand boolean;
BEGIN
  IF p_tournament_id IS NULL OR p_eliminated_user_id IS NULL
     OR p_table_id IS NULL OR p_hand_id IS NULL OR p_hand_number IS NULL
     OR p_seat_joined_at IS NULL THEN
    RETURN jsonb_build_object('ok',false,'status','unknown','reason','target_identity_required');
  END IF;
  SELECT * INTO target FROM public.tournament_knockout_candidates
   WHERE tournament_id=p_tournament_id AND hand_number=p_hand_number
     AND eliminated_user_id=p_eliminated_user_id;
  IF NOT FOUND OR target.table_id IS DISTINCT FROM p_table_id
     OR target.hand_id IS DISTINCT FROM p_hand_id
     OR target.seat_joined_at IS DISTINCT FROM p_seat_joined_at THEN
    RETURN jsonb_build_object('ok',false,'status','unknown','reason','target_identity_conflict');
  END IF;
  target_scope:=public.fn_pko_candidate_accepted_scope_v1(p_tournament_id,target.id);
  IF target_scope->>'ok' IS DISTINCT FROM 'true' THEN
    RETURN jsonb_build_object('ok',false,'status','unknown','reason','target_evidence_unproven',
      'detail',target_scope);
  END IF;
  target_commit:=(target_scope->>'committed_at')::timestamptz;

  -- A pending debt without its exact accepted candidate is not invisible work.
  -- Candidate enumeration alone cannot discharge this orphaned payment record.
  IF EXISTS (
    SELECT 1 FROM public.tournament_bounty_obligations debt
     WHERE debt.tournament_id=p_tournament_id AND debt.mode='pko' AND debt.state='pending'
       AND NOT EXISTS (
         SELECT 1 FROM public.tournament_knockout_candidates candidate
          WHERE candidate.tournament_id=debt.tournament_id
            AND candidate.eliminated_user_id=debt.eliminated_user_id
            AND candidate.hand_number=debt.hand_number AND candidate.table_id=debt.table_id
            AND candidate.hand_id=debt.hand_id AND candidate.seat_joined_at=debt.seat_joined_at)
  ) THEN
    RETURN jsonb_build_object('ok',false,'status','unknown','reason','pending_pko_candidate_missing');
  END IF;

  -- Existing (tournament_id,hand_number,eliminated_user_id) unique index.
  -- The ordering is a scan cursor only, NOT chronological proof. Preallocation
  -- at another table can give an earlier accepted predecessor a larger number.
  FOR evidence_row IN SELECT * FROM public.fn_pko_predecessor_proved_scopes_v2(p_tournament_id,p_eliminated_user_id)
  LOOP
    c:=evidence_row.candidate;
    inspected:=inspected+1;
    IF inspected>scope_limit THEN
      RETURN jsonb_build_object('ok',false,'status','unknown','reason','predecessor_scope_incomplete',
        'inspected',scope_limit,'scope_limit',scope_limit,'predecessors',blocked,'unknown',unknown);
    END IF;
    -- Same-hand dependence uses the same exact marker proof as cross-hand
    -- dependence. The original side-pot/tie guard remains an additional veto,
    -- but its settled state alone is no longer enough to skip this proof.
    same_accepted_hand:=c.hand_id=p_hand_id AND c.table_id=p_table_id AND c.hand_number=p_hand_number;
    detail:=jsonb_build_object('candidate_id',c.id,'eliminated_user_id',c.eliminated_user_id,
      'table_id',c.table_id,'hand_id',c.hand_id,'hand_number',c.hand_number,
      'seat_joined_at',c.seat_joined_at,'candidate_state',c.state);
    prior_scope:=evidence_row.scope;
    IF prior_scope->>'ok' IS DISTINCT FROM 'true' THEN
      IF jsonb_array_length(unknown)<20 THEN
        unknown:=unknown||jsonb_build_array(detail||jsonb_build_object('reason','candidate_evidence_unproven','detail',prior_scope));
      END IF;
      CONTINUE;
    END IF;
    -- A complete accepted participant map proves a different table's head
    -- cannot flow into this player. No marker/pot work for that hand.
    IF NOT (prior_scope->'participants' ? p_eliminated_user_id::text) THEN
      -- Malformed history must not name an absent accepted participant as a
      -- recipient/eligible player. A raw scalar mention is only an UNKNOWN
      -- conflict witness, never attribution; JSONPath safely handles scalars.
      conflicting_recipient_narrative:=evidence_row.conflicting_recipient_narrative;
      IF conflicting_recipient_narrative IS TRUE THEN
        IF jsonb_array_length(unknown)<20 THEN
          unknown:=unknown||jsonb_build_array(detail||jsonb_build_object('reason','recipient_outside_accepted_roster'));
        END IF;
      END IF;
      CONTINUE;
    END IF;
    prior_commit:=(prior_scope->>'committed_at')::timestamptz;
    IF NOT same_accepted_hand AND prior_commit>target_commit THEN CONTINUE; END IF;
    IF NOT same_accepted_hand AND prior_commit=target_commit THEN
      IF jsonb_array_length(unknown)<20 THEN
        unknown:=unknown||jsonb_build_array(detail||jsonb_build_object('reason','cross_hand_causal_order_unproven'));
      END IF;
      CONTINUE;
    END IF;
    checked:=checked+1;
    -- Exact lookup by unique key, then compare every immutable identity.
    SELECT * INTO o FROM public.tournament_bounty_obligations
     WHERE tournament_id=p_tournament_id AND hand_number=c.hand_number
       AND eliminated_user_id=c.eliminated_user_id;
    IF FOUND THEN
      IF o.table_id IS DISTINCT FROM c.table_id OR o.hand_id IS DISTINCT FROM c.hand_id
         OR o.seat_joined_at IS DISTINCT FROM c.seat_joined_at OR o.mode IS DISTINCT FROM 'pko'
         OR o.settlement_completed_at IS DISTINCT FROM (prior_scope->>'settlement_completed_at')::timestamptz THEN
        IF jsonb_array_length(unknown)<20 THEN
          unknown:=unknown||jsonb_build_array(detail||jsonb_build_object('reason','predecessor_obligation_identity_conflict','obligation_id',o.id));
        END IF;
        CONTINUE;
      END IF;
      IF jsonb_typeof(o.claimants) IS DISTINCT FROM 'array' THEN
        IF jsonb_array_length(unknown)<20 THEN
          unknown:=unknown||jsonb_build_array(detail||jsonb_build_object('reason','predecessor_claimants_malformed','obligation_id',o.id));
        END IF;
        CONTINUE;
      END IF;
      IF jsonb_array_length(o.claimants)=0 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(o.claimants) e
         WHERE coalesce(e->>'user_id','') !~*
           '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           OR e->>'weight' IS DISTINCT FROM '1'
      ) THEN
        IF jsonb_array_length(unknown)<20 THEN
          unknown:=unknown||jsonb_build_array(detail||jsonb_build_object('reason','predecessor_claimants_malformed','obligation_id',o.id));
        END IF;
        CONTINUE;
      END IF;
      IF jsonb_array_length(o.claimants)<>(SELECT count(DISTINCT (e->>'user_id')::uuid)
            FROM jsonb_array_elements(o.claimants) e)
         OR o.claimants @> jsonb_build_array(jsonb_build_object('user_id',o.eliminated_user_id,'weight',1)) THEN
        IF jsonb_array_length(unknown)<20 THEN
          unknown:=unknown||jsonb_build_array(detail||jsonb_build_object('reason','predecessor_claimants_malformed','obligation_id',o.id));
        END IF;
        CONTINUE;
      END IF;
    END IF;
    BEGIN
      claims:=public.fn_exact_tournament_knockout_claimants(p_tournament_id,c.hand_id,c.eliminated_user_id);
    EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation OR numeric_value_out_of_range THEN
      -- Only malformed read evidence is classified here. Cancellation,
      -- connection, permissions, and unexpected execution errors propagate.
      claims:=NULL;
    END;
    IF jsonb_typeof(claims) IS DISTINCT FROM 'array' THEN
      IF jsonb_array_length(unknown)<20 THEN
        unknown:=unknown||jsonb_build_array(detail||jsonb_build_object('reason','predecessor_recipients_unproven'));
      END IF;
      CONTINUE;
    END IF;
    IF jsonb_array_length(claims)=0 THEN
      IF jsonb_array_length(unknown)<20 THEN
        unknown:=unknown||jsonb_build_array(detail||jsonb_build_object('reason','predecessor_recipients_unproven'));
      END IF;
      CONTINUE;
    END IF;
    IF o.id IS NOT NULL AND o.claimants IS DISTINCT FROM claims THEN
      IF jsonb_array_length(unknown)<20 THEN
        unknown:=unknown||jsonb_build_array(detail||jsonb_build_object('reason','predecessor_claimant_snapshot_conflict','obligation_id',o.id));
      END IF;
      CONTINUE;
    END IF;
    IF NOT (claims @> jsonb_build_array(jsonb_build_object('user_id',p_eliminated_user_id,'weight',1))) THEN CONTINUE; END IF;
    IF o.id IS NOT NULL AND o.state='settled' THEN
      -- The marker discharges the accepted predecessor only after its exact
      -- recipient and settlement identities have also matched.
      IF public.fn_bounty_obligation_has_complete_marker(o.id) THEN CONTINUE; END IF;
      IF jsonb_array_length(unknown)<20 THEN
        unknown:=unknown||jsonb_build_array(detail||jsonb_build_object('reason','predecessor_marker_incomplete','obligation_id',o.id));
      END IF;
      CONTINUE;
    END IF;
    IF jsonb_array_length(blocked)<20 THEN
      blocked:=blocked||jsonb_build_array(detail||jsonb_build_object('obligation_id',o.id,
        'committed_at',prior_commit,'claimants',claims,
        'reason',CASE WHEN o.id IS NOT NULL THEN 'pending_pko_predecessor'
          WHEN c.state='pending' THEN 'unclaimed_pko_predecessor'
          ELSE 'closed_predecessor_claim_missing' END,
        'recovery_required',o.id IS NULL AND c.state<>'pending'));
    END IF;
  END LOOP;
  IF jsonb_array_length(unknown)>0 THEN
    RETURN jsonb_build_object('ok',false,'status','unknown','reason','predecessor_evidence_unproven',
      'inspected',inspected,'checked',checked,'predecessors',blocked,'unknown',unknown);
  END IF;
  IF jsonb_array_length(blocked)>0 THEN
    RETURN jsonb_build_object('ok',false,'status','blocked','reason','unsettled_pko_predecessor',
      'inspected',inspected,'checked',checked,'predecessors',blocked);
  END IF;
  RETURN jsonb_build_object('ok',true,'status','clear','inspected',inspected,'checked',checked);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_collect_bounty_obligation(p_obligation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  o public.tournament_bounty_obligations%ROWTYPE;
  v_prior_context text := current_setting('app.bounty_obligation_id',true);
  v_result jsonb;
BEGIN
  SELECT * INTO o FROM public.tournament_bounty_obligations WHERE id=p_obligation_id;
  IF NOT FOUND OR o.mode='mystery_chest' THEN
    RETURN jsonb_build_object('ok',false,'reason','bounty_obligation_not_found');
  END IF;
  -- Prove new knockout evidence before the event lane is taken. The payer
  -- re-validates every stored proof against the live rows under the lane.
  IF o.mode='pko' AND o.state='pending' THEN
    PERFORM public.fn_pko_prove_candidate_scopes_v2(o.tournament_id);
  END IF;
  PERFORM set_config('app.bounty_obligation_id',o.id::text,true);
  v_result := public.fn_collect_bounty(
    o.tournament_id,o.eliminated_user_id,o.knocker_user_id,o.claimants);
  PERFORM set_config('app.bounty_obligation_id',COALESCE(v_prior_context,''),true);
  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.fn_pko_candidate_scope_evidence_v2(uuid,uuid[]) OWNER TO postgres;
ALTER FUNCTION public.fn_pko_candidate_scope_proof_states_v2(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.fn_pko_predecessor_proved_scopes_v2(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.fn_pko_prove_candidate_scopes_v2(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_pko_candidate_scope_evidence_v2(uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_pko_candidate_scope_proof_states_v2(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_pko_predecessor_proved_scopes_v2(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_pko_prove_candidate_scopes_v2(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_pko_claim_predecessor_status_v1(uuid,uuid,uuid,uuid,bigint,timestamp with time zone) FROM PUBLIC,anon,authenticated,service_role;
-- The obligation collector keeps its production grants: the engine only.
REVOKE ALL ON FUNCTION public.fn_collect_bounty_obligation(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_collect_bounty_obligation(uuid) TO service_role;

DO $postimage$
BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.fn_pko_claim_predecessor_status_v1(uuid,uuid,uuid,uuid,bigint,timestamp with time zone)'::regprocedure)) IS DISTINCT FROM '87e6efccbe1a83b52c740dfe3ff9bc9f'
   OR md5((SELECT prosrc FROM pg_proc WHERE oid='public.fn_collect_bounty_obligation(uuid)'::regprocedure)) IS DISTINCT FROM '919f48c3b6513d6cd4e79ea893863ecd'
   OR (SELECT proacl::text FROM pg_proc WHERE oid='public.fn_collect_bounty_obligation(uuid)'::regprocedure)
      IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
   OR md5((SELECT prosrc FROM pg_proc WHERE oid='public.fn_pko_predecessor_accepted_scopes_v1(uuid,uuid)'::regprocedure)) IS DISTINCT FROM '028fc1f4d728d5ff246dee7a5eeb8e31' THEN
  RAISE EXCEPTION 'PKO stored proof postimage differs';
 END IF;
END $postimage$;
COMMIT;
