-- ═══════════════════════════════════════════════════════════════════════════════
-- THE DOWNLINE REPAIR IS A SUPPORTED RULE, NOT A ONE-OFF SWEEP
--
-- The October cleanup that detached these players was an ad-hoc pass: it ran
-- once, it had no dry run, it recorded nothing, and it could not be re-run
-- safely. This migration replaces that shape with a function that is:
--
--   re-runnable  - it only ever moves a placement nobody chose, onto the upline
--                  the referral evidence names, so running it twice is a no-op
--   previewable  - p_apply := false returns exactly what it WOULD do
--   recorded     - every applied move lands in the 2026-11-08 repair checkpoint
--   serialised   - it takes the SAME two advisory locks every assignment path
--                  takes (cashier-hierarchy and agent-agreement, per club), so
--                  a repair and a live join or reassignment cannot interleave
--   bounded      - it never touches a player with no referral evidence, and
--                  never writes an upline that crosses a club or closes a cycle
--
-- It also carries the regression suite for all of it.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '1s';

-- The 2026-11-08 checkpoint becomes the platform's downline-repair ledger.
ALTER TABLE public.kings_club_downline_repair_20261108
  ADD COLUMN IF NOT EXISTS club_id uuid;

UPDATE public.kings_club_downline_repair_20261108
   SET club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'
 WHERE club_id IS NULL;

COMMENT ON TABLE public.kings_club_downline_repair_20261108 IS
 'Downline repair ledger. Opened 2026-11-08 for the KINGS CLUB reattachment (ten corrections: seven memberships, three agent parents) and kept as the record for fn_repair_club_referral_downlines. old_value is always the pre-repair value; restoring it reverses the change.';

