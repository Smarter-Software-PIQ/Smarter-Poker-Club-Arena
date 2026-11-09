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
-- Dan, 2026-11-09, scope:
--
--   "My authorization covers KINGS CLUB's proven referral mismatches. Remove the
--    proposed all-club cleanup from this delivery."
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
-- The one path that could move them out -- fn_redeem_club_invite_code -- only
-- did so while `invited_by IS NULL`:
--
--   agent_id = CASE WHEN agent_id IS NULL
--                     OR (agent_id = <owner> AND invited_by IS NULL)
--                   THEN coalesce(v_effective_agent, <owner>)
--                   ELSE agent_id END,
--   invited_by = coalesce(invited_by, v_inviter.id),
--
-- The same statement fills invited_by in. So the correction got exactly ONE
-- attempt, and if `v_effective_agent` was NULL at that instant -- the inviter's
-- membership not yet settled, or the inviter not yet an agent -- the player was
-- written back to the owner and the predicate could never match again.
--
-- Measured in KINGS CLUB on 2026-11-08, seven players, two failure modes:
--   never corrected at all   3Putt, greedygoblin, Tootricky4u
--   corrected to the owner,  MichaelJordan, plataoplomo007, WhatTheBell,
--   then locked              Dagobaby
-- Dagobaby is the clearest: Thediamond did not become an agent until
-- 2026-11-07, eight days after Dagobaby joined, and nothing re-asked.
--
-- Those seven (and three agent-parent records) were corrected by hand on
-- 2026-11-08. This migration fixes the SOURCE.
--
-- ── WHAT AN INDEPENDENT REVIEW CHANGED, 2026-11-09 ───────────────────────────
--
-- An earlier draft of this work was reviewed by a separate agent that had not
-- written it. Four of its findings changed the design, and each is marked
-- [REVIEW n] at the code below. They are recorded because each one is a trap
-- the obvious implementation walks into:
--
--   [REVIEW 1] The draft also taught fn_ca_deleted_account_leaves_every_club to
--     consult the resolver. That call sat BEFORE the step that suspends and
--     departs the closing account, so the resolver still saw it as live and
--     returned it -- re-homing the player under the very account being deleted.
--     That path is NOT touched by this delivery at all, and this delivery does
--     not harden it or assert anything about it: account-closure reparenting
--     belongs to another lane, and this task's authorization is KINGS CLUB's
--     proven referral mismatches. The interaction is written up for that lane's
--     owner in docs/changelog/2026-11-09-kings-club-referral-downlines.md.
--
--   [REVIEW 2] The resolver's second branch returns the referrer's own upline,
--     which for a settled non-agent referrer IS the club owner. The draft then
--     labelled that 'referral', which made it non-overridable -- recreating the
--     Dagobaby lock with a different flag. The resolver now returns NULL when it
--     resolves to the club owner, so the caller falls back to the owner and
--     labels it 'join_fallback', which stays overridable for ever.
--
--   [REVIEW 3] The draft's placement test inferred, for rows written before this
--     migration, that an owner placement was "nobody's choice" when invited_by
--     was NULL or named a third party. Measured: 639 KINGS CLUB rows match that
--     shape. Dan authorized seven proven mismatches, not 639 inferred ones, so
--     the inference is GONE. A legacy row is never automatically movable; only a
--     NULL upline or a placement this migration's own code recorded as
--     'join_fallback' is.
--
--   [REVIEW 4] The draft's settlement had no role, lifecycle or blast-radius
--     bound. Measured: 5 KINGS CLUB rows with a NULL upline are the owner and
--     staff, and 650 rows are non-active or departed. It now excludes the owner,
--     staff and departed history, and ABORTS if it would move more than the
--     seven Dan authorized.
--
-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
--   DROP FUNCTION public.fn_test_referral_downline_rules();
--   DROP FUNCTION public.fn_referral_downline_disagreements(uuid);
--   DROP FUNCTION public.fn_club_placement_is_unchosen(uuid,uuid);
--   DROP FUNCTION public.fn_resolve_referral_upline(uuid,uuid);
--   DROP FUNCTION public.fn_referral_referrer(uuid,uuid);
--   ALTER TABLE public.club_members DROP COLUMN agent_assignment_source;
-- and re-run the pre-patch definitions of the four patched functions, which the
-- migrations named in each patch's comment still carry.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- CLAUDE.md DDL policy rule 1: one change, one transaction, one schema reload.
-- Rule 9: take the lock once, briefly, and never retry it in a loop.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

-- ── 0. The correction ledger ────────────────────────────────────────────────
-- Opened on production on 2026-11-08 to hold the rollback record for the ten
-- corrections applied by hand. Its shape is recorded here so this migration
-- installs on a database that does not already carry it (an isolated test
-- route), and so the table stops being unrecorded production DDL. IF NOT EXISTS
-- makes it a no-op in production, which already holds it and its ten rows.
CREATE TABLE IF NOT EXISTS public.kings_club_downline_repair_20261108 (
  id bigserial PRIMARY KEY,
  taken_at timestamptz NOT NULL DEFAULT now(),
  scope text NOT NULL,
  subject_user_id uuid NOT NULL,
  subject_username text,
  agent_row_id uuid,
  old_value uuid,
  new_value uuid,
  old_username text,
  new_username text,
  evidence text,
  applied boolean NOT NULL DEFAULT false
);

