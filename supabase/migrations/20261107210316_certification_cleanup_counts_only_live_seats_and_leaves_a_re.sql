-- 20261107210316_certification_cleanup_counts_only_live_seats_and_leaves_a_re.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (issue #9830, Cert Residue Sweep, 2026-11-07):
--
-- THE CERTIFICATION ACCOUNT DOOR COUNTS ONLY LIVE CUSTODY, AND LEAVES A
-- RETIRED CLUB THE WAY A PLAYER LEAVES IT.
--
-- scripts/ci/certify-rabbit-hunt.mjs mints three reserved identities per run
-- (owner, vip, plain), seats the two players at a real cash table in a
-- 'Cert RH' club, cashes them out through the engine, claims their chips back
-- to the club bank and retires the club through fn_retire_settled_club. Read
-- from production on 2026-11-07, every one of those players (identities
-- 1059cbec, ac293d50, 39beae07, 0412d136) is left exactly like this: one
-- table_seats row with left_at set, stack 3.95-4.05 recorded as the amount
-- the engine cashed out (chip_ledger table_cashout from table_stack to
-- player_wallet, same amount, same instant), its table status 'closed' and
-- lifecycle 'closed'; one club_members row, role 'player', every balance
-- 0.00, agent_id the club owner, in a club whose lifecycle_status is
-- 'retired'; zero wallet balance; no registration; one chip_ledger row as
-- performed_by. Nothing about them is live, and nothing about them can
-- ever move again.
--
-- cleanup_reserved_certification_account's immutable-ledger-actor branch and
-- fn_ca_certification_identity_retired both refused them anyway, with
-- CERTIFICATION_RETIREMENT_HAS_AUTHORITY_OR_CUSTODY, for two reasons that
-- were written when no certificate ever sat down:
--
--   1. ANY table_seats row counted as custody (EXISTS ... table_seats WHERE
--      user_id = p_user_id). A seat the player has LEFT, at a table that is
--      CLOSED, whose stack reached the wallet through the engine's own
--      cash-out ledger row, is history. A seat that is still occupied
--      (left_at IS NULL), a seat at a table that is not terminal, a seat
--      whose table row is gone, or a vacated non-zero stack with no matching
--      posted table_cashout ledger row (same player, same table, same amount,
--      within a minute of left_at) is still custody and is still refused.
--      Both branches of the door and the retirement predicate now use that
--      one definition.
--
--   2. ANY membership outside KINGS CLUB / Midway counted as authority. A
--      zero-balance 'player' row in a club that is already RETIRED is
--      neither authority nor custody: the club is read-only, the player
--      holds nothing and can do nothing. The ledger-actor branch now admits
--      exactly that row (role 'player', chip/promo/held/locked all 0, no
--      agent other than the club owner, no parent agent, club
--      lifecycle_status 'retired') beside the two prepared staff scopes it
--      already admitted, and removes it in the same DELETE that already
--      removes those, under the retired-club guard's own maintenance setting
--      for that one statement only (fn_guard_retired_club_mutation honours
--      app.club_retirement_maintenance for a service-role session; the
--      setting is restored before any other statement runs). The retired
--      club's owner row, tables, seats, receipts and ledger stay exactly as
--      retired: nothing else in a retired club is touched.
--
-- Every other guard is byte-identical and this file asserts it still reads
-- the same: the certification email namespace, the profile identity, club and
-- union ownership, agents, tournament registrations, wallet balances, the
-- protected-club branch's own refusal, the non-club-creation ledger evidence
-- refusal, the archive and detachment order, and the Auth soft-delete
-- handshake (auth_soft_delete_required -> retained_ledger_actor). The
-- function keeps its owner, ACL (service_role only) and configuration.
--
-- Production read 2026-11-07 (md5 of pg_get_functiondef):
--   cleanup_reserved_certification_account(uuid)  32fccc83b62d77ae9f23c530af591c1c
--     (postimage of 20261102201808, the last patch to this door)
--   fn_ca_certification_identity_retired(uuid)    fbaa2d123a08aca20a597b6273be73e4
--     (unchanged since 20260927032118 created it)
--
-- This installs source only. The settlement of the eleven identities behind
-- #9830 happens through the fixed Cert Residue Sweep after merge, through
-- this door, one identity at a time, each read back; this file deletes no
-- production row.
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).
-- @live-proof: (position('x.category = ''table_cashout''' IN pg_get_functiondef('public.cleanup_reserved_certification_account(uuid)'::regprocedure)) > 0 AND position('rc.lifecycle_status = ''retired''' IN pg_get_functiondef('public.cleanup_reserved_certification_account(uuid)'::regprocedure)) > 0 AND position('x.category = ''table_cashout''' IN pg_get_functiondef('public.fn_ca_certification_identity_retired(uuid)'::regprocedure)) > 0 AND position('SELECT 1 FROM public.table_seats WHERE user_id = p_user_id)' IN pg_get_functiondef('public.cleanup_reserved_certification_account(uuid)'::regprocedure)) = 0)
BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '30s';

