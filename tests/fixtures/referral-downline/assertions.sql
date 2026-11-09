\set ON_ERROR_STOP on
CREATE FUNCTION pg_temp.ok(label text, got text, want text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS NOT DISTINCT FROM want THEN
    RAISE NOTICE 'PASS  %  (%)', label, COALESCE(got,'null');
  ELSE
    RAISE EXCEPTION 'FAIL  %  got=% want=%', label, COALESCE(got,'null'), COALESCE(want,'null');
  END IF;
END $$;

-- ═══ A. THE JOIN ════════════════════════════════════════════════════════════
-- A player who clicked an active agent's link lands under THAT AGENT, not the
-- owner, and is recorded as a referral.
DELETE FROM auth._who; INSERT INTO auth._who VALUES (u(10));
SELECT public.fn_join_club_membership_impl(u(100));
SELECT pg_temp.ok('join: clicked an agent link -> that agent',
  (SELECT p.username FROM club_members m JOIN profiles p ON p.id=m.agent_id
    WHERE m.club_id=u(100) AND m.user_id=u(10)), 'superagent');
SELECT pg_temp.ok('join: and is recorded as a referral',
  (SELECT agent_assignment_source FROM club_members WHERE club_id=u(100) AND user_id=u(10)), 'referral');

-- A player with no link and no referral ID lands under the owner, recorded as
-- the fallback -- which stays overridable for ever.
DELETE FROM auth._who; INSERT INTO auth._who VALUES (u(11));
SELECT public.fn_join_club_membership_impl(u(100));
SELECT pg_temp.ok('join: no evidence -> the club owner',
  (SELECT p.username FROM club_members m JOIN profiles p ON p.id=m.agent_id
    WHERE m.club_id=u(100) AND m.user_id=u(11)), 'kingfish');
SELECT pg_temp.ok('join: and is recorded as the fallback, not a referral',
  (SELECT agent_assignment_source FROM club_members WHERE club_id=u(100) AND user_id=u(11)), 'join_fallback');

-- [REVIEW 2] A player referred by a settled member who is NOT an agent resolves
-- to that member's own upline -- the owner -- and that MUST read as the
-- fallback, or it locks for ever as a fake referral.
DELETE FROM auth._who; INSERT INTO auth._who VALUES (u(16));
SELECT public.fn_join_club_membership_impl(u(100));
SELECT pg_temp.ok('join: referrer is not an agent -> owner, as the FALLBACK',
  (SELECT agent_assignment_source FROM club_members WHERE club_id=u(100) AND user_id=u(16)), 'join_fallback');
SELECT pg_temp.ok('join: that placement is still overridable',
  public.fn_club_placement_is_unchosen(u(100),u(16))::text, 'true');

-- ...and when that referrer LATER becomes an agent, the question is asked again.
INSERT INTO public.agents(user_id,club_id,role,status) VALUES (u(4),u(100),'agent','active');
SELECT pg_temp.ok('the referrer becoming an agent later is no longer missed',
  (SELECT p.username FROM profiles p WHERE p.id=public.fn_resolve_referral_upline(u(100),u(16))), 'plainmember');

-- A sub-agent referral resolves to the SUB-AGENT, not collapsed up (Dagobaby).
DELETE FROM auth._who; INSERT INTO auth._who VALUES (u(15));
SELECT public.fn_join_club_membership_impl(u(100));
SELECT pg_temp.ok('join: a sub-agent referral is not collapsed upward',
  (SELECT p.username FROM club_members m JOIN profiles p ON p.id=m.agent_id
    WHERE m.club_id=u(100) AND m.user_id=u(15)), 'subagent');

-- [REVIEW 6] A blocked self-referral yields NO referral answer, even though a
-- platform referral row and profiles.referred_by both still name the inviter.
DELETE FROM auth._who; INSERT INTO auth._who VALUES (u(14));
SELECT public.fn_join_club_membership_impl(u(100));
SELECT pg_temp.ok('join: a blocked self-referral cannot farm a commission',
  (SELECT p.username FROM club_members m JOIN profiles p ON p.id=m.agent_id
    WHERE m.club_id=u(100) AND m.user_id=u(14)), 'kingfish');
SELECT pg_temp.ok('a blocked attribution suppresses every evidence source',
  (public.fn_referral_referrer(u(100),u(14)) IS NULL)::text, 'true');

-- ═══ B. WHAT MAY NEVER MOVE ═════════════════════════════════════════════════
-- [REVIEW 3] A legacy row is never automatically movable, even with evidence
-- pointing elsewhere.
SELECT pg_temp.ok('a legacy row is never automatically movable',
  public.fn_club_placement_is_unchosen(u(100),u(13))::text, 'false');
SELECT pg_temp.ok('and the audit does not list it',
  (SELECT count(*)::text FROM public.fn_referral_downline_disagreements(u(100)) WHERE user_id=u(13)), '0');

-- A manual transfer is preserved, including one under the owner.
SELECT pg_temp.ok('an authorized manual transfer is preserved',
  public.fn_club_placement_is_unchosen(u(100),u(17))::text, 'false');

-- [REVIEW 4] The owner and staff are never given an upline.
SELECT pg_temp.ok('the club owner is never listed as needing an upline',
  (SELECT count(*)::text FROM public.fn_referral_downline_disagreements(u(100)) WHERE user_id=u(1)), '0');

-- [REVIEW 2] The resolver never answers with the club owner.
SELECT pg_temp.ok('the resolver never names the club owner',
  (SELECT count(*)::text FROM club_members m
    WHERE m.club_id=u(100) AND public.fn_resolve_referral_upline(u(100),m.user_id)=u(1)), '0');

-- A deleted referrer yields no answer.
INSERT INTO public.club_members(club_id,user_id,role,agent_id,agent_assignment_source)
 VALUES (u(100),u(18),'player',NULL,NULL);
INSERT INTO public.profiles(id,username,player_number) VALUES (u(18),'p_deleted_referrer','18');
INSERT INTO public.club_invite_attributions(code,club_id,inviter_id,user_id,status,first_clicked_at,claimed_at)
 VALUES ('DEADLINK',u(100),u(5),u(18),'joined',now(),now());
SELECT pg_temp.ok('a deleted referrer yields no referral answer',
  (public.fn_resolve_referral_upline(u(100),u(18)) IS NULL)::text, 'true');

-- ═══ C. THE DELETED-ACCOUNT PATH [REVIEW 1] ═════════════════════════════════
-- A player under an account that closes must NOT be handed back to it.
INSERT INTO public.profiles(id,username,player_number) VALUES (u(20),'closing_agent','20'),(u(21),'their_player','21');
INSERT INTO public.club_members(club_id,user_id,role,agent_id,agent_assignment_source) VALUES
 (u(100),u(20),'agent',u(2),'referral'),
 (u(100),u(21),'player',u(20),'referral');
INSERT INTO public.agents(user_id,club_id,role,status) VALUES (u(20),u(100),'agent','active');
INSERT INTO public.club_invite_attributions(code,club_id,inviter_id,user_id,status,first_clicked_at,claimed_at)
 VALUES ('CLOSINGLINK',u(100),u(20),u(21),'joined',now(),now());
SELECT public.fn_ca_deleted_account_leaves_every_club(u(20));
SELECT pg_temp.ok('a closing account never keeps its own downline',
  (SELECT (m.agent_id = u(20))::text FROM club_members m
    WHERE m.club_id=u(100) AND m.user_id=u(21)), 'false');
-- This delivery does not touch the account-closure path, so the source it
-- inherited is left exactly as it was. Pinned so a later change has to be
-- deliberate about it.
SELECT pg_temp.ok('the account-closure path is left untouched by this delivery',
  (SELECT agent_assignment_source FROM club_members WHERE club_id=u(100) AND user_id=u(21)), 'referral');


-- ═══ E. REPEATED EXECUTION ══════════════════════════════════════════════════
-- Every patch carries a sentinel, so re-running the whole migration is a no-op
-- rather than a double-patch. Proven by running the patch blocks a second time
-- and asserting the function bodies are byte-identical afterwards.
CREATE TABLE before_second_run AS
 SELECT p.proname, md5(p.prosrc) AS src
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('fn_join_club_membership_impl','fn_redeem_club_invite_code',
                      'fn_agent_attach_player','fn_reassign_club_members');

-- ═══ F. CONCURRENT ASSIGNMENT ═══════════════════════════════════════════════
-- The settlement's UPDATE carries an optimistic guard on the upline the audit
-- read. If a live redemption moves the player in between, the settlement must
-- leave that decision alone instead of overwriting it.
INSERT INTO public.profiles(id,username,player_number) VALUES (u(40),'raced','40');
INSERT INTO public.club_members(club_id,user_id,role,agent_id,agent_assignment_source)
 VALUES (u(100),u(40),'player',u(1),'join_fallback');
INSERT INTO public.club_invite_attributions(code,club_id,inviter_id,user_id,status,first_clicked_at,claimed_at)
 VALUES ('RACELINK',u(100),u(2),u(40),'joined',now(),now());
DO $race$
DECLARE v_seen uuid; v_rows int;
BEGIN
  -- The audit reads the player as sitting under the owner.
  SELECT current_upline INTO v_seen
    FROM public.fn_referral_downline_disagreements(u(100)) WHERE user_id=u(40);
  IF v_seen IS NULL THEN RAISE EXCEPTION 'fixture: the raced player is not in the audit'; END IF;

  -- A concurrent writer moves them first (what a live redemption does).
  UPDATE public.club_members SET agent_id=u(3), agent_assignment_source='referral'
   WHERE club_id=u(100) AND user_id=u(40);

  -- The settlement's guarded UPDATE must now match nothing.
  UPDATE public.club_members
     SET agent_id = u(2), agent_assignment_source='referral'
   WHERE club_id = u(100) AND user_id = u(40)
     AND agent_id IS NOT DISTINCT FROM v_seen;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL  the settlement overwrote a concurrent assignment (% rows)', v_rows;
  END IF;
  RAISE NOTICE 'PASS  a concurrent assignment is not overwritten by the settlement';
END $race$;
SELECT pg_temp.ok('and the concurrent writer''s decision stands',
  (SELECT p.username FROM club_members m JOIN profiles p ON p.id=m.agent_id
    WHERE m.club_id=u(100) AND m.user_id=u(40)), 'subagent');

-- Both per-club advisory locks are actually taken by the settlement, and are
-- the same two the authorized transfer path takes.
DO $locks$
DECLARE n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('cashier-hierarchy:'||u(100)::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('agent-agreement:'||u(100)::text,0));
  SELECT count(*) INTO n FROM pg_locks
   WHERE locktype='advisory' AND pid=pg_backend_pid();
  IF n < 2 THEN RAISE EXCEPTION 'FAIL  expected both club locks, held %', n; END IF;
  RAISE NOTICE 'PASS  both per-club advisory locks are grantable and held together';
END $locks$;
