-- Accepted-hand finance used to wait on player_stats.total_losses after it
-- acquired the shared rake wallet. The frozen hand and existing projection
-- outbox already own the original wagers and exactly-once reporting claim.
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_ca_process_hand_post_commit_obligations(uuid)'::regprocedure))='31e330fb0dabb5876565b1c74b7ddf58' AND md5(pg_get_functiondef('public.promo_apply_playthrough(uuid,uuid,numeric)'::regprocedure))='7514b27e268cfa87c4ba03ccc8334311' AND md5(pg_get_functiondef('smarter_private.apply_legacy_member_wager(uuid,uuid,numeric)'::regprocedure))='bc910db6c9fc29e3452ab957f19862f2' AND md5(pg_get_functiondef('smarter_private.credit_original_hand_wagers()'::regprocedure))='c0c9a9e9c6ee4a285d2f656331075dde' AND EXISTS (SELECT FROM pg_trigger WHERE tgrelid='public.hand_projection_outbox'::regclass AND tgname='credit_original_hand_wagers' AND tgfoid='smarter_private.credit_original_hand_wagers()'::regprocedure AND tgenabled='O'))

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '5s';

DO $admission$
BEGIN
  IF md5(pg_get_functiondef('public.promo_apply_playthrough(uuid,uuid,numeric)'::regprocedure)) <> '6e30e4653e6dac22331ca4a431ae3154'
     OR md5(pg_get_functiondef('public.fn_ca_process_hand_post_commit_obligations(uuid)'::regprocedure)) <> '8b81e8bb218cacb235832285e4fbbb24'
     OR md5(pg_get_functiondef('public.fn_project_hand_side_effects(uuid)'::regprocedure)) <> '459a0031d391c2516633b28afdca089e'
     OR md5(pg_get_functiondef('public.fn_project_hand_side_effects_after_post_commit_20260908(uuid)'::regprocedure)) <> 'cee6c2257fcc49c6c6974e5fe8832107'
     OR md5(pg_get_functiondef('public.trg_finish_hand_post_commit_obligations()'::regprocedure)) <> '66d5a81792f64fc5ec1ab33ced6a05ba'
     OR NOT EXISTS (SELECT FROM pg_trigger WHERE tgrelid='public.hand_projection_outbox'::regclass
        AND tgname='a0_finish_hand_post_commit_obligations' AND tgtype=11 AND tgenabled='O'
        AND tgfoid='public.trg_finish_hand_post_commit_obligations()'::regprocedure)
     OR to_regprocedure('smarter_private.apply_legacy_member_wager(uuid,uuid,numeric)') IS NOT NULL
     OR to_regprocedure('smarter_private.credit_original_hand_wagers()') IS NOT NULL THEN
    RAISE EXCEPTION 'legacy wager or original hand authority changed; requalify';
  END IF;
END $admission$;

-- Both entry points share the exact original authorization, member lock,
-- wager threshold, fractional release and journal. The standalone RPC keeps
-- its original synchronous, best-effort reporting contract. Only accepted
-- hands with a durable projector use the financial-only entry point.
DO $factor$
DECLARE
  original text := pg_get_functiondef('public.promo_apply_playthrough(uuid,uuid,numeric)'::regprocedure);
  reporting_block constant text := $block$  BEGIN
    INSERT INTO player_stats (id, user_id, club_id, total_losses, updated_at)
    VALUES (gen_random_uuid(), p_user_id, p_club_id, p_wagered, now())
    ON CONFLICT (user_id, club_id) DO UPDATE
       SET total_losses = player_stats.total_losses + EXCLUDED.total_losses,
           updated_at   = now();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

$block$;
  candidate text;
BEGIN
  candidate := replace(replace(replace(original,'public.promo_apply_playthrough(',
    'smarter_private.apply_legacy_member_wager('),reporting_block,''),
    ' SET search_path TO ''public''',' SET search_path TO ''pg_catalog'', ''public'', ''pg_temp''');
  IF md5(candidate) <> 'bc910db6c9fc29e3452ab957f19862f2' THEN RAISE EXCEPTION 'legacy funded wager postimage mismatch'; END IF;
  EXECUTE candidate;
