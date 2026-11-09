-- ═══════════════════════════════════════════════════════════════════════════════
-- THE REFERRAL UPLINE IS RESOLVED BEFORE THE CLUB-OWNER FALLBACK
--
-- Dan, 2026-11-08, binding:
--
--   "super agents and agents who had referrals under them (and signed up and
--    used there referral link) are not connected to them in the downlines...
--    recconect any and all players by the player they were referred by or whos
--    referral link they clicked to join. If they had no link or referral ID,
--    keep them exactly where they are."
--
-- ── WHAT WENT WRONG ───────────────────────────────────────────────────────────
--
-- The 2026-10-25 orphan ruling ("any orphaned player or agent with no agent is
-- assigned to the club owner -- KINGFISH for KINGS CLUB players") was correct.
-- Its IMPLEMENTATION inverted it into an owner-FIRST placement:
--
--   fn_join_club_membership_impl writes agent_id = <club owner> on the INSERT,
--   before any referral code has been read. Every member is therefore born in
--   the owner's downline, and the referral is expected to move them out later.
--
-- The one piece of code that could move them out -- fn_redeem_club_invite_code
-- -- only did so while `invited_by IS NULL`:
--
--   agent_id = CASE WHEN agent_id IS NULL
--                     OR (agent_id = <owner> AND invited_by IS NULL)
--                   THEN coalesce(v_effective_agent, <owner>)
--                   ELSE agent_id END,
--   invited_by = coalesce(invited_by, v_inviter.id),
--
-- The same statement fills invited_by in. So the correction gets exactly ONE
-- attempt, and if `v_effective_agent` happens to be NULL at that instant -- the
-- inviter's membership row not yet 'active'/'approved'/'automatic', or the
-- inviter not yet an agent -- the player is written back to the owner and the
-- predicate can never match again. The placement is then indistinguishable from
-- a downline somebody chose, while the referral evidence sits untouched three
-- tables away.
--
-- Measured in KINGS CLUB on 2026-11-08, seven players, two failure modes:
--
--   never corrected at all  3Putt, greedygoblin, Tootricky4u
--     (attribution left at 'signed_up'/'verified', or platform-level referral
--      only -- the redeem path never completed, so the join-time owner
--      placement simply stood)
--
--   corrected to the owner,  MichaelJordan, plataoplomo007, WhatTheBell,
--   then locked              Dagobaby
--     (attribution 'joined' and invited_by correctly stamped, agent_id still
--      the owner -- Dagobaby is the clearest: Thediamond did not become an
--      agent until 2026-11-07, eight days after Dagobaby joined, and nothing
--      ever re-asked the question)
--
-- ── WHAT THIS MIGRATION ADDS ─────────────────────────────────────────────────
--
-- Two primitives every assignment path will share (wired up in the next
-- migration), plus an honest record of how each placement was made so that
-- "nobody chose this" stops being inferred from a flag that lies:
--
--   fn_referral_referrer        - who the referral evidence names
--   fn_resolve_referral_upline  - where that referrer puts the player
--   fn_club_placement_is_unchosen - may this placement be overridden at all
--   club_members.agent_assignment_source - how the current agent_id was chosen
--
-- This migration changes NO player's placement. It is additive only; the one
-- UPDATE labels the ten corrections already applied on 2026-11-08.
--
-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
--   DROP FUNCTION public.fn_club_placement_is_unchosen(uuid,uuid);
--   DROP FUNCTION public.fn_resolve_referral_upline(uuid,uuid);
--   DROP FUNCTION public.fn_referral_referrer(uuid,uuid);
--   ALTER TABLE public.club_members DROP COLUMN agent_assignment_source;
-- (Safe only before the next migration, which calls them.)
-- ═══════════════════════════════════════════════════════════════════════════════

-- CLAUDE.md Production DDL policy rule 9: take the lock once, briefly.
BEGIN;

SET LOCAL lock_timeout = '1s';

ALTER TABLE public.club_members
  ADD COLUMN IF NOT EXISTS agent_assignment_source text;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'club_members_agent_assignment_source_check') THEN
    ALTER TABLE public.club_members
      ADD CONSTRAINT club_members_agent_assignment_source_check
      CHECK (agent_assignment_source IS NULL OR agent_assignment_source IN
             ('join_fallback','referral','manual_transfer','agent_attach','upline_removed'));
  END IF;