-- A new table is open until it is closed: Postgres and Supabase's defaults hand
-- it to the browser roles, so the creation migration declares its access
-- explicitly and turns RLS on (scripts/ci/check-explicit-table-access.mjs).
-- This ledger is operator bookkeeping - no policy is defined, so RLS denies
-- every role that does not bypass it, and only service_role is granted the
-- operations the correction paths need.
ALTER TABLE public.kings_club_downline_repair_20261108 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kings_club_downline_repair_20261108 FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.kings_club_downline_repair_20261108 TO service_role;
REVOKE ALL ON SEQUENCE public.kings_club_downline_repair_20261108_id_seq FROM public, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.kings_club_downline_repair_20261108_id_seq TO service_role;

ALTER TABLE public.kings_club_downline_repair_20261108
  ADD COLUMN IF NOT EXISTS club_id uuid;

UPDATE public.kings_club_downline_repair_20261108
   SET club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'
 WHERE club_id IS NULL;

COMMENT ON TABLE public.kings_club_downline_repair_20261108 IS
 'Checkpoint for the 2026-11-08/09 KINGS CLUB referral-downline correction, and for nothing else. Holds the ten corrections applied by hand (seven memberships, three agent parents), the install-time baseline of the untouched population, and anything the one-off settlement in 20261109052000 moved. old_value is the value replaced AT THE MOMENT OF THE WRITE, so restoring it reverses that change. Another club, or another kind of hierarchy repair, opens its own record.';

-- ── 1. How was this placement chosen? ───────────────────────────────────────
-- WITHHELD from the browser: agent_assignment_source is operator bookkeeping,
-- not player-facing. club_members carries COLUMN-level SELECT for anon and
-- authenticated since the 2026-10-05 horse-identity close, so a new column is
-- unreadable until granted - and this one is deliberately not granted. Nothing
-- in the client reads it; the assignment paths that do are SECURITY DEFINER and
-- run as the owner. (tests/horse-identity-is-not-readable.law.test.ts)
ALTER TABLE public.club_members
  ADD COLUMN IF NOT EXISTS agent_assignment_source text;

-- NOT VALID deliberately: a validating ADD CONSTRAINT scans all of club_members
-- under ACCESS EXCLUSIVE, which blocks seating, joins and the cashier for the
-- length of the scan and can be cancelled mid-transaction by
-- fn_ca_writer_lock_sentinel. Every existing row is NULL, which the constraint
-- allows, so there is nothing to validate. Same shape as 20260906091646.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'club_members_agent_assignment_source_check') THEN
    ALTER TABLE public.club_members
      ADD CONSTRAINT club_members_agent_assignment_source_check
      CHECK (agent_assignment_source IS NULL OR agent_assignment_source IN
             ('join_fallback','referral','manual_transfer','agent_attach'))
      NOT VALID;
  END IF;
END
$do$;

COMMENT ON COLUMN public.club_members.agent_assignment_source IS
 'How the current agent_id was chosen. join_fallback = the club-owner placement made at join that nobody chose; referral = resolved from a referral link or referral ID; manual_transfer = an authorized reassignment; agent_attach = an agent or staff member added the player deliberately. Only join_fallback (and a NULL agent_id) may be overridden automatically. A row written before 2026-11-09 carries NULL and is never automatically movable.';