END $factor$;
REVOKE ALL ON FUNCTION smarter_private.apply_legacy_member_wager(uuid,uuid,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION smarter_private.apply_legacy_member_wager(uuid,uuid,numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.promo_apply_playthrough(p_club_id uuid, p_user_id uuid, p_wagered numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller   text := COALESCE(auth.role(), '');
BEGIN
  /* ZERO-DRIFT (2026-08-31): the wager figure is engine truth. Only the
     engine (service_role) or trusted admin context may apply playthrough -
     an authenticated user could previously release ANY member's locked promo
     by claiming an arbitrary wager. Fail closed. */
  IF NOT (v_caller = 'service_role'
          OR (v_caller = '' AND current_user IN ('postgres', 'supabase_admin'))) THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'engine_only');
  END IF;

  IF p_wagered IS NULL OR p_wagered <= 0 THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'no_wager');
  END IF;

  BEGIN
    INSERT INTO player_stats (id, user_id, club_id, total_losses, updated_at)
    VALUES (gen_random_uuid(), p_user_id, p_club_id, p_wagered, now())
    ON CONFLICT (user_id, club_id) DO UPDATE
       SET total_losses = player_stats.total_losses + EXCLUDED.total_losses,
           updated_at   = now();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN smarter_private.apply_legacy_member_wager(p_club_id,p_user_id,p_wagered);
END;
$function$;

DO $finance$
DECLARE
  candidate text := pg_get_functiondef('public.fn_ca_process_hand_post_commit_obligations(uuid)'::regprocedure);
  loop_start constant text := $part$  FOR v_item IN
    SELECT value
      FROM jsonb_array_elements(v_payload->'promo_playthrough')$part$;
  receipt_start constant text := $part$  UPDATE public.hand_atomic_commits c
     SET post_commit_completed_at$part$;
BEGIN
  candidate := replace(candidate,'  v_promo_count integer := 0;',
    E'  v_promo_count integer := 0;\n  v_project_wagers boolean;');
  candidate := replace(candidate,loop_start,$part$  -- A frozen hand with an existing projection claim can leave its reporting
  -- write to that claim. A legacy hand without an outbox retains its old path.
  v_project_wagers := jsonb_array_length(v_payload->'promo_playthrough') > 0
    AND EXISTS (SELECT 1 FROM public.hand_projection_outbox o
                 WHERE o.hand_id=p_hand_id AND o.table_id=v_commit.table_id
                   AND o.hand_number=v_commit.hand_number);

$part$ || loop_start);
  candidate := replace(candidate,$part$    v_promo_result := public.promo_apply_playthrough(
      (v_item->>'club_id')::uuid,
      (v_item->>'user_id')::uuid,
      (v_item->>'wagered')::numeric
    );$part$,$part$    IF v_project_wagers THEN
      v_promo_result := smarter_private.apply_legacy_member_wager(
        (v_item->>'club_id')::uuid,
        (v_item->>'user_id')::uuid,
        (v_item->>'wagered')::numeric
      );
    ELSE
      v_promo_result := public.promo_apply_playthrough(
        (v_item->>'club_id')::uuid,
        (v_item->>'user_id')::uuid,
        (v_item->>'wagered')::numeric
      );
    END IF;$part$);
  candidate := replace(candidate,receipt_start,$part$  IF v_project_wagers THEN
    v_result := v_result || jsonb_build_object('wager_stats_owner','hand_projection_outbox');
  END IF;

$part$ || receipt_start);
  IF md5(candidate) <> '31e330fb0dabb5876565b1c74b7ddf58' THEN RAISE EXCEPTION 'original hand wager financial postimage mismatch'; END IF;
  EXECUTE candidate;
END $finance$;

-- Old completed finance already accounted for its wagers. Only a newly
-- marked receipt admits an additive write. AFTER DELETE binds that write to
-- the original projector's successful claim, including rollback and replay.
CREATE FUNCTION smarter_private.credit_original_hand_wagers() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public, pg_temp AS $function$
DECLARE
  wagers jsonb;
  envelope jsonb;
  original_hash text;
BEGIN
  SELECT c.post_commit_payload,c.post_commit_payload_hash
    INTO envelope,original_hash FROM public.hand_atomic_commits c
   WHERE c.hand_id=OLD.hand_id AND c.table_id=OLD.table_id AND c.hand_number=OLD.hand_number
     AND c.post_commit_completed_at IS NOT NULL
     AND c.post_commit_result->>'wager_stats_owner'='hand_projection_outbox';
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF encode(extensions.digest(convert_to(envelope::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM original_hash THEN
    RAISE EXCEPTION 'original hand wager envelope hash mismatch for %',OLD.hand_id;
  END IF;
  wagers := envelope->'promo_playthrough';
  IF jsonb_typeof(wagers) IS DISTINCT FROM 'array' OR jsonb_array_length(wagers)=0 THEN
    RAISE EXCEPTION 'missing original wagers for marked hand %',OLD.hand_id;
  END IF;

  -- The original recorded each wager into numeric(15,2) before adding it.
  -- Cast each element first, including duplicate contributors. Deleted
  -- profiles have no surviving stats (the existing FK cascades on delete).
  INSERT INTO public.player_stats AS ps(id,user_id,club_id,total_losses,updated_at)
  SELECT gen_random_uuid(),w.user_id,w.club_id,sum(w.wagered::numeric(15,2)),now()
    FROM jsonb_to_recordset(wagers) AS w(user_id uuid,club_id uuid,wagered numeric)
    JOIN public.profiles p ON p.id=w.user_id
   GROUP BY w.user_id,w.club_id ORDER BY w.user_id,w.club_id
  ON CONFLICT (user_id,club_id) DO UPDATE
     SET total_losses=ps.total_losses+EXCLUDED.total_losses,updated_at=now();
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION smarter_private.credit_original_hand_wagers() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER credit_original_hand_wagers AFTER DELETE ON public.hand_projection_outbox
FOR EACH ROW EXECUTE FUNCTION smarter_private.credit_original_hand_wagers();

DO $verify$
BEGIN
  IF md5(pg_get_functiondef('smarter_private.credit_original_hand_wagers()'::regprocedure)) <> 'c0c9a9e9c6ee4a285d2f656331075dde'
     OR md5(pg_get_functiondef('public.promo_apply_playthrough(uuid,uuid,numeric)'::regprocedure)) <> '7514b27e268cfa87c4ba03ccc8334311'
     OR md5(pg_get_functiondef('smarter_private.apply_legacy_member_wager(uuid,uuid,numeric)'::regprocedure)) <> 'bc910db6c9fc29e3452ab957f19862f2'
     OR md5(pg_get_functiondef('public.fn_ca_process_hand_post_commit_obligations(uuid)'::regprocedure)) <> '31e330fb0dabb5876565b1c74b7ddf58' THEN
    RAISE EXCEPTION 'installed legacy wager definition mismatch';
  END IF;
END $verify$;
COMMIT;