END
$do$;

-- WITHHELD from the browser: agent_assignment_source is operator bookkeeping,
-- not player-facing. club_members carries COLUMN-level SELECT for anon and
-- authenticated since the horse-identity close, so a new column is unreadable
-- until it is granted - and this one is deliberately not granted. Nothing in
-- the client reads it; the assignment paths that do are SECURITY DEFINER and
-- run as the owner. (tests/horse-identity-is-not-readable.law.test.ts)

COMMENT ON COLUMN public.club_members.agent_assignment_source IS
 'How the current agent_id was chosen. join_fallback = the club-owner placement made at join that nobody chose; referral = resolved from a referral link or referral ID; manual_transfer = an authorized reassignment; agent_attach = an agent or staff member added the player deliberately; upline_removed = reparented because the upline left. Only join_fallback (and a NULL agent_id) may be overridden automatically.';

-- ── Who does the referral evidence name? ─────────────────────────────────────
-- The platform's existing supported order, strongest first: the club invite the
-- player actually clicked, the invited_by stamped on the membership, the
-- platform referral row, the profile's referred_by. A blocked attribution
-- (a refused self-referral) is not evidence.
CREATE OR REPLACE FUNCTION public.fn_referral_referrer(p_club_id uuid, p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT x.inviter_id FROM public.club_invite_attributions x
      WHERE x.club_id = p_club_id AND x.user_id = p_user_id
        AND x.block_reason IS NULL AND x.status IS DISTINCT FROM 'blocked'
      ORDER BY x.first_clicked_at NULLS LAST, x.claimed_at
      LIMIT 1),
    (SELECT m.invited_by FROM public.club_members m
      WHERE m.club_id = p_club_id AND m.user_id = p_user_id),
    (SELECT r.referrer_id FROM public.referrals r
      WHERE r.referee_id = p_user_id ORDER BY r.created_at LIMIT 1),
    (SELECT pr.referred_by FROM public.profiles pr WHERE pr.id = p_user_id)
  )
$function$;

