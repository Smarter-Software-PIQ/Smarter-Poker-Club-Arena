-- ═══════════════════════════════════════════════════════════════════════════════
-- THE REMAINING DETACHED PLAYERS ARE SETTLED ONCE, AND A READ-ONLY AUDIT WATCHES
--
-- The cause is fixed in the two migrations before this one: the join no longer
-- parks a referred player under the club owner, and the invite redemption is no
-- longer a one-shot that gives up for ever. Nothing here is load-bearing for
-- correctness going forward.
--
-- WHAT THIS FILE IS NOT. An earlier draft of this work shipped a standing
-- fn_repair_club_referral_downlines() that an operator could re-run. CLAUDE.md
-- 10.12 refuses exactly that, and the gate caught it:
--
--   Dan, 2026-09-07: "I DO NOT WANT CRONS AND 'BACK PAY JOBS'! ... I WANT HARD
--   CODED FIXES AT THE ROOT SOURCE WHEN AN ISSUE IS DISCOVERED! NOT A FUCKING
--   BAND AID!"
--
-- The refusal was correct and is not negotiated here. A standing repair would
-- have been a second system quietly correcting the first for ever, and its
-- existence would have made it easy to stop caring whether the live path was
-- right. So:
--
--   * the DAMAGE is settled ONCE, in this migration, at install time -- which
--     10.9 explicitly sanctions ("a one-off migration, not a schedule");
--   * what remains is a READ-ONLY audit that writes nothing. 10.11 keeps the
--     net beside a real fix and expects it to find nothing. If it ever starts
--     finding something, the cause came back and that is a defect to fix at the
--     source, not a list to work through.
--
-- The seven KINGS CLUB players were already corrected by hand on 2026-11-08.
-- The settlement below is written to be a no-op in that club and to catch any
-- player in ANY club left detached by the same defect.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '1s';

-- The 2026-11-08 checkpoint becomes the platform's downline-correction ledger.
ALTER TABLE public.kings_club_downline_repair_20261108
  ADD COLUMN IF NOT EXISTS club_id uuid;

UPDATE public.kings_club_downline_repair_20261108
   SET club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'
 WHERE club_id IS NULL;

COMMENT ON TABLE public.kings_club_downline_repair_20261108 IS
 'Downline correction ledger. Opened 2026-11-08 for the KINGS CLUB reattachment (ten corrections: seven memberships, three agent parents) and extended by the one-off settlement in 20261109051502. old_value is always the pre-correction value; restoring it reverses the change.';