DO $patch$
DECLARE
  v_door regprocedure := 'public.cleanup_reserved_certification_account(uuid)'::regprocedure;
  v_predicate regprocedure := 'public.fn_ca_certification_identity_retired(uuid)'::regprocedure;
  v_door_pre CONSTANT text := '32fccc83b62d77ae9f23c530af591c1c';
  v_predicate_pre CONSTANT text := 'fbaa2d123a08aca20a597b6273be73e4';
  d text := pg_get_functiondef(v_door);
  q text := pg_get_functiondef(v_predicate);
  v_door_meta jsonb;
  v_predicate_meta jsonb;
  -- 1. A seat is custody only while it is live. Both door branches carry the
  --    same seven-word fragment; both become the same live-custody test.
  seat_old CONSTANT text := $o$OR EXISTS (SELECT 1 FROM public.table_seats WHERE user_id = p_user_id)$o$;
  seat_new CONSTANT text := $n$OR EXISTS (SELECT 1 FROM public.table_seats s LEFT JOIN public.tables t ON t.id = s.table_id
                    WHERE s.user_id = p_user_id
                      AND (s.left_at IS NULL OR t.id IS NULL
                        OR lower(COALESCE(t.status::text, '')) NOT IN ('closed', 'completed', 'cancelled', 'finished')
                        OR (COALESCE(s.stack, 0) <> 0 AND NOT EXISTS (
                          SELECT 1 FROM public.chip_ledger x
                           WHERE x.to_entity_id = s.user_id AND x.table_id = s.table_id
                             AND x.category = 'table_cashout' AND x.status = 'posted'
                             AND x.amount = s.stack
                             AND x.created_at BETWEEN s.left_at - interval '1 minute'
                                                  AND s.left_at + interval '1 minute'))))$n$;
  pred_old CONSTANT text := $o$     AND NOT EXISTS (SELECT 1 FROM public.table_seats s WHERE s.user_id = u.id)$o$;
  pred_new CONSTANT text := $n$     AND NOT EXISTS (SELECT 1 FROM public.table_seats s LEFT JOIN public.tables t ON t.id = s.table_id
                      WHERE s.user_id = u.id
                        AND (s.left_at IS NULL OR t.id IS NULL
                          OR lower(COALESCE(t.status::text, '')) NOT IN ('closed', 'completed', 'cancelled', 'finished')
                          OR (COALESCE(s.stack, 0) <> 0 AND NOT EXISTS (
                            SELECT 1 FROM public.chip_ledger x
                             WHERE x.to_entity_id = s.user_id AND x.table_id = s.table_id
                               AND x.category = 'table_cashout' AND x.status = 'posted'
                               AND x.amount = s.stack
                               AND x.created_at BETWEEN s.left_at - interval '1 minute'
                                                    AND s.left_at + interval '1 minute'))))$n$;
  -- 2. The ledger-actor branch admits a zero-balance player row in a RETIRED
  --    club beside the two prepared staff scopes, and removes it in the same
  --    DELETE.
  admit_old CONSTANT text := $o$((club_id IS NULL OR club_id NOT IN ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid, 'fade0000-0000-0000-0000-000000000001'::uuid))$o$;
  admit_new CONSTANT text := $n$(NOT ((club_id IN ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid, 'fade0000-0000-0000-0000-000000000001'::uuid) AND role IN ('admin','player'))
                           OR (role = 'player' AND EXISTS (SELECT 1 FROM public.clubs rc WHERE rc.id = club_members.club_id AND rc.lifecycle_status = 'retired'))) IS TRUE$n$;
  role_old CONSTANT text := $o$OR NOT (role IN ('admin','player')) IS TRUE OR COALESCE(chip_balance, 0) <> 0$o$;
  role_new CONSTANT text := $n$OR COALESCE(chip_balance, 0) <> 0$n$;
  delete_old CONSTANT text := $o$    DELETE FROM public.club_members WHERE user_id = p_user_id
      AND club_id IN ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid, 'fade0000-0000-0000-0000-000000000001'::uuid)
      AND role IN ('admin','player') AND COALESCE(chip_balance, 0) = 0 AND COALESCE(promo_balance, 0) = 0;$o$;
  delete_new CONSTANT text := $n$    DECLARE
      v_previous_retirement_maintenance text := current_setting('app.club_retirement_maintenance', true);
    BEGIN
      -- The zero-balance player row of a RETIRED club is the only retained-
      -- club row this door removes. The retired-club guard is opened for this
      -- one statement, for this service-role session, and closed again before
      -- anything else runs.
      PERFORM set_config('app.club_retirement_maintenance', 'on', true);
      DELETE FROM public.club_members WHERE user_id = p_user_id
        AND ((club_id IN ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid, 'fade0000-0000-0000-0000-000000000001'::uuid) AND role IN ('admin','player'))
          OR (role = 'player' AND EXISTS (SELECT 1 FROM public.clubs rc WHERE rc.id = club_members.club_id AND rc.lifecycle_status = 'retired')))
        AND COALESCE(chip_balance, 0) = 0 AND COALESCE(promo_balance, 0) = 0
        AND COALESCE(held_chips, 0) = 0 AND COALESCE(locked_chips, 0) = 0;
      PERFORM set_config('app.club_retirement_maintenance', COALESCE(v_previous_retirement_maintenance, ''), true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM set_config('app.club_retirement_maintenance', COALESCE(v_previous_retirement_maintenance, ''), true);
      RAISE;
    END;$n$;
  guards CONSTANT text[] := ARRAY[
    'CERTIFICATION_PROTECTED_MEMBERSHIP_IDENTITY_REFUSED',
    'CERTIFICATION_PROTECTED_MEMBERSHIP_PROFILE_REFUSED',
    'CERTIFICATION_PROTECTED_MEMBERSHIP_HAS_AUTHORITY_OR_CUSTODY',
    'CERTIFICATION_PROTECTED_MEMBERSHIP_CARDINALITY_CHANGED',
    'CERTIFICATION_RETIREMENT_IDENTITY_REFUSED',
    'CERTIFICATION_RETIREMENT_PROFILE_REFUSED',
    'CERTIFICATION_RETIREMENT_HAS_AUTHORITY_OR_CUSTODY',
    'Reserved Certification Identity % Has Non-Club-Creation Ledger Evidence',
    'Reserved Certification Ledger Actor Archive Copied % Of % Rows For %',
    'Reserved Certification Ledger Actor % Was Not Detached',
    'Refusing To Remove Non-Certification Identity %',
    'Reserved Certification Identity % Was Not Fully Removed',
    $g$'auth_soft_delete_required'$g$,
    $g$'retained_ledger_actor'$g$,
    $g$public.fn_ca_certification_identity_retired(p_user_id)$g$,
    $g$EXISTS (SELECT 1 FROM public.clubs WHERE owner_id = p_user_id)$g$,
    $g$EXISTS (SELECT 1 FROM public.unions WHERE owner_id = p_user_id)$g$,
    $g$EXISTS (SELECT 1 FROM public.agents WHERE user_id = p_user_id)$g$,
    $g$EXISTS (SELECT 1 FROM public.tournament_players WHERE user_id = p_user_id)$g$,
    $g$(agent_id IS NOT NULL AND agent_id IS DISTINCT FROM$g$,
    $g$OR parent_agent_id IS NOT NULL$g$,
    $g$v_email LIKE 'ca-customization-cert-postdeploy-%@example.invalid'$g$,
    $g$v_email LIKE 'club-create-cert-%@smarter-poker.invalid'$g$,
    $g$PERFORM public.fn_club_membership_lock(p_user_id);$g$,
    $g$UPDATE public.chip_ledger$g$,
    $g$INSERT INTO public.ca_test_account_ledger_actor_archive$g$
  ];
  g text;
  r text[][];
  i int;
  n int;
BEGIN
  SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'secdef',prosecdef)
    INTO STRICT v_door_meta FROM pg_proc WHERE oid=v_door;
  SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'secdef',prosecdef)
    INTO STRICT v_predicate_meta FROM pg_proc WHERE oid=v_predicate;
  IF NOT (v_door_meta->>'secdef')::boolean OR NOT (v_predicate_meta->>'secdef')::boolean
     OR has_function_privilege('anon',v_door,'EXECUTE') OR has_function_privilege('authenticated',v_door,'EXECUTE')
     OR has_function_privilege('anon',v_predicate,'EXECUTE') OR has_function_privilege('authenticated',v_predicate,'EXECUTE')
     OR NOT has_function_privilege('service_role',v_door,'EXECUTE')
     OR NOT has_function_privilege('service_role',v_predicate,'EXECUTE') THEN
    RAISE EXCEPTION 'CERTIFICATION_CLEANUP_AUTHORITY_CHANGED' USING ERRCODE='55000';
  END IF;

  -- Replay: both bodies already carry the live-custody test and the retired
  -- club admission; nothing to do.
  IF position(seat_new IN d)>0 AND position(delete_new IN d)>0 AND position(pred_new IN q)>0 THEN
    RETURN;
  END IF;
  IF md5(d) IS DISTINCT FROM v_door_pre THEN
    RAISE EXCEPTION 'CERTIFICATION_CLEANUP_PREIMAGE_CHANGED' USING ERRCODE='55000';
  END IF;
  IF md5(q) IS DISTINCT FROM v_predicate_pre THEN
    RAISE EXCEPTION 'CERTIFICATION_RETIREMENT_PREDICATE_PREIMAGE_CHANGED' USING ERRCODE='55000';
  END IF;

  -- The seat fragment is in both guarded branches of the door: exactly two.
  n := (length(d)-length(replace(d,seat_old,'')))/length(seat_old);
  IF n<>2 THEN
    RAISE EXCEPTION 'CERTIFICATION_CLEANUP_SEAT_ANCHOR_COUNT %', n USING ERRCODE='55000';
  END IF;
  d := replace(d,seat_old,seat_new);
  -- The membership admission and the DELETE live once each, in the
  -- ledger-actor branch.
  r := ARRAY[ARRAY[admit_old,admit_new],ARRAY[role_old,role_new],ARRAY[delete_old,delete_new]];
  FOR i IN 1..3 LOOP
    IF (length(d)-length(replace(d,r[i][1],'')))<>length(r[i][1]) THEN
      RAISE EXCEPTION 'CERTIFICATION_CLEANUP_PATCH_NOT_SINGLE %', i USING ERRCODE='55000';
    END IF;
    d := replace(d,r[i][1],r[i][2]);
  END LOOP;
  -- Every existing refusal and guard still reads the same.
  FOREACH g IN ARRAY guards LOOP
    IF position(g IN d)=0 THEN
      RAISE EXCEPTION 'CERTIFICATION_CLEANUP_GUARD_MISSING %', g USING ERRCODE='55000';
    END IF;
  END LOOP;
  IF (length(d)-length(replace(d,$g$EXISTS (SELECT 1 FROM public.clubs WHERE owner_id = p_user_id)$g$,'')))
       / length($g$EXISTS (SELECT 1 FROM public.clubs WHERE owner_id = p_user_id)$g$) <> 2
     OR (length(d)-length(replace(d,$g$EXISTS (SELECT 1 FROM public.tournament_players WHERE user_id = p_user_id)$g$,'')))
       / length($g$EXISTS (SELECT 1 FROM public.tournament_players WHERE user_id = p_user_id)$g$) <> 2
     OR (length(d)-length(replace(d,'CERTIFICATION_RETIREMENT_HAS_AUTHORITY_OR_CUSTODY','')))
       / length('CERTIFICATION_RETIREMENT_HAS_AUTHORITY_OR_CUSTODY') <> 1
     OR position(seat_old IN d)>0 THEN
    RAISE EXCEPTION 'CERTIFICATION_CLEANUP_GUARD_COUNT_CHANGED' USING ERRCODE='55000';
  END IF;
  EXECUTE d;

  IF (length(q)-length(replace(q,pred_old,'')))<>length(pred_old) THEN
    RAISE EXCEPTION 'CERTIFICATION_RETIREMENT_PREDICATE_ANCHOR_CHANGED' USING ERRCODE='55000';
  END IF;
  q := replace(q,pred_old,pred_new);
  FOREACH g IN ARRAY ARRAY[
    $g$u.deleted_at IS NOT NULL$g$,
    $g$COALESCE(u.encrypted_password, '') = ''$g$,
    $g$EXISTS (SELECT 1 FROM public.chip_ledger l WHERE l.performed_by = u.id)$g$,
    $g$NOT EXISTS (SELECT 1 FROM auth.sessions s WHERE s.user_id = u.id)$g$,
    $g$NOT EXISTS (SELECT 1 FROM auth.refresh_tokens t WHERE t.user_id = u.id::text)$g$,
    $g$NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.owner_id = u.id)$g$,
    $g$NOT EXISTS (SELECT 1 FROM public.club_members m WHERE m.user_id = u.id)$g$,
    $g$NOT EXISTS (SELECT 1 FROM public.tournament_players t WHERE t.user_id = u.id)$g$,
    $g$NOT EXISTS (SELECT 1 FROM public.agents a WHERE a.user_id = u.id)$g$
  ] LOOP
    IF position(g IN q)=0 THEN
      RAISE EXCEPTION 'CERTIFICATION_RETIREMENT_PREDICATE_GUARD_MISSING %', g USING ERRCODE='55000';
    END IF;
  END LOOP;
  EXECUTE q;

  -- Readback: both bodies carry the change, neither lost its authority.
  IF position(seat_new IN pg_get_functiondef(v_door))=0
     OR position(delete_new IN pg_get_functiondef(v_door))=0
     OR position(admit_new IN pg_get_functiondef(v_door))=0
     OR position(seat_old IN pg_get_functiondef(v_door))>0
     OR position(pred_new IN pg_get_functiondef(v_predicate))=0
     OR position(pred_old IN pg_get_functiondef(v_predicate))>0
     OR (SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'secdef',prosecdef)
           FROM pg_proc WHERE oid=v_door) IS DISTINCT FROM v_door_meta
     OR (SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'secdef',prosecdef)
           FROM pg_proc WHERE oid=v_predicate) IS DISTINCT FROM v_predicate_meta THEN
    RAISE EXCEPTION 'CERTIFICATION_CLEANUP_READBACK_CHANGED' USING ERRCODE='55000';
  END IF;
END $patch$;
REVOKE ALL ON FUNCTION public.cleanup_reserved_certification_account(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_certification_identity_retired(uuid) FROM PUBLIC, anon, authenticated;
COMMIT;