-- ── 2. Who does the referral evidence name? ─────────────────────────────────
-- The platform's existing supported order, strongest first: the club invite the
-- player actually clicked, the invited_by stamped on the membership, the
-- platform referral row, the profile's referred_by.
--
-- [REVIEW 6] A blocked attribution (a refused self-referral: same device, same
-- phone) now suppresses the WHOLE answer, not just its own branch. Excluding it
-- from branch 1 alone let a 'same_device' block fall through to the platform
-- referral row naming the same inviter, which is the commission farming the
-- block exists to stop.
CREATE OR REPLACE FUNCTION public.fn_referral_referrer(p_club_id uuid, p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN EXISTS (
           SELECT 1 FROM public.club_invite_attributions b
            WHERE b.club_id = p_club_id AND b.user_id = p_user_id
              AND (b.block_reason IS NOT NULL OR b.status = 'blocked')
         ) THEN NULL
  ELSE COALESCE(
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
  ) END
$function$;

-- ── 3. Where does that referrer put the player? ─────────────────────────────
-- The mapping fn_redeem_club_invite_code has always used: an inviter who is an
-- active agent in THIS club takes the player directly; an inviter who is only a
-- settled member passes the player to their own upline. Unlike the old one-shot
-- this can be asked again at any time, so an inviter who becomes an agent later
-- is no longer missed.
--
-- Returns NULL -- meaning "no referral answer, use the fallback" -- rather than
-- anything that would cross a club, name the player, close a cycle, or name the
-- club owner ([REVIEW 2]: an owner placement must stay overridable for ever, so
-- it is never labelled a referral).
--
-- [REVIEW 16] Liveness is the platform's own fn_cashier_member_is_active, the
-- same test fn_club_is_in_downline and fn_reassign_club_members use, so the
-- resolver and the transfer path agree about who can be an upline. It also
-- excludes a deleted profile, which a plain status check does not.
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
  v_owner    uuid;
BEGIN
  IF p_club_id IS NULL OR p_user_id IS NULL THEN RETURN NULL; END IF;

  SELECT c.owner_id INTO v_owner FROM public.clubs c WHERE c.id = p_club_id;

  v_referrer := public.fn_referral_referrer(p_club_id, p_user_id);
  IF v_referrer IS NULL OR v_referrer = p_user_id THEN RETURN NULL; END IF;

  IF EXISTS (SELECT 1 FROM public.agents a
              WHERE a.club_id = p_club_id AND a.user_id = v_referrer
                AND a.status = 'active') THEN
    v_upline := v_referrer;
  ELSE
    SELECT * INTO v_member FROM public.club_members m
     WHERE m.club_id = p_club_id AND m.user_id = v_referrer;
    IF NOT FOUND OR NOT COALESCE(public.fn_cashier_member_is_active(p_club_id, v_referrer), false) THEN
      RETURN NULL;
    END IF;
    v_upline := v_member.agent_id;
  END IF;

  IF v_upline IS NULL OR v_upline = p_user_id THEN RETURN NULL; END IF;

  -- [REVIEW 2] The club owner is the FALLBACK, never a referral answer.
  IF v_upline = v_owner THEN RETURN NULL; END IF;

  IF NOT COALESCE(public.fn_cashier_member_is_active(p_club_id, v_upline), false) THEN
    RETURN NULL;
  END IF;

  -- Never close a loop: refuse an upline that already sits below the player.
  IF public.fn_club_is_in_downline(p_club_id, p_user_id, v_upline) THEN
    RETURN NULL;
  END IF;

  RETURN v_upline;
END
$function$;

-- ── 4. May this placement be overridden at all? ─────────────────────────────
-- Exactly two placements may: no upline at all, and an owner placement that this
-- migration's own code recorded as the join fallback. Everything else is
-- somebody's decision and is preserved -- a manual transfer, an agent attach,
-- and a deliberate placement under the owner alike.
--
-- [REVIEW 3] There is deliberately NO inference for a row written before this
-- migration. The draft read "owner placement + invited_by NULL or a third party"
-- as unchosen; 639 KINGS CLUB rows match that shape, and Dan authorized seven
-- proven mismatches rather than 639 inferred ones. A legacy row therefore
-- answers FALSE and is never moved by the redemption path, the audit or the
-- settlement. Those seven were corrected by hand with their evidence read one
-- by one, which is the only way a legacy row ever moves.
CREATE OR REPLACE FUNCTION public.fn_club_placement_is_unchosen(p_club_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_m record;
BEGIN
  SELECT * INTO v_m FROM public.club_members m
   WHERE m.club_id = p_club_id AND m.user_id = p_user_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- An authorized reassignment is always deliberate, however the row is tagged.
  IF EXISTS (SELECT 1 FROM public.club_assignment_operations o
              WHERE o.club_id = p_club_id AND v_m.user_id = ANY(o.member_user_ids)) THEN
    RETURN false;
  END IF;

  IF v_m.agent_id IS NULL THEN RETURN true; END IF;

  -- COALESCE is load-bearing. A legacy row carries NULL here, and
  -- `NULL = 'join_fallback'` is NULL, not false. A NULL leaking out of this
  -- function poisons every caller's three-valued logic: in the attach guard
  -- `... AND NOT fn_club_placement_is_unchosen(...)` becomes NULL, the IF is
  -- not taken, and the refusal that protects somebody else's downline never
  -- fires -- so any agent could take any legacy member. Found by the isolated
  -- behavioural fixture on 2026-11-09; the production read-only suite could not
  -- see it, because a NULL is not TRUE and its count-the-TRUEs check passed.
  RETURN COALESCE(v_m.agent_assignment_source = 'join_fallback', false);
END
$function$;

-- ── 5. The read-only audit ──────────────────────────────────────────────────
-- Names every player whose placement nobody chose and whose referral evidence
-- points somewhere else. It writes NOTHING and is expected to return zero rows.
-- 10.11 keeps the net beside a real fix; if it ever finds something, the cause
-- came back and that is a source defect, not a worklist.
--
-- [REVIEW 4] The club owner, club staff and departed history are excluded here,
-- in the one place both the settlement and the suite read, so neither can give
-- the owner an upline or rewrite a departed row.
CREATE OR REPLACE FUNCTION public.fn_referral_downline_disagreements(p_club_id uuid)
RETURNS TABLE(user_id uuid, current_upline uuid, evidence_says uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT m.user_id, m.agent_id,
         public.fn_resolve_referral_upline(p_club_id, m.user_id)
    FROM public.club_members m
    JOIN public.clubs c ON c.id = m.club_id
   WHERE m.club_id = p_club_id
     AND m.user_id <> c.owner_id
     AND COALESCE(m.role, 'player') NOT IN ('owner','co_owner','admin')
     AND COALESCE(m.membership_lifecycle_status, 'active') <> 'departed'
     AND m.status IN ('active','approved','automatic')
     AND public.fn_club_placement_is_unchosen(p_club_id, m.user_id)
     AND public.fn_resolve_referral_upline(p_club_id, m.user_id) IS NOT NULL
     AND public.fn_resolve_referral_upline(p_club_id, m.user_id) IS DISTINCT FROM m.agent_id
   ORDER BY m.user_id
$function$;

-- ── 6. The join asks the resolver before the owner fallback ─────────────────
-- Patched by anchored replacement with an assertion rather than retyped blind
-- ([REVIEW 11]: a blind CREATE OR REPLACE silently reverts any drift since the
-- live definition was last written). A drifted anchor aborts this migration.
DO $patch_join$
DECLARE src text; orig text;
BEGIN
  src := pg_get_functiondef('public.fn_join_club_membership_impl(uuid)'::regprocedure);
  IF position('fn_resolve_referral_upline' in src) = 0 THEN
    orig := src;
    src := replace(src,
      '  v_row club_members%ROWTYPE;',
      '  v_resolved uuid;' || chr(10) ||
      '  v_agent uuid;' || chr(10) ||
      '  v_source text;' || chr(10) ||
      '  v_row club_members%ROWTYPE;');
    IF src = orig THEN RAISE EXCEPTION
      'join patch (a): declaration anchor drifted; refusing to patch blind'; END IF;

    orig := src;
    src := replace(src,
      '  -- chip_balance = 0 written EXPLICITLY: the default was 1000 until 2026-08-26.' || chr(10) ||
      '  -- Dan, 2026-10-25: a member with no agent sits under the club owner.' || chr(10) ||
      '  INSERT INTO club_members (club_id, user_id, role, status, tier, rank_level, orange_ball_status, chip_balance, agent_id)' || chr(10) ||
      '  VALUES (p_club_id, v_uid, v_role, v_status, ''bronze'', 0, ''cold'', 0,' || chr(10) ||
      '          CASE WHEN v_uid = v_owner THEN NULL ELSE v_owner END)',
      '  -- chip_balance = 0 written EXPLICITLY: the default was 1000 until 2026-08-26.' || chr(10) ||
      '  -- Dan, 2026-10-25: a member with no agent sits under the club owner.' || chr(10) ||
      '  -- Dan, 2026-11-08: a member who arrived through a referral link or ID' || chr(10) ||
      '  -- belongs to THAT referrer, so the resolver is asked FIRST and the owner' || chr(10) ||
      '  -- is the fallback. The attribution row is written when the link is' || chr(10) ||
      '  -- clicked, so the evidence usually already exists by the time we get here.' || chr(10) ||
      '  IF v_uid = v_owner THEN' || chr(10) ||
      '    v_agent := NULL; v_source := NULL;' || chr(10) ||
      '  ELSE' || chr(10) ||
      '    v_resolved := public.fn_resolve_referral_upline(p_club_id, v_uid);' || chr(10) ||
      '    v_agent := COALESCE(v_resolved, v_owner);' || chr(10) ||
      '    v_source := CASE WHEN v_resolved IS NOT NULL THEN ''referral'' ELSE ''join_fallback'' END;' || chr(10) ||
      '  END IF;' || chr(10) ||
      '  INSERT INTO club_members (club_id, user_id, role, status, tier, rank_level, orange_ball_status, chip_balance, agent_id, agent_assignment_source)' || chr(10) ||
      '  VALUES (p_club_id, v_uid, v_role, v_status, ''bronze'', 0, ''cold'', 0,' || chr(10) ||
      '          v_agent, v_source)');
    IF src = orig THEN RAISE EXCEPTION
      'join patch (b): owner-placement INSERT drifted; refusing to patch blind'; END IF;

    EXECUTE src;
  END IF;
END
$patch_join$;

-- ── 7. The other assignment paths ───────────────────────────────────────────
-- fn_redeem_club_invite_code is 11.5 KB of money-adjacent logic. CLAUDE.md
-- records what retyping a large migration by hand cost on 2026-09-23 (five
-- days, 65 stalled tables), so each is patched by exact anchor with an
-- assertion, and is a no-op if already applied.
DO $patch$
DECLARE src text; orig text;
BEGIN
  ---------------------------------------------------------------------------
  -- 7a. fn_redeem_club_invite_code: the one-shot becomes re-askable.
  --     Last written by 20261016232523, patched by 20261026031314.
  ---------------------------------------------------------------------------
  src := pg_get_functiondef('public.fn_redeem_club_invite_code(uuid,uuid,text)'::regprocedure);
  IF position('fn_club_placement_is_unchosen' in src) = 0 THEN
    orig := src;
    src := replace(src,
      '  v_changed           boolean;',
      '  v_changed           boolean;' || chr(10) ||
      '  v_unchosen          boolean;');
    IF src = orig THEN RAISE EXCEPTION
      'redeem patch (a): declaration anchor drifted; refusing to patch blind'; END IF;

    -- Read the placement BEFORE the update. Whether it may be overridden must
    -- not depend on what this very statement writes -- that was the defect.
    orig := src;
    src := replace(src,
      '  v_prev_status := v_member.status;',
      '  v_unchosen := public.fn_club_placement_is_unchosen(p_club_id, p_user_id);' || chr(10) ||
      '  v_prev_status := v_member.status;');
    IF src = orig THEN RAISE EXCEPTION
      'redeem patch (b): pre-update anchor drifted; refusing to patch blind'; END IF;

    -- The old row-level test is KEPT as an alternative, not replaced. Dropping
    -- it removed the only correction a row written before this migration ever
    -- had: v_unchosen is false for such a row by design, so a legacy member
    -- under the owner with no invited_by could no longer be moved even by
    -- typing a referral code - in every club, since this path is not scoped to
    -- one. Independent review reproduced that on 2026-11-09 (pre-patch
    -- changed=true, post-patch changed=false). [REVIEW 3] was about refusing to
    -- SWEEP 639 inferred rows; it was never about removing a route a player can
    -- ask for themselves, which is what Dan's instruction asks for.
    --
    -- [REVIEW 17] The generic resolver is NOT consulted here. This path already
    -- resolved the inviter the player actually used into v_effective_agent;
    -- falling back to the platform referrer would place the player under someone
    -- other than the code they typed and then record it as that code's referral.
    orig := src;
    src := replace(src,
      '                        WHEN agent_id IS NULL' || chr(10) ||
      '                          OR (agent_id = (SELECT c.owner_id FROM clubs c WHERE c.id = p_club_id)' || chr(10) ||
      '                              AND invited_by IS NULL)' || chr(10) ||
      '                        THEN coalesce(v_effective_agent,',
      '                        WHEN v_unchosen' || chr(10) ||
      '                          OR (agent_id = (SELECT c.owner_id FROM clubs c WHERE c.id = p_club_id)' || chr(10) ||
      '                              AND invited_by IS NULL)' || chr(10) ||
      '                        THEN coalesce(v_effective_agent,');
    IF src = orig THEN RAISE EXCEPTION
      'redeem patch (c): owner-placement predicate drifted; refusing to patch blind'; END IF;

    orig := src;
    src := replace(src,
      '         invited_by = coalesce(invited_by, v_inviter.id),',
      '         invited_by = coalesce(invited_by, v_inviter.id),' || chr(10) ||
      '         agent_assignment_source = CASE' || chr(10) ||
      '             WHEN NOT v_unchosen THEN agent_assignment_source' || chr(10) ||
      '             WHEN v_effective_agent IS NOT NULL THEN ''referral''' || chr(10) ||
      '             ELSE ''join_fallback'' END,');
    IF src = orig THEN RAISE EXCEPTION
      'redeem patch (d): invited_by anchor drifted; refusing to patch blind'; END IF;

    EXECUTE src;
  END IF;

  ---------------------------------------------------------------------------
  -- 7b. fn_agent_attach_player: records how it chose, and nothing more.
  --     Last written by 20260826192916, patched by 20261026031314.
  --
  -- [REVIEW 4] Its authorization predicate is UNCHANGED - literally, not
  -- approximately. This patch only records how the placement was chosen.
  --
  -- A previous version added `AND NOT fn_club_placement_is_unchosen(...)` to the
  -- REFUSAL condition and claimed that changed nothing. Adding a conjunct to a
  -- refusal makes the refusal fire LESS often, so it widened what an agent may
  -- take: a post-install 'join_fallback' row whose invited_by a later redemption
  -- stamped became attachable by ANY agent in the club, where the invite-stamped
  -- row was protected before - and this path never checks that the attacher is
  -- the player's referrer. Independent review reproduced it on 2026-11-09
  -- (pre-patch 'already_in_a_downline', post-patch success). Agent commission
  -- basis follows placement, so that is 10.9 territory. The clause is gone.
  ---------------------------------------------------------------------------
  src := pg_get_functiondef('public.fn_agent_attach_player(uuid,uuid,uuid)'::regprocedure);
  IF position('agent_assignment_source' in src) = 0 THEN
    orig := src;
    src := replace(src,
      '                              orange_ball_status, agent_id, invited_by)' || chr(10) ||
      '    VALUES (p_club_id, p_player_id, ''player'', ''active'', ''bronze'', 0, ''cold'',' || chr(10) ||
      '            p_agent_user_id, p_agent_user_id)',
      '                              orange_ball_status, agent_id, invited_by,' || chr(10) ||
      '                              agent_assignment_source)' || chr(10) ||
      '    VALUES (p_club_id, p_player_id, ''player'', ''active'', ''bronze'', 0, ''cold'',' || chr(10) ||
      '            p_agent_user_id, p_agent_user_id, ''agent_attach'')');
    IF src = orig THEN RAISE EXCEPTION
      'attach patch (b): insert anchor drifted; refusing to patch blind'; END IF;

    orig := src;
    src := replace(src,
      '       SET agent_id   = p_agent_user_id,' || chr(10) ||
      '           invited_by = COALESCE(invited_by, p_agent_user_id),',
      '       SET agent_id   = p_agent_user_id,' || chr(10) ||
      '           agent_assignment_source = ''agent_attach'',' || chr(10) ||
      '           invited_by = COALESCE(invited_by, p_agent_user_id),');
    IF src = orig THEN RAISE EXCEPTION
      'attach patch (c): update anchor drifted; refusing to patch blind'; END IF;

    EXECUTE src;
  END IF;

  ---------------------------------------------------------------------------
  -- 7c. fn_reassign_club_members: an authorized transfer says so on the row.
  --     Last written by 20261020210238.
  ---------------------------------------------------------------------------
  src := pg_get_functiondef('public.fn_reassign_club_members(uuid,uuid[],uuid,uuid,uuid)'::regprocedure);
  IF position('agent_assignment_source' in src) = 0 THEN
    orig := src;
    src := replace(src,
      'UPDATE public.club_members SET agent_id=p_agent_user_id,updated_at=now()',
      'UPDATE public.club_members SET agent_id=p_agent_user_id,' ||
      'agent_assignment_source=''manual_transfer'',updated_at=now()');
    IF src = orig THEN RAISE EXCEPTION
      'reassign patch: update anchor drifted; refusing to patch blind'; END IF;
    EXECUTE src;
  END IF;

END
$patch$;

-- ── 8. The one-off settlement ───────────────────────────────────────────────
-- KINGS CLUB ONLY (Dan, 2026-11-09). Deep Stack Society (478 evidenced players)
-- and Club Savage were both measured clean on 2026-11-08.
--
-- The seven were corrected by hand on 2026-11-08, so this is expected to move
-- NOTHING. It exists so the fix and its settlement install as one recorded
-- transaction, and so a mismatch appearing in between is caught rather than
-- missed. 10.9 sanctions a one-off migration; 10.12 forbids the standing repair
-- an earlier draft shipped, and that refusal is not negotiated here.
--
-- [REVIEW 4] It ABORTS if it would move more than the seven Dan authorized, so
-- "expected to move nothing" is checkable rather than asserted.
-- [REVIEW 8] The two advisory locks are the ones fn_reassign_club_members and
-- the deleted-account path take, so it serialises against those. The join and
-- the redemption take only fn_club_membership_lock, so they are NOT serialised
-- by these locks -- which is why every UPDATE below carries its own optimistic
-- guard on the upline it read, and records the value it actually replaced.
DO $settle$
DECLARE
  k            uuid := 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
  r            record;
  v_new_parent uuid;
  v_was        uuid;
  v_members    int := 0;
  v_parents    int := 0;
  v_n          int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('cashier-hierarchy:'||k::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('agent-agreement:'||k::text,0));

  FOR r IN SELECT d.user_id, d.current_upline, d.evidence_says
             FROM public.fn_referral_downline_disagreements(k) d
  LOOP
    UPDATE public.club_members
       SET agent_id = r.evidence_says,
           agent_assignment_source = 'referral',
           updated_at = now()
     WHERE club_id = k AND user_id = r.user_id
       -- Optimistic guard: if a live redemption moved them since the audit read
       -- them, leave it alone rather than overwrite somebody else's decision.
       AND agent_id IS NOT DISTINCT FROM r.current_upline
    RETURNING r.current_upline INTO v_was;

    CONTINUE WHEN NOT FOUND;
    v_members := v_members + 1;

    INSERT INTO public.kings_club_downline_repair_20261108
      (scope, club_id, subject_user_id, old_value, new_value, evidence, applied)
    VALUES ('club_members.agent_id', k, r.user_id, v_was, r.evidence_says,
            'one-off settlement 20261109052000', true);

    -- Both maintained representations move together. A super agent reports to
    -- nobody by convention, so its NULL parent is correct and is left alone.
    SELECT a.id INTO v_new_parent
      FROM public.agents a
     WHERE a.club_id = k AND a.user_id = r.evidence_says;

    IF v_new_parent IS NOT NULL THEN
      WITH moved AS (
        UPDATE public.agents ag
           SET parent_agent_id = v_new_parent, updated_at = now()
         WHERE ag.club_id = k
           AND ag.user_id = r.user_id
           AND COALESCE(ag.role, 'agent') <> 'super_agent'
           AND ag.parent_agent_id IS DISTINCT FROM v_new_parent
        RETURNING ag.id
      )
      INSERT INTO public.kings_club_downline_repair_20261108
        (scope, club_id, subject_user_id, agent_row_id, new_value, evidence, applied)
      SELECT 'agents.parent_agent_id', k, r.user_id, moved.id, r.evidence_says,
             'one-off settlement 20261109052000', true
        FROM moved;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_parents := v_parents + v_n;   -- [REVIEW 14] accumulate, never assign
    END IF;
  END LOOP;

  -- [REVIEW 4] Blast radius. Dan authorized seven proven mismatches, all seven
  -- already applied by hand, so anything above that is this migration finding
  -- something nobody reviewed. Refuse the whole transaction.
  IF v_members > 7 THEN
    RAISE EXCEPTION
      'referral settlement would move % memberships; only the 7 reviewed KINGS CLUB mismatches are authorized',
      v_members USING ERRCODE = '23514';
  END IF;

  -- [REVIEW 9] Re-derive total_players the way fn_reassign_club_members does,
  -- and only when something actually moved.
  --
  -- active_player_count is deliberately NOT touched. It has exactly one
  -- maintainer, the AFTER-ROW trigger fn_sync_agent_player_counts on
  -- club_members, which defines it as `is_active IS TRUE` - a different
  -- predicate on a different column from the `status IN ('active','approved')`
  -- an earlier version of this block used. That version rewrote the count for
  -- EVERY agent in the club under the wrong definition, and the trigger only
  -- re-corrects an agent whose downline later changes, so the rest would have
  -- carried a wrong number into the commission read models indefinitely. The
  -- trigger has already fired on the settlement's own UPDATE by the time this
  -- runs, which made the block redundant as well as wrong.
  IF v_members > 0 THEN
    UPDATE public.agents a
       SET total_players = (SELECT count(*) FROM public.club_members m
                             WHERE m.club_id = k AND m.agent_id = a.user_id),
           updated_at = now()
     WHERE a.club_id = k;
  END IF;

  RAISE NOTICE 'KINGS CLUB referral settlement: % membership(s), % agent parent(s)',
    v_members, v_parents;
END
$settle$;

-- ── 9. The regression suite ─────────────────────────────────────────────────
-- Assertions over the live records, not synthetic fixtures: CLAUDE.md rule 3
-- forbids DDL probes against production, and a fixture club would have to defeat
-- the membership, ledger and arena guards to exist.
--
-- [REVIEW 13] Two checks in the draft could not fail: one asserted a tautology
-- the resolver's own second line guarantees, and one was green by construction
-- because the settlement stamps every row it moves out of the audit's own
-- predicate. Both are replaced with checks that read the ledger's recorded
-- before-state, which no later write can make vacuous.
CREATE OR REPLACE FUNCTION public.fn_test_referral_downline_rules()
RETURNS TABLE(test text, passed boolean, detail text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  k uuid := 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
  n int; m int; s text;
BEGIN
  -- 1. Every corrected membership sits where the ledger says it should.
  SELECT count(*) INTO n
    FROM public.kings_club_downline_repair_20261108 d
    JOIN public.club_members cm ON cm.user_id = d.subject_user_id AND cm.club_id = k
   WHERE d.scope = 'club_members.agent_id' AND d.applied
     AND cm.agent_id IS DISTINCT FROM d.new_value;
  SELECT count(*) INTO m
    FROM public.kings_club_downline_repair_20261108 d
   WHERE d.scope = 'club_members.agent_id' AND d.applied;
  RETURN QUERY SELECT 'every corrected membership sits under its recorded referrer',
                      n = 0, n || ' of ' || m || ' corrected memberships disagree with the ledger';

  -- 2. And the resolver independently agrees with the ledger.
  SELECT count(*) INTO n
    FROM public.kings_club_downline_repair_20261108 d
   WHERE d.scope = 'club_members.agent_id' AND d.applied
     AND public.fn_resolve_referral_upline(k, d.subject_user_id) IS DISTINCT FROM d.new_value;
  RETURN QUERY SELECT 'the resolver independently names the same referrer',
                      n = 0, n || ' corrected players resolve somewhere else';

  -- 3. Each corrected agent record moved with its membership.
  SELECT count(*) INTO n
    FROM public.kings_club_downline_repair_20261108 d
    JOIN public.agents ag ON ag.user_id = d.subject_user_id AND ag.club_id = k
    JOIN public.club_members cm ON cm.user_id = ag.user_id AND cm.club_id = ag.club_id
   WHERE d.scope = 'club_members.agent_id' AND d.applied
     AND COALESCE(ag.role, 'agent') <> 'super_agent'
     AND ag.parent_agent_id IS DISTINCT FROM
         (SELECT p.id FROM public.agents p WHERE p.club_id = k AND p.user_id = cm.agent_id);
  RETURN QUERY SELECT 'every corrected agent branch hangs off the same upline as its membership',
                      n = 0, n || ' corrected agent records disagree with their membership';

  -- 4. Sub-agent depth: a referral by a sub-agent resolves to the SUB-AGENT and
  --    is not collapsed up to the super agent above them (Dagobaby's case).
  SELECT count(*) INTO n
    FROM public.kings_club_downline_repair_20261108 d
    JOIN public.agents a ON a.club_id = k AND a.user_id = d.new_value AND a.role = 'sub_agent'
   WHERE d.scope = 'club_members.agent_id' AND d.applied
     AND public.fn_resolve_referral_upline(k, d.subject_user_id) IS DISTINCT FROM d.new_value;
  RETURN QUERY SELECT 'a sub-agent referral is not collapsed to the agent above it',
                      n = 0, n || ' sub-agent corrections resolve elsewhere';

  -- 5. Not one player OUTSIDE the ledger moved. Measured against the
  --    install-time baseline rather than a point-in-time count, because every
  --    player who joins after this installs legitimately carries a source.
  --    A legacy row carries NULL and nothing may rewrite it, so this count can
  --    only fall if something moved one.
  SELECT count(*) INTO n
    FROM public.club_members cm
   WHERE cm.club_id = k AND cm.agent_assignment_source IS NULL;
  SELECT COALESCE(max(d.evidence::int), n) INTO m
    FROM public.kings_club_downline_repair_20261108 d
   WHERE d.scope = 'baseline.legacy_null_source';
  RETURN QUERY SELECT 'no player outside the ledger had their placement rewritten',
                      n >= m,
                      n || ' untouched rows remain of ' || m || ' recorded at install';

  -- 6. A player with no referral evidence has no referral answer, so nothing
  --    can move them. Counted over the club, which is the 699.
  SELECT count(*) INTO n FROM public.club_members cm
   WHERE cm.club_id = k AND public.fn_referral_referrer(k, cm.user_id) IS NULL;
  SELECT count(*) INTO m FROM public.club_members cm
   WHERE cm.club_id = k AND public.fn_referral_referrer(k, cm.user_id) IS NULL
     AND public.fn_resolve_referral_upline(k, cm.user_id) IS NOT NULL;
  RETURN QUERY SELECT 'no player without a link or referral ID has a referral answer',
                      m = 0, m || ' of ' || n || ' players with no evidence resolve to an upline';

  -- 7. A legacy row is never automatically movable ([REVIEW 3]).
  SELECT count(*) INTO n FROM public.club_members cm
   WHERE cm.club_id = k AND cm.agent_id IS NOT NULL
     AND cm.agent_assignment_source IS NULL
     AND public.fn_club_placement_is_unchosen(k, cm.user_id);
  RETURN QUERY SELECT 'a row written before this migration is never automatically movable',
                      n = 0, n || ' legacy rows read as overridable';

  -- 7b. And the placement test answers a real boolean, never NULL. A NULL here
  --     poisons `NOT fn_club_placement_is_unchosen(...)` in the attach guard and
  --     silently disables the refusal that protects another agent's downline.
  SELECT count(*) INTO n FROM public.club_members cm
   WHERE cm.club_id = k
     AND public.fn_club_placement_is_unchosen(k, cm.user_id) IS NULL;
  RETURN QUERY SELECT 'the placement test never answers NULL',
                      n = 0, n || ' members get a NULL placement answer';

  -- 8. The owner and club staff can never be given an upline ([REVIEW 4]).
  SELECT count(*) INTO n
    FROM public.fn_referral_downline_disagreements(k) d
    JOIN public.club_members cm ON cm.club_id = k AND cm.user_id = d.user_id
    JOIN public.clubs c ON c.id = k
   WHERE cm.user_id = c.owner_id OR COALESCE(cm.role,'player') IN ('owner','co_owner','admin');
  RETURN QUERY SELECT 'the club owner and staff are never listed as needing an upline',
                      n = 0, n || ' owner/staff rows appear in the audit';

  -- 9. The audit finds nothing left to correct.
  SELECT count(*) INTO n FROM public.fn_referral_downline_disagreements(k);
  RETURN QUERY SELECT 'the audit finds nothing left to correct',
                      n = 0, n || ' placements still disagree with their referral evidence';

  -- 10. No cycles, and every upline is a member of the same club.
  SELECT count(*) INTO n FROM public.club_members cm
   WHERE cm.club_id = k AND cm.agent_id IS NOT NULL
     AND public.fn_club_is_in_downline(k, cm.user_id, cm.agent_id);
  RETURN QUERY SELECT 'no member is their own ancestor', n = 0, n || ' cycles found';

  SELECT count(*) INTO n FROM public.club_members cm
   WHERE cm.club_id = k AND cm.agent_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.club_members u
                      WHERE u.club_id = cm.club_id AND u.user_id = cm.agent_id);
  RETURN QUERY SELECT 'every upline is a member of the same club', n = 0,
                      n || ' uplines sit outside the club';

  -- 11. The resolver never answers with the club owner ([REVIEW 2]): an owner
  --     placement is the fallback and must stay overridable for ever.
  SELECT count(*) INTO n FROM public.club_members cm, public.clubs c
   WHERE c.id = k AND cm.club_id = k
     AND public.fn_resolve_referral_upline(k, cm.user_id) = c.owner_id;
  RETURN QUERY SELECT 'the resolver never names the club owner as a referral answer',
                      n = 0, n || ' players resolve to the owner';

  -- 12. The defect cannot come back: no assignment path may read an owner
  --     placement as a real downline because invited_by got filled in, and the
  --     join must ask the resolver first.
  -- The defect was never the PRESENCE of the invited_by test - it is kept
  -- deliberately, as the route a row written before this migration still has.
  -- The defect was that it was the ONLY route and the same statement falsified
  -- it. So what must be true is that the durable test is there beside it.
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'fn_redeem_club_invite_code'
     AND p.prosrc ~ 'WHEN v_unchosen';
  RETURN QUERY SELECT 'the redemption no longer depends on the one-shot test alone',
                      n = 1, 'redemption paths carrying the durable test: ' || n;

  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'fn_join_club_membership_impl'
     AND p.prosrc ~ 'fn_resolve_referral_upline';
  RETURN QUERY SELECT 'the join asks the resolver before the owner fallback',
                      n = 1, 'join paths consulting the resolver: ' || n;

  -- 13. The redemption decides before it writes, not from its own write.
  s := pg_get_functiondef('public.fn_redeem_club_invite_code(uuid,uuid,text)'::regprocedure);
  RETURN QUERY SELECT 'the redemption decides before it writes',
                      position('v_unchosen := public.fn_club_placement_is_unchosen' in s) > 0
                        AND position('WHEN v_unchosen' in s) > 0,
                      'placement read into a variable ahead of the update';

  -- 14. An authorized transfer still serialises on the club agreement lock.
  s := pg_get_functiondef('public.fn_reassign_club_members(uuid,uuid[],uuid,uuid,uuid)'::regprocedure);
  RETURN QUERY SELECT 'an authorized transfer still serialises on the club agreement lock',
                      position('agent-agreement:' in s) > 0,
                      'advisory lock present in the transfer path';

END
$function$;

-- Postgres grants EXECUTE to PUBLIC on every new function, and silence is "open
-- to everyone", not "closed" (scripts/ci/check-definer-authorization.mjs, after
-- fn_bbj_unclaimed_shares handed every unpaid bad-beat share to any logged-in
-- account on 2026-09-06). These are internal helpers and operator reads; the
-- assignment paths that call them are SECURITY DEFINER and run as the owner.
REVOKE ALL ON FUNCTION public.fn_referral_referrer(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_resolve_referral_upline(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_club_placement_is_unchosen(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_referral_downline_disagreements(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_test_referral_downline_rules() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_referral_referrer(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_resolve_referral_upline(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_club_placement_is_unchosen(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_referral_downline_disagreements(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_test_referral_downline_rules() TO service_role;

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

-- An install-time baseline for the untouched population. ORDER MATTERS: this
-- counts AFTER the seven corrected members are stamped 'referral' just above.
-- Counted before them it would include seven rows that the very next statement
-- removes from the population, so check 5's `n >= m` would be false on the
-- first install and for ever after - a permanently red assertion, the alarm
-- nobody listens to (CLAUDE.md 10.84). Found by independent review on
-- 2026-11-09 and reproduced against a production-shaped fixture.
--
-- A point-in-time query
-- cannot express "nothing outside the ledger moved": every player who joins
-- after this installs legitimately carries a source, so counting non-NULL
-- sources would go false within hours and cry wolf for ever. What IS durable is
-- that a row written BEFORE this migration carries NULL and nothing may rewrite
-- it, so the count of NULL-source members must never fall.
INSERT INTO public.kings_club_downline_repair_20261108
  (scope, club_id, subject_user_id, evidence, applied)
SELECT 'baseline.legacy_null_source',
       'a41434bb-8d0c-400a-8f0d-e8b3d65afed4',
       '00000000-0000-0000-0000-000000000000'::uuid,
       count(*)::text,
       true
  FROM public.club_members m
 WHERE m.club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'
   AND m.agent_assignment_source IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.kings_club_downline_repair_20261108 b
                    WHERE b.scope = 'baseline.legacy_null_source');

COMMIT;