-- ── The read-only audit ─────────────────────────────────────────────────────
-- Names every player whose placement nobody chose and whose referral evidence
-- points somewhere else. It writes NOTHING. Expected to return zero rows.
CREATE OR REPLACE FUNCTION public.fn_referral_downline_disagreements(p_club_id uuid)
RETURNS TABLE(user_id uuid, current_upline uuid, evidence_says uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT m.user_id, m.agent_id,
         public.fn_resolve_referral_upline(p_club_id, m.user_id)
    FROM public.club_members m
   WHERE m.club_id = p_club_id
     AND public.fn_club_placement_is_unchosen(p_club_id, m.user_id)
     AND public.fn_resolve_referral_upline(p_club_id, m.user_id) IS NOT NULL
     AND public.fn_resolve_referral_upline(p_club_id, m.user_id) IS DISTINCT FROM m.agent_id
   ORDER BY m.user_id
$function$;

-- Operator read. It is scoped by club, but nothing in a browser needs it.
REVOKE ALL ON FUNCTION public.fn_referral_downline_disagreements(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_referral_downline_disagreements(uuid) TO service_role;

-- ── The one-off settlement ──────────────────────────────────────────────────
-- Runs once, here, inside this migration's single transaction. It takes the two
-- per-club advisory locks every assignment path takes, in the same order, so it
-- cannot interleave with a live join, redemption or reassignment.
--
-- It moves a player ONLY when all of these hold:
--   * the placement is one nobody chose (a NULL upline, or the join fallback)
--   * the referral evidence resolves to somebody
--   * that somebody is not where the player already sits
-- A player with no link and no referral ID is never touched. Dan, 2026-11-08:
-- "If they had no link or referral ID, keep them exactly where they are."
DO $settle$
DECLARE
  c            record;
  r            record;
  v_new_parent uuid;
  v_members    int := 0;
  v_parents    int := 0;
BEGIN
  FOR c IN
    SELECT DISTINCT m.club_id
      FROM public.club_members m
      JOIN public.clubs cl ON cl.id = m.club_id
     WHERE cl.asset IS DISTINCT FROM 'diamonds'
       AND COALESCE(cl.lifecycle_status, 'active') <> 'retired'
     ORDER BY m.club_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('cashier-hierarchy:'||c.club_id::text,0));
    PERFORM pg_advisory_xact_lock(hashtextextended('agent-agreement:'||c.club_id::text,0));

    FOR r IN
      SELECT d.user_id, d.current_upline, d.evidence_says
        FROM public.fn_referral_downline_disagreements(c.club_id) d
    LOOP
      UPDATE public.club_members
         SET agent_id = r.evidence_says,
             agent_assignment_source = 'referral',
             updated_at = now()
       WHERE club_id = c.club_id AND user_id = r.user_id;
      v_members := v_members + 1;

      INSERT INTO public.kings_club_downline_repair_20261108
        (scope, club_id, subject_user_id, old_value, new_value, evidence, applied)
      VALUES ('club_members.agent_id', c.club_id, r.user_id,
              r.current_upline, r.evidence_says,
              'one-off settlement 20261109051502', true);

      -- Both maintained representations move together. A super agent reports to
      -- nobody by convention, so its NULL parent is correct and is left alone.
      SELECT a.id INTO v_new_parent
        FROM public.agents a
       WHERE a.club_id = c.club_id AND a.user_id = r.evidence_says;

      IF v_new_parent IS NOT NULL THEN
        WITH moved AS (
          UPDATE public.agents ag
             SET parent_agent_id = v_new_parent, updated_at = now()
           WHERE ag.club_id = c.club_id
             AND ag.user_id = r.user_id
             AND ag.role <> 'super_agent'
             AND ag.parent_agent_id IS DISTINCT FROM v_new_parent
          RETURNING ag.id
        )
        INSERT INTO public.kings_club_downline_repair_20261108
          (scope, club_id, subject_user_id, agent_row_id, new_value, evidence, applied)
        SELECT 'agents.parent_agent_id', c.club_id, r.user_id, moved.id, r.evidence_says,
               'one-off settlement 20261109051502', true
          FROM moved;
        GET DIAGNOSTICS v_parents = ROW_COUNT;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'referral downline settlement: % membership(s), % agent parent(s)',
    v_members, v_parents;
END
$settle$;

-- ── The regression suite ────────────────────────────────────────────────────
-- Assertions over the live records, not synthetic fixtures: CLAUDE.md rule 3
-- forbids DDL probes against production, and a fixture club would have to defeat
-- the membership, ledger and arena guards to exist. Every check fails loud if
-- the rule it pins is broken.
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
  -- 1. The corrected memberships each match what the resolver says.
  SELECT count(*) INTO n
    FROM public.kings_club_downline_repair_20261108 d
    JOIN public.club_members m ON m.user_id = d.subject_user_id AND m.club_id = k
   WHERE d.scope = 'club_members.agent_id' AND d.applied
     AND m.agent_id IS DISTINCT FROM public.fn_resolve_referral_upline(k, m.user_id);
  RETURN QUERY SELECT 'the corrected players sit under their referrer',
                      n = 0, n || ' corrected players disagree with the resolver';

  -- 2. Their agent records moved with them, so the branch travels too.
  --    Scoped to the corrected set on purpose: other KINGS CLUB agent records
  --    carry a parent that predates this work and has no referral evidence
  --    behind it. Dan's rule is to leave those exactly where they are, so this
  --    suite must not fail on them - and must not quietly "fix" them either.
  SELECT count(*) INTO n
    FROM public.kings_club_downline_repair_20261108 d
    JOIN public.agents ag ON ag.user_id = d.subject_user_id AND ag.club_id = k
    JOIN public.club_members m ON m.user_id = ag.user_id AND m.club_id = ag.club_id
   WHERE d.scope = 'club_members.agent_id' AND d.applied
     AND ag.role <> 'super_agent'
     AND ag.parent_agent_id IS DISTINCT FROM
         (SELECT p.id FROM public.agents p WHERE p.club_id = k AND p.user_id = m.agent_id);
  RETURN QUERY SELECT 'every corrected agent branch hangs off the same upline as its membership',
                      n = 0, n || ' corrected agent records disagree with their membership';

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

  -- 4. A player with no referral evidence resolves to nothing, so nothing can
  --    ever move them. This is the 699 untouched players, as a rule.
  SELECT count(*) INTO n
    FROM public.club_members m
   WHERE m.club_id = k
     AND public.fn_referral_referrer(k, m.user_id) IS NULL
     AND public.fn_resolve_referral_upline(k, m.user_id) IS NOT NULL;
  RETURN QUERY SELECT 'a player with no link and no referral ID resolves to nothing',
                      n = 0, n || ' players would move without any referral evidence';

  -- 5. Settled and staying settled: the audit finds nothing left to correct.
  --    Re-running this check is the whole of "repeated execution" now that there
  --    is no standing repair to re-run.
  SELECT count(*) INTO n FROM public.fn_referral_downline_disagreements(k);
  RETURN QUERY SELECT 'the audit finds nothing left to correct',
                      n = 0, n || ' placements still disagree with their referral evidence';

  -- 6. Concurrent assignment. An authorized transfer still serialises on the
  --    per-club agreement lock, and the redemption path now reads whether a
  --    placement may be overridden BEFORE its UPDATE, into a variable - so the
  --    answer cannot depend on what that same statement writes. That was the
  --    original defect, and it is what a concurrent write would re-expose.
  s := pg_get_functiondef('public.fn_reassign_club_members(uuid,uuid[],uuid,uuid,uuid)'::regprocedure);
  RETURN QUERY SELECT 'an authorized transfer still serialises on the club agreement lock',
                      position('agent-agreement:' in s) > 0,
                      'advisory lock present in the transfer path';

  s := pg_get_functiondef('public.fn_redeem_club_invite_code(uuid,uuid,text)'::regprocedure);
  RETURN QUERY SELECT 'the redemption decides before it writes, not from its own write',
                      position('v_unchosen := public.fn_club_placement_is_unchosen' in s) > 0
                        AND position('WHEN v_unchosen' in s) > 0,
                      'placement read into a variable ahead of the update';

  -- 7. No hierarchy cycles anywhere in the club.
  SELECT count(*) INTO n
    FROM public.club_members m
   WHERE m.club_id = k AND m.agent_id IS NOT NULL
     AND public.fn_club_is_in_downline(k, m.user_id, m.agent_id);
  RETURN QUERY SELECT 'no member is their own ancestor', n = 0, n || ' cycles found';

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

REVOKE ALL ON FUNCTION public.fn_test_referral_downline_rules() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_test_referral_downline_rules() TO service_role;

COMMIT;
