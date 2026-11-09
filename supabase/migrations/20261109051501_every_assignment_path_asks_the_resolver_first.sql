-- ═══════════════════════════════════════════════════════════════════════════════
-- EVERY ASSIGNMENT PATH ASKS THE RESOLVER BEFORE IT FALLS BACK TO THE OWNER
--
-- The previous migration added fn_resolve_referral_upline and
-- fn_club_placement_is_unchosen. This one wires them into every path that can
-- write club_members.agent_id, and makes each path record HOW it chose.
--
-- The patched paths, and what changes in each:
--
--   fn_join_club_membership_impl     owner-first  ->  resolver, then owner
--   fn_redeem_club_invite_code       one-shot     ->  re-askable; owner only
--                                                     when nothing resolves
--   fn_agent_attach_player           invited_by   ->  the placement test
--                                    guess
--   fn_reassign_club_members         (unchanged)  ->  records 'manual_transfer'
--   fn_ca_deleted_account_leaves_    owner        ->  resolver, then owner
--     every_club                     fallback
--
-- WHY BY SURGICAL REPLACEMENT, NOT BY RETYPING. fn_redeem_club_invite_code is
-- 11.5 KB and fn_ca_deleted_account_leaves_every_club is 9.7 KB of money-adjacent
-- logic. CLAUDE.md records what retyping a large migration by hand cost on
-- 2026-09-23 (five days, 65 stalled tables). Each patch below therefore reads the
-- live definition, replaces an exact anchor, and ASSERTS the replacement changed
-- something -- a drifted anchor aborts the migration instead of silently leaving
-- the old behaviour in place. Each patch is a no-op if already applied.
--
-- No player's placement changes here. These are the rules for the NEXT write.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '1s';

