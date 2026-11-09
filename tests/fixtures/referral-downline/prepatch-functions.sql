-- The five functions the migration patches, as they stand live, reproduced with
-- the anchor text byte-identical so pg_get_functiondef hands the patch exactly
-- what production would. Bodies outside the anchors are reduced to what the
-- anchors need to compile; the point is to prove each anchored patch APPLIES
-- and that the join's resulting behaviour is right.
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

  -- chip_balance = 0 written EXPLICITLY: the default was 1000 until 2026-08-26.
  -- Dan, 2026-10-25: a member with no agent sits under the club owner.
  INSERT INTO club_members (club_id, user_id, role, status, tier, rank_level, orange_ball_status, chip_balance, agent_id)
  VALUES (p_club_id, v_uid, v_role, v_status, 'bronze', 0, 'cold', 0,
          CASE WHEN v_uid = v_owner THEN NULL ELSE v_owner END)
  ON CONFLICT (club_id, user_id) DO NOTHING
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    SELECT * INTO v_row FROM club_members
      WHERE club_id = p_club_id AND user_id = v_uid;
  END IF;

  RETURN to_jsonb(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_redeem_club_invite_code(p_club_id uuid, p_user_id uuid, p_referral_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_member            record;
  v_inviter           record;
  v_effective_agent   uuid;
  v_new_status        text;
  v_prev_status       text;
  v_prev_agent        uuid;
  v_prev_invited      uuid;
  v_changed           boolean;
BEGIN
  SELECT * INTO v_member FROM club_members
   WHERE club_id = p_club_id AND user_id = p_user_id;
  SELECT p.id, p.username INTO v_inviter FROM profiles p
   WHERE p.player_number = btrim(p_referral_code) LIMIT 1;
  IF v_inviter.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'unknown_inviter');
  END IF;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM agents a WHERE a.club_id = p_club_id
                            AND a.user_id = v_inviter.id AND a.status = 'active')
              THEN v_inviter.id
              ELSE (SELECT im.agent_id FROM club_members im
                     WHERE im.club_id = p_club_id AND im.user_id = v_inviter.id
                       AND im.status IN ('active','approved','automatic')) END
    INTO v_effective_agent;
  v_new_status := v_member.status;

  v_prev_status := v_member.status;
  v_prev_agent  := v_member.agent_id;
  v_prev_invited := v_member.invited_by;

  UPDATE club_members
     SET agent_id   = CASE
                        -- An owner placement nobody chose (made at join, Dan
                        -- 2026-10-25) yields to the first invite, as no upline did.
                        WHEN agent_id IS NULL
                          OR (agent_id = (SELECT c.owner_id FROM clubs c WHERE c.id = p_club_id)
                              AND invited_by IS NULL)
                        THEN coalesce(v_effective_agent,
                                      (SELECT c.owner_id FROM clubs c
                                        WHERE c.id = p_club_id AND c.owner_id <> p_user_id))
                        ELSE agent_id
                      END,
         invited_by = coalesce(invited_by, v_inviter.id),
         status     = v_new_status,
         updated_at = now()
   WHERE club_id = p_club_id AND user_id = p_user_id
  RETURNING * INTO v_member;

  v_changed := v_prev_agent IS DISTINCT FROM v_member.agent_id;
  RETURN jsonb_build_object('success', true, 'agent_id', v_member.agent_id,
                            'changed', v_changed);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_agent_attach_player(p_club_id uuid, p_agent_user_id uuid, p_player_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller     uuid := auth.uid();
  v_is_staff   boolean := false;
  v_member     record;
BEGIN
  SELECT EXISTS (SELECT 1 FROM clubs c WHERE c.id = p_club_id AND c.owner_id = v_caller)
    INTO v_is_staff;
  SELECT * INTO v_member FROM club_members
   WHERE club_id = p_club_id AND user_id = p_player_id;

  IF NOT FOUND THEN
    INSERT INTO club_members (club_id, user_id, role, status, tier, rank_level,
                              orange_ball_status, agent_id, invited_by)
    VALUES (p_club_id, p_player_id, 'player', 'active', 'bronze', 0, 'cold',
            p_agent_user_id, p_agent_user_id)
    RETURNING * INTO v_member;
  ELSE
    IF v_member.agent_id IS NOT NULL
       AND v_member.agent_id <> p_agent_user_id
       -- An owner placement nobody chose (made at join) is not a downline.
       AND NOT (v_member.agent_id = (SELECT c.owner_id FROM clubs c WHERE c.id = p_club_id)
                AND v_member.invited_by IS NULL)
       AND NOT v_is_staff THEN
      RETURN jsonb_build_object('success', false, 'code', 'already_in_a_downline');
    END IF;

    UPDATE club_members
       SET agent_id   = p_agent_user_id,
           invited_by = COALESCE(invited_by, p_agent_user_id),
           updated_at = now()
     WHERE club_id = p_club_id AND user_id = p_player_id
    RETURNING * INTO v_member;
  END IF;

  RETURN jsonb_build_object('success', true, 'agent_id', v_member.agent_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_reassign_club_members(p_club_id uuid, p_member_user_ids uuid[], p_agent_user_id uuid, p_op_id uuid, p_expected_agent_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_ids uuid[]; v_parent uuid;
BEGIN
 v_ids:=ARRAY(SELECT DISTINCT x FROM unnest(p_member_user_ids) x WHERE x IS NOT NULL ORDER BY x);
 PERFORM pg_advisory_xact_lock(hashtextextended('agent-agreement:'||p_club_id::text,0));
 SELECT a.id INTO v_parent FROM public.agents a
  WHERE a.club_id=p_club_id AND a.user_id=p_agent_user_id AND a.status='active';
 UPDATE public.club_members SET agent_id=p_agent_user_id,updated_at=now()
 WHERE club_id=p_club_id AND user_id=ANY(v_ids);
 UPDATE public.agents SET parent_agent_id=v_parent,updated_at=now()
 WHERE club_id=p_club_id AND user_id=ANY(v_ids);
 INSERT INTO public.club_assignment_operations(id,club_id,actor_id,destination_user_id,source_user_id,member_user_ids)
 VALUES(p_op_id,p_club_id,auth.uid(),p_agent_user_id,p_expected_agent_user_id,v_ids);
 RETURN jsonb_build_object('success',true,'moved',cardinality(v_ids));
END $function$;

CREATE OR REPLACE FUNCTION public.fn_ca_deleted_account_leaves_every_club(p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record; v_target uuid; v_moved int := 0;
BEGIN
  FOR r IN
    SELECT m.club_id, m.user_id, (m.agent_id = p_user) AS via_agent,
           (m.parent_agent_id = p_user) AS via_parent
      FROM public.club_members m
     WHERE (m.agent_id = p_user OR m.parent_agent_id = p_user)
  LOOP
    SELECT am.agent_id INTO v_target FROM public.club_members am
     WHERE am.club_id = r.club_id AND am.user_id = p_user;
    UPDATE public.club_members m
       SET agent_id = CASE WHEN r.via_agent THEN coalesce(v_target,
             (SELECT c2.owner_id FROM public.clubs c2
               WHERE c2.id = r.club_id AND c2.asset = 'chips' AND c2.owner_id <> r.user_id))
             ELSE m.agent_id END,
           parent_agent_id = CASE WHEN r.via_parent THEN v_target ELSE m.parent_agent_id END,
           updated_at = now()
     WHERE m.club_id = r.club_id AND m.user_id = r.user_id;
    v_moved := v_moved + 1;
  END LOOP;
  UPDATE public.agents SET status='suspended' WHERE user_id = p_user;
  UPDATE public.club_members SET status='suspended',
         membership_lifecycle_status='departed' WHERE user_id = p_user;
  RETURN jsonb_build_object('rehomed', v_moved);
END $function$;