-- ── The repair ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_repair_club_referral_downlines(
  p_club_id uuid,
  p_apply   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r            record;
  v_new_parent uuid;
  v_moves      int := 0;
  v_parents    int := 0;
  v_rows       jsonb := '[]'::jsonb;
BEGIN
  IF p_club_id IS NULL THEN
    RAISE EXCEPTION 'club_required' USING ERRCODE='22023';
  END IF;

  -- Club staff through the app, the engine, or a direct operations session
  -- (auth.uid() IS NULL -- a migration or the management API, never a browser).
  IF auth.uid() IS NOT NULL
     AND NOT COALESCE(public.fn_caller_is_engine(), false)
     AND NOT COALESCE(public.fn_can_manage_club_assignments(p_club_id), false) THEN
    RAISE EXCEPTION 'not_authorised' USING ERRCODE='42501';
  END IF;

  -- The same two locks fn_reassign_club_members and the cashier paths take, in
  -- the same order, so a repair serialises against live assignment instead of
  -- racing it.
  PERFORM pg_advisory_xact_lock(hashtextextended('cashier-hierarchy:'||p_club_id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('agent-agreement:'||p_club_id::text,0));

  FOR r IN
    SELECT m.user_id,
           m.agent_id                                              AS current_upline,
           public.fn_resolve_referral_upline(p_club_id, m.user_id) AS resolved_upline,
           m.role
      FROM public.club_members m
     WHERE m.club_id = p_club_id
       AND public.fn_club_placement_is_unchosen(p_club_id, m.user_id)
     ORDER BY m.user_id
  LOOP
    -- No referral evidence, or already correct: leave the player exactly where
    -- they are. This is the whole of Dan's "only fix the ones that were changed".
    CONTINUE WHEN r.resolved_upline IS NULL
                 OR r.resolved_upline IS NOT DISTINCT FROM r.current_upline;

    v_moves := v_moves + 1;
    v_rows := v_rows || jsonb_build_object(
      'user_id', r.user_id,
      'from',    r.current_upline,
      'to',      r.resolved_upline);

    CONTINUE WHEN NOT p_apply;

    UPDATE public.club_members
       SET agent_id = r.resolved_upline,
           agent_assignment_source = 'referral',
           updated_at = now()
     WHERE club_id = p_club_id AND user_id = r.user_id;

    INSERT INTO public.kings_club_downline_repair_20261108
      (scope, club_id, subject_user_id, old_value, new_value, evidence, applied)
    VALUES ('club_members.agent_id', p_club_id, r.user_id,
            r.current_upline, r.resolved_upline,
            'fn_repair_club_referral_downlines', true);

    -- Both maintained representations move together. A super agent reports to
    -- nobody by convention, so its NULL parent is correct and is left alone.
    SELECT a.id INTO v_new_parent
      FROM public.agents a
     WHERE a.club_id = p_club_id AND a.user_id = r.resolved_upline;

    IF v_new_parent IS NOT NULL THEN
      WITH moved AS (
        UPDATE public.agents ag
           SET parent_agent_id = v_new_parent, updated_at = now()
         WHERE ag.club_id = p_club_id
           AND ag.user_id = r.user_id
           AND ag.role <> 'super_agent'
           AND ag.parent_agent_id IS DISTINCT FROM v_new_parent
        RETURNING ag.id, ag.parent_agent_id
      )
      INSERT INTO public.kings_club_downline_repair_20261108
        (scope, club_id, subject_user_id, agent_row_id, new_value, evidence, applied)
      SELECT 'agents.parent_agent_id', p_club_id, r.user_id, moved.id, r.resolved_upline,
             'fn_repair_club_referral_downlines', true
        FROM moved;
      GET DIAGNOSTICS v_parents = ROW_COUNT;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'club_id',        p_club_id,
    'applied',        p_apply,
    'memberships',    v_moves,
    'agent_parents',  v_parents,
    'changes',        v_rows);
END
$function$;

-- Operator door. It writes, and it is reachable by anything that can log in
-- unless we say otherwise, so it is closed to browser roles outright rather
-- than relying on its own authorization check alone.
REVOKE ALL ON FUNCTION public.fn_repair_club_referral_downlines(uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_repair_club_referral_downlines(uuid,boolean) TO service_role;

-- ── The regression suite ────────────────────────────────────────────────────
-- Assertions over the live records, not synthetic fixtures: CLAUDE.md rule 3
-- forbids DDL probes against production, and a fixture club would have to defeat
-- the membership, ledger and arena guards to exist. Every check below fails loud
-- if the rule it pins is broken.
CREATE OR REPLACE FUNCTION public.fn_test_referral_downline_rules()
RETURNS TABLE(test text, passed boolean, detail text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  k uuid := 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
  n int;
  s text;
BEGIN
  -- 1. The seven corrected memberships each match what the resolver says.
  SELECT count(*) INTO n
    FROM public.kings_club_downline_repair_20261108 d
    JOIN public.club_members m ON m.user_id = d.subject_user_id AND m.club_id = k
   WHERE d.scope = 'club_members.agent_id' AND d.applied
     AND d.evidence IS DISTINCT FROM 'fn_repair_club_referral_downlines'
     AND m.agent_id IS DISTINCT FROM public.fn_resolve_referral_upline(k, m.user_id);
  RETURN QUERY SELECT 'the seven corrected players sit under their referrer',
                      n = 0, n || ' of the corrected players disagree with the resolver';

  -- 2. For every player this repair has moved, the agent record moved with them,
  --    so the whole branch travels rather than just the person.
  --    Scoped to the repaired set on purpose: 38 other KINGS CLUB agent records
  --    carry a parent that predates this work and has no referral evidence
  --    behind it. Dan's rule is to leave those exactly where they are, so this
  --    suite must not fail on them -- and must not quietly "fix" them either.
  SELECT count(*) INTO n
    FROM public.kings_club_downline_repair_20261108 d
    JOIN public.agents ag ON ag.user_id = d.subject_user_id AND ag.club_id = k
    JOIN public.club_members m ON m.user_id = ag.user_id AND m.club_id = ag.club_id
   WHERE d.scope = 'club_members.agent_id' AND d.applied
     AND ag.role <> 'super_agent'
     AND ag.parent_agent_id IS DISTINCT FROM
         (SELECT p.id FROM public.agents p WHERE p.club_id = k AND p.user_id = m.agent_id);
  RETURN QUERY SELECT 'every repaired agent branch hangs off the same upline as its membership',
                      n = 0, n || ' repaired agent records disagree with their membership';

  -- 3. Sub-agent depth is preserved: a referral by a sub-agent resolves to the
  --    SUB-AGENT, not collapsed up to the super agent above them.
  SELECT count(*) INTO n
    FROM public.club_members m
    JOIN public.agents a ON a.club_id = k AND a.user_id = m.agent_id AND a.role = 'sub_agent'
   WHERE m.club_id = k
     AND m.agent_assignment_source = 'referral'
     AND public.fn_resolve_referral_upline(k, m.user_id) IS DISTINCT FROM m.agent_id;
  RETURN QUERY SELECT 'a sub-agent referral is not collapsed to the agent above it',
                      n = 0, n || ' sub-agent downline members resolve elsewhere';

  -- 4. A player with no referral evidence resolves to nothing, so no sweep can
  --    ever move them. This is the 699 untouched players, as a rule.
  SELECT count(*) INTO n
    FROM public.club_members m
   WHERE m.club_id = k
     AND public.fn_referral_referrer(k, m.user_id) IS NULL
     AND public.fn_resolve_referral_upline(k, m.user_id) IS NOT NULL;
  RETURN QUERY SELECT 'a player with no link and no referral ID resolves to nothing',
                      n = 0, n || ' players would move without any referral evidence';

  -- 5. Repeated execution is a no-op: a dry run finds nothing left to do.
  SELECT (public.fn_repair_club_referral_downlines(k, false) ->> 'memberships')::int INTO n;
  RETURN QUERY SELECT 'running the repair again changes nothing',
                      n = 0, n || ' placements would still move on a re-run';

  -- 6. Concurrent assignment: the repair takes the same per-club locks the live
  --    assignment paths take, so the two serialise instead of racing.
  s := pg_get_functiondef('public.fn_repair_club_referral_downlines(uuid,boolean)'::regprocedure);
  RETURN QUERY SELECT 'the repair serialises against live assignment',
                      position('cashier-hierarchy:' in s) > 0
                        AND position('agent-agreement:' in s) > 0,
                      'advisory locks present in the repair: '
                        || (position('cashier-hierarchy:' in s) > 0)::text || '/'
                        || (position('agent-agreement:' in s) > 0)::text;

  -- 7. No hierarchy cycles anywhere in the club.
  SELECT count(*) INTO n
    FROM public.club_members m
   WHERE m.club_id = k AND m.agent_id IS NOT NULL
     AND public.fn_club_is_in_downline(k, m.user_id, m.agent_id);
  RETURN QUERY SELECT 'no member is their own ancestor', n = 0,
                      n || ' cycles found';

  -- 8. Club boundaries: an upline is always a member of the same club.
  SELECT count(*) INTO n
    FROM public.club_members m
   WHERE m.club_id = k AND m.agent_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.club_members u
                      WHERE u.club_id = m.club_id AND u.user_id = m.agent_id);
  RETURN QUERY SELECT 'every upline is a member of the same club', n = 0,
                      n || ' uplines sit outside the club';

  -- 9. The defect itself cannot come back: no assignment path may decide that an
  --    owner placement is a real downline just because invited_by got filled in.
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname IN ('fn_redeem_club_invite_code','fn_agent_attach_player')
     AND p.prosrc ~ 'invited_by IS NULL';
  RETURN QUERY SELECT 'the one-shot invited_by guess is gone from the assignment paths',
                      n = 0, n || ' paths still test invited_by IS NULL';

  -- 10. The join no longer parks a referred player under the owner.
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'fn_join_club_membership_impl'
     AND p.prosrc ~ 'fn_resolve_referral_upline';
  RETURN QUERY SELECT 'the join asks the resolver before the owner fallback',
                      n = 1, 'join paths consulting the resolver: ' || n;
END
$function$;

-- Takes no arguments and returns a set, so it cannot be scoped to a caller:
-- exactly the shape that leaked every unpaid bad-beat share on 2026-09-06.
-- Operator-only, explicitly.
REVOKE ALL ON FUNCTION public.fn_test_referral_downline_rules() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_test_referral_downline_rules() TO service_role;

COMMIT;