-- ── 1. The join no longer parks everyone under the owner ────────────────────
-- Small enough to state in full. The owner fallback is kept exactly as Dan ruled
-- on 2026-10-25 -- it is simply no longer applied BEFORE the referral is read.
CREATE OR REPLACE FUNCTION public.fn_join_club_membership_impl(p_club_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_requires_approval boolean;
  v_active_count int;
  v_role text;
  v_status text;
  v_resolved uuid;
  v_agent uuid;
  v_source text;
  v_row club_members%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT owner_id, COALESCE(requires_approval, false)
    INTO v_owner, v_requires_approval
    FROM clubs
    WHERE id = p_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Club not found';
  END IF;

  SELECT * INTO v_row FROM club_members
    WHERE club_id = p_club_id AND user_id = v_uid;
  IF FOUND THEN
    RETURN to_jsonb(v_row);
  END IF;

  IF v_uid = v_owner THEN
    v_role := 'owner';
    v_status := 'active';
  ELSE
    PERFORM public.fn_club_membership_lock(v_uid);
    v_active_count := public.fn_club_membership_count(v_uid);
    IF v_active_count >= public.fn_club_membership_cap() THEN
      RAISE EXCEPTION 'You can only be a member of up to % clubs. Leave a club to join a new one.',
        public.fn_club_membership_cap();
    END IF;

    v_role := 'player';
    v_status := CASE WHEN v_requires_approval THEN 'pending' ELSE 'active' END;
  END IF;

  -- Dan, 2026-10-25: a member with no agent sits under the club owner.
  -- Dan, 2026-11-08: a member who arrived through a referral link or referral ID
  -- belongs to THAT referrer. The attribution row is written when the link is
  -- clicked, so by the time we get here the evidence usually already exists --
  -- which is why the resolver is asked FIRST and the owner is the fallback.
  IF v_uid = v_owner THEN
    v_agent := NULL;
    v_source := NULL;
  ELSE
    v_resolved := public.fn_resolve_referral_upline(p_club_id, v_uid);
    v_agent    := COALESCE(v_resolved, v_owner);
    v_source   := CASE WHEN v_resolved IS NOT NULL THEN 'referral' ELSE 'join_fallback' END;
  END IF;

  -- chip_balance = 0 written EXPLICITLY: the default was 1000 until 2026-08-26.
  INSERT INTO club_members (club_id, user_id, role, status, tier, rank_level,
                            orange_ball_status, chip_balance, agent_id,
                            agent_assignment_source)
  VALUES (p_club_id, v_uid, v_role, v_status, 'bronze', 0, 'cold', 0,
          v_agent, v_source)
  ON CONFLICT (club_id, user_id) DO NOTHING
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    SELECT * INTO v_row FROM club_members
      WHERE club_id = p_club_id AND user_id = v_uid;
  END IF;

  RETURN to_jsonb(v_row);
END;
$function$;

-- ── 2-4. Surgical patches to the large paths ────────────────────────────────
DO $patch$
DECLARE
  src  text;
  orig text;
BEGIN
  ---------------------------------------------------------------------------
  -- 2. fn_redeem_club_invite_code: the one-shot becomes re-askable.
  ---------------------------------------------------------------------------
  src := pg_get_functiondef('public.fn_redeem_club_invite_code(uuid,uuid,text)'::regprocedure);
  IF position('fn_club_placement_is_unchosen' in src) = 0 THEN
    orig := src;

    -- (a) a flag for "this placement may be overridden", read BEFORE the UPDATE
    src := replace(src,
      '  v_changed           boolean;',
      '  v_changed           boolean;' || chr(10) ||
      '  v_unchosen          boolean;');
    IF src = orig THEN RAISE EXCEPTION
      'redeem patch (a): declaration anchor drifted; refusing to patch blind'; END IF;

    orig := src;
    src := replace(src,
      '  v_prev_status := v_member.status;',
      '  -- Read the placement BEFORE the update: whether it may be overridden' || chr(10) ||
      '  -- must not depend on what this very statement writes (the 2026-10/11 bug).' || chr(10) ||
      '  v_unchosen := public.fn_club_placement_is_unchosen(p_club_id, p_user_id);' || chr(10) ||
      '  v_prev_status := v_member.status;');
    IF src = orig THEN RAISE EXCEPTION
      'redeem patch (b): pre-update anchor drifted; refusing to patch blind'; END IF;

    -- (c) the predicate itself. The old test was
    --       agent_id = <owner> AND invited_by IS NULL
    --     which this same UPDATE then falsified forever.
    orig := src;
    src := replace(src,
      '                        WHEN agent_id IS NULL' || chr(10) ||
      '                          OR (agent_id = (SELECT c.owner_id FROM clubs c WHERE c.id = p_club_id)' || chr(10) ||
      '                              AND invited_by IS NULL)' || chr(10) ||
      '                        THEN coalesce(v_effective_agent,' || chr(10) ||
      '                                      (SELECT c.owner_id FROM clubs c' || chr(10) ||
      '                                        WHERE c.id = p_club_id AND c.owner_id <> p_user_id))',
      '                        WHEN v_unchosen' || chr(10) ||
      '                        THEN coalesce(v_effective_agent,' || chr(10) ||
      '                                      public.fn_resolve_referral_upline(p_club_id, p_user_id),' || chr(10) ||
      '                                      (SELECT c.owner_id FROM clubs c' || chr(10) ||
      '                                        WHERE c.id = p_club_id AND c.owner_id <> p_user_id))');
    IF src = orig THEN RAISE EXCEPTION
      'redeem patch (c): owner-placement predicate drifted; refusing to patch blind'; END IF;

    -- (d) record how the placement was chosen
    orig := src;
    src := replace(src,
      '         invited_by = coalesce(invited_by, v_inviter.id),',
      '         invited_by = coalesce(invited_by, v_inviter.id),' || chr(10) ||
      '         agent_assignment_source = CASE' || chr(10) ||
      '             WHEN NOT v_unchosen THEN agent_assignment_source' || chr(10) ||
      '             WHEN coalesce(v_effective_agent,' || chr(10) ||
      '                           public.fn_resolve_referral_upline(p_club_id, p_user_id))' || chr(10) ||
      '                  IS NOT NULL THEN ''referral''' || chr(10) ||
      '             ELSE ''join_fallback'' END,');
    IF src = orig THEN RAISE EXCEPTION
      'redeem patch (d): invited_by anchor drifted; refusing to patch blind'; END IF;

    EXECUTE src;
  END IF;

  ---------------------------------------------------------------------------
  -- 3. fn_agent_attach_player: the same broken guess, same fix.
  ---------------------------------------------------------------------------
  src := pg_get_functiondef('public.fn_agent_attach_player(uuid,uuid,uuid)'::regprocedure);
  IF position('fn_club_placement_is_unchosen' in src) = 0 THEN
    orig := src;
    src := replace(src,
      '       AND NOT (v_member.agent_id = (SELECT c.owner_id FROM clubs c WHERE c.id = p_club_id)' || chr(10) ||
      '                AND v_member.invited_by IS NULL)',
      '       AND NOT public.fn_club_placement_is_unchosen(p_club_id, p_player_id)');
    IF src = orig THEN RAISE EXCEPTION
      'attach patch (a): owner-placement predicate drifted; refusing to patch blind'; END IF;

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
  -- 4. fn_reassign_club_members: an authorized transfer says so on the row.
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

  ---------------------------------------------------------------------------
  -- 5. fn_ca_deleted_account_leaves_every_club: when an upline is removed, the
  --    player's own referral is consulted before the club owner catches them.
  ---------------------------------------------------------------------------
  src := pg_get_functiondef('public.fn_ca_deleted_account_leaves_every_club(uuid)'::regprocedure);
  IF position('fn_resolve_referral_upline' in src) = 0 THEN
    orig := src;
    src := replace(src,
      'coalesce(v_target,',
      'coalesce(v_target, public.fn_resolve_referral_upline(r.club_id, r.user_id),');
    IF src = orig THEN RAISE EXCEPTION
      'deleted-account patch: owner fallback anchor drifted; refusing to patch blind'; END IF;
    EXECUTE src;
  END IF;
END
$patch$;

COMMIT;
