-- Signup promo: one award per verified phone and known browser/app install.
-- Version reserved by scripts/new-migration.mjs.
-- @install-window: daily-maintenance
-- @locks: public.profiles
-- @live-proof: EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.profiles'::regclass AND tgname='zz_ca_signup_promo_verified_phone' AND tgenabled='O')
--
-- The existing awards row remains the one lifetime campaign receipt. These
-- are identity uniqueness constraints, not a second campaign or payment door.
-- Verification captures the first server-verified phone for this account,
-- so changing a profile phone later cannot change the promo identity. No raw
-- phone or push credential is copied. A shared device/phone withholds only
-- the free signup gift; it never refuses signup, phone verification or play.
-- Existing promos are not retroactively locked or claimed. Enforcement and
-- identity claims stay off until the programme's explicit go-live moment.
-- Profile trigger installation takes its existing daily DDL window.
BEGIN;
SET LOCAL lock_timeout='1s';
DO $guard$
BEGIN
  IF to_regclass('public.ca_promo_play_through_settings') IS NULL THEN
    RAISE EXCEPTION 'Promo play-through phase 1 must be installed before signup identity enforcement';
  END IF;
END;
$guard$;


CREATE TABLE public.ca_signup_promo_verified_phones (
  user_id uuid PRIMARY KEY,
  phone_hash text NOT NULL CHECK (length(phone_hash)=64),
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.ca_signup_promo_verified_phones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_signup_promo_verified_phones FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_signup_promo_verified_phones TO service_role;

CREATE TABLE public.ca_signup_promo_identity_claims (
  identity_kind text NOT NULL CHECK (identity_kind IN ('phone','device')),
  identity_hash text NOT NULL CHECK (length(identity_hash)=64),
  user_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (identity_kind,identity_hash)
);
ALTER TABLE public.ca_signup_promo_identity_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_signup_promo_identity_claims FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ca_signup_promo_identity_claims TO service_role;

CREATE FUNCTION public.fn_ca_signup_promo_verified_phone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_phone text;
BEGIN
  -- Browser-controlled profile edits cannot manufacture a verified binding.
  IF NOT public.fn_is_service_context() OR NEW.phone_verified IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;
  v_phone:=regexp_replace(COALESCE(NEW.phone,''),'[^0-9]','','g');
  IF length(v_phone) BETWEEN 10 AND 15 THEN
    INSERT INTO public.ca_signup_promo_verified_phones(user_id,phone_hash)
    VALUES(NEW.id,encode(extensions.digest('signup-phone:'||v_phone,'sha256'),'hex'))
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_signup_promo_verified_phone() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER zz_ca_signup_promo_verified_phone
  AFTER INSERT OR UPDATE OF phone,phone_verified ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_signup_promo_verified_phone();

CREATE FUNCTION public.fn_ca_signup_promo_claim_identity(p_user_id uuid,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_phone text;
  v_devices text[];
  v_claim record;
  v_owner uuid;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'Signup Promo Identity Is Service Only' USING ERRCODE='42501';
  END IF;
  IF p_user_id IS NULL OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'Signup Promo Needs Its User And Original Operation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ca_promo_play_through_settings s
                 WHERE s.id AND s.enforced_from IS NOT NULL AND s.enforced_from<=clock_timestamp()) THEN
    RETURN jsonb_build_object('success',true,'enforced',false);
  END IF;
  SELECT b.phone_hash INTO v_phone FROM public.ca_signup_promo_verified_phones b
   WHERE b.user_id=p_user_id;
  IF v_phone IS NULL THEN
    RETURN jsonb_build_object('success',false,'error_code','signup_promo_phone_required',
      'error','Confirm Your Phone Before Receiving Signup Promo Chips');
  END IF;
  SELECT array_agg(encode(extensions.digest('signup-device:'||d.device_id,'sha256'),'hex'))
    INTO v_devices FROM (
      SELECT DISTINCT lower(s.device_id) device_id
        FROM public.anti_cheat_device_sightings s
       WHERE s.user_id=p_user_id AND s.device_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       ORDER BY 1 LIMIT 101
    ) d;
  IF COALESCE(cardinality(v_devices),0)>100 THEN
    RETURN jsonb_build_object('success',false,'error_code','signup_promo_device_review',
      'error','Signup Promo Device History Needs Review');
  END IF;
  IF COALESCE(cardinality(v_devices),0)=0 THEN
    RETURN jsonb_build_object('success',false,'error_code','signup_promo_device_required',
      'error','Open Club Arena On Your Device Before Receiving Signup Promo Chips');
  END IF;

  -- The campaign's existing award receipts remain authoritative, including
  -- gifts paid before this feature. Recognize known prior device use and a
  -- prior gift phone that still matches that account's verified phone. No
  -- historic gift or player balance is rewritten.
  IF EXISTS (
    SELECT 1 FROM public.sp_signup_welcome_back_awards a
      JOIN public.anti_cheat_device_sightings d ON d.user_id=a.user_id
     WHERE a.status='awarded' AND a.user_id<>p_user_id
       AND encode(extensions.digest('signup-device:'||lower(d.device_id),'sha256'),'hex')=ANY(v_devices)
  ) OR EXISTS (
    SELECT 1 FROM public.sp_signup_welcome_back_awards a
      JOIN public.profiles p ON p.id=a.user_id
     WHERE a.status='awarded' AND a.user_id<>p_user_id AND p.phone_verified
       AND regexp_replace(COALESCE(p.phone,''),'[^0-9]','','g')=regexp_replace(COALESCE(a.phone,''),'[^0-9]','','g')
       AND encode(extensions.digest('signup-phone:'||regexp_replace(COALESCE(a.phone,''),'[^0-9]','','g'),'sha256'),'hex')=v_phone
  ) THEN
    RETURN jsonb_build_object('success',false,'error_code','signup_promo_identity_used',
      'error','Signup Promo Has Already Been Received On This Phone Or Device');
  END IF;

  -- All keys in one subtransaction, in deterministic order. A duplicate on
  -- any key rolls back this attempt's other reservations. The crediting
  -- caller encloses this success and the actual gift in its own transaction.
  BEGIN
    FOR v_claim IN
      SELECT kind,identity_hash FROM (
        SELECT 'phone'::text kind,v_phone identity_hash
        UNION ALL SELECT 'device',unnest(v_devices)
      ) k ORDER BY kind,identity_hash
    LOOP
      INSERT INTO public.ca_signup_promo_identity_claims(identity_kind,identity_hash,user_id,operation_id)
      VALUES(v_claim.kind,v_claim.identity_hash,p_user_id,p_operation_id)
      ON CONFLICT (identity_kind,identity_hash) DO NOTHING;
      SELECT c.user_id INTO v_owner FROM public.ca_signup_promo_identity_claims c
       WHERE c.identity_kind=v_claim.kind AND c.identity_hash=v_claim.identity_hash;
      IF v_owner IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION 'Signup Promo Has Already Been Received On This Phone Or Device'
          USING ERRCODE='PPT01';
      END IF;
    END LOOP;
  EXCEPTION WHEN SQLSTATE 'PPT01' THEN
    RETURN jsonb_build_object('success',false,'error_code','signup_promo_identity_used',
      'error','Signup Promo Has Already Been Received On This Phone Or Device');
  END;
  RETURN jsonb_build_object('success',true,'enforced',true);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_signup_promo_claim_identity(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_signup_promo_claim_identity(uuid,uuid) TO service_role;

DO $patch$
DECLARE
  d text:=pg_get_functiondef('public.fn_sp_signup_welcome_back_run(integer,date)'::regprocedure);
  old_block text:=$before$    BEGIN
      v_res := public.fn_promo_disburse('union', v_union, 'player', c.id, v_amount,
                 format('Welcome Back Chips - %s free chips from the Midway Union for your first hand', v_amount_txt),
                 NULL, v_op);
    EXCEPTION WHEN OTHERS THEN$before$;
  new_block text:=$after$    BEGIN
      v_res := public.fn_ca_signup_promo_claim_identity(c.id,v_op);
      IF COALESCE((v_res->>'success')::boolean,false) THEN
        v_res := public.fn_promo_disburse('union', v_union, 'player', c.id, v_amount,
                   format('Welcome Back Chips - %s free chips from the Midway Union for your first hand', v_amount_txt),
                   NULL, v_op);
        IF NOT COALESCE((v_res->>'success')::boolean,false) THEN
          RAISE EXCEPTION '%',COALESCE(v_res->>'error','Signup Promo Credit Was Refused')
            USING ERRCODE='PPT02';
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN$after$;
BEGIN
  IF md5(d)<>'51629e5f1ef59835c3719ec553356eb8' THEN
    RAISE EXCEPTION 'Signup promo owner changed; reconcile the identity claim with its current credit transaction';
  END IF;
  IF position(old_block in d)=0 OR length(d)-length(replace(d,old_block,''))<>length(old_block) THEN
    RAISE EXCEPTION 'Signup promo credit block did not match exactly once';
  END IF;
  EXECUTE replace(d,old_block,new_block);
END;
$patch$;

-- The existing weekly owner now pays the KINGS branch of this same campaign.
-- Reserve the same identity in that original payment transaction as well;
-- refusing one gift does not block the remaining eligible recipients.
-- Current205150 owns document-gated book selection and its durable receipt;
-- preserve that entire owner and add only the same identity claim before credit.
DO $weekly$
DECLARE d text;needle text:=E'    payment:=public.fn_promo_disburse(';
BEGIN
 SELECT pg_get_functiondef('smarter_private.weekly_kings_welcome_due()'::regprocedure) INTO d;
 IF md5(d)<>'a5b39719461d6f6e9e81c46acb2301fd' THEN
  RAISE EXCEPTION 'Weekly signup promo owner changed; reconcile its original identity and credit transaction';
 END IF;
 IF length(d)-length(replace(d,needle,''))<>length(needle) THEN RAISE EXCEPTION 'weekly_signup_promo_credit_anchor_changed'; END IF;
 EXECUTE replace(d,needle,E'    DECLARE identity_result jsonb; BEGIN\n      identity_result:=public.fn_ca_signup_promo_claim_identity(member.user_id,op);\n      IF identity_result->>''success'' IS DISTINCT FROM ''true'' THEN CONTINUE; END IF;\n    END;\n'||needle);
END $weekly$;

COMMIT;