-- ── Where does that referrer put the player? ─────────────────────────────────
-- Exactly the mapping fn_redeem_club_invite_code has always used: an inviter who
-- is an active agent in THIS club takes the player directly; an inviter who is
-- only a settled member passes the player to their own upline; an inviter who
-- has left or was never here resolves to nothing and the caller falls back to
-- the owner. Unlike the old one-shot, this can be asked again at any time, so an
-- inviter who becomes an agent later is no longer missed.
--
-- Returns NULL rather than anything that would cross a club boundary, name the
-- player themselves, or close a cycle.
CREATE OR REPLACE FUNCTION public.fn_resolve_referral_upline(p_club_id uuid, p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_referrer uuid;
  v_member   record;
  v_upline   uuid;
BEGIN
  IF p_club_id IS NULL OR p_user_id IS NULL THEN RETURN NULL; END IF;

  v_referrer := public.fn_referral_referrer(p_club_id, p_user_id);
  IF v_referrer IS NULL OR v_referrer = p_user_id THEN RETURN NULL; END IF;

  IF EXISTS (SELECT 1 FROM public.agents a
              WHERE a.club_id = p_club_id AND a.user_id = v_referrer
                AND a.status = 'active') THEN
    v_upline := v_referrer;
  ELSE
    SELECT * INTO v_member FROM public.club_members m
     WHERE m.club_id = p_club_id AND m.user_id = v_referrer;
    IF NOT FOUND OR v_member.status NOT IN ('active','approved','automatic') THEN
      RETURN NULL;
    END IF;
    v_upline := v_member.agent_id;
  END IF;

  IF v_upline IS NULL OR v_upline = p_user_id THEN RETURN NULL; END IF;

  -- The resolved upline must be a live member of THIS club.
  IF NOT EXISTS (SELECT 1 FROM public.club_members m
                  WHERE m.club_id = p_club_id AND m.user_id = v_upline
                    AND m.status IN ('active','approved','automatic')) THEN
    RETURN NULL;
  END IF;

  -- Never close a loop: refuse an upline that already sits below the player.
  IF public.fn_club_is_in_downline(p_club_id, p_user_id, v_upline) THEN
    RETURN NULL;
  END IF;

  RETURN v_upline;
END
$function$;

-- ── Is the current placement one nobody chose? ───────────────────────────────
-- Only two placements may be overridden automatically: no upline at all, and the
-- club-owner placement the join fallback made. Anything an agent, an owner or an
-- authorized reassignment deliberately chose is preserved -- INCLUDING a
-- deliberate placement under the owner, which the old invited_by test could not
-- tell apart from the fallback.
--
-- Rows written before this migration carry no source. For those we fall back to
-- the only deliberate-owner-placement signal the old code left behind:
-- fn_agent_attach_player stamps invited_by with the attaching agent, so an owner
-- placement whose invited_by IS the owner was chosen, and one whose invited_by is
-- NULL or someone else was not. That inference applies ONLY to legacy rows;
-- every row written from here on records its source explicitly.
CREATE OR REPLACE FUNCTION public.fn_club_placement_is_unchosen(p_club_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_m record; v_owner uuid;
BEGIN
  SELECT * INTO v_m FROM public.club_members m
   WHERE m.club_id = p_club_id AND m.user_id = p_user_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_m.agent_id IS NULL THEN RETURN true; END IF;

  IF v_m.agent_assignment_source IN ('manual_transfer','agent_attach','referral','upline_removed') THEN
    RETURN false;
  END IF;

  -- An authorized reassignment is always deliberate, however the row is tagged.
  IF EXISTS (SELECT 1 FROM public.club_assignment_operations o
              WHERE o.club_id = p_club_id AND v_m.user_id = ANY(o.member_user_ids)) THEN
    RETURN false;
  END IF;

  SELECT c.owner_id INTO v_owner FROM public.clubs c WHERE c.id = p_club_id;
  IF v_m.agent_id IS DISTINCT FROM v_owner THEN RETURN false; END IF;

  IF v_m.agent_assignment_source = 'join_fallback' THEN RETURN true; END IF;

  RETURN v_m.invited_by IS DISTINCT FROM v_owner;
END
$function$;

-- Postgres grants EXECUTE to PUBLIC on every new function, and silence is "open
-- to everyone", not "closed" (scripts/ci/check-definer-authorization.mjs, after
-- fn_bbj_unclaimed_shares on 2026-09-06). These three are internal helpers for
-- the SECURITY DEFINER assignment paths, which call them as their own owner;
-- nobody in a browser has any reason to reach them.
REVOKE ALL ON FUNCTION public.fn_referral_referrer(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_resolve_referral_upline(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_club_placement_is_unchosen(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_referral_referrer(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_resolve_referral_upline(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_club_placement_is_unchosen(uuid,uuid) TO service_role;

-- The ten corrections applied on 2026-11-08 are recorded as what they are:
-- placements resolved from referral evidence, not fallbacks.
UPDATE public.club_members m
   SET agent_assignment_source = 'referral'
  FROM public.kings_club_downline_repair_20261108 s
 WHERE s.scope = 'club_members.agent_id'
   AND s.applied
   AND m.user_id = s.subject_user_id
   AND m.club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'
   AND m.agent_assignment_source IS NULL;

COMMIT;
