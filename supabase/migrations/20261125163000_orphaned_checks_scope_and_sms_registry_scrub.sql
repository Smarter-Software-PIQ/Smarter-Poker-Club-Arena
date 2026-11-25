-- ORPHANED CHECKS SCOPE + COMPLETE SMS REGISTRY SCRUB (2026-11-25)
--
-- Owner request (2026-11-25):
--   1. Close overdue drift incident a1fb53c2-979a-4469-8aff-9d388e2ef252 at its
--      root: fn_ca_orphaned_checks() flagged two World Hub Trivia RPCs
--      (trivia_integrity_review_queue_v1, trivia_record_integrity_signal_v1)
--      as unscheduled Club Arena ledger sweeps, and fn_ca_orphaned_checks_watch()
--      resolved ca_drift_incidents without closing its financial_alerts mirror
--      (bc7164e6-5590-4bc8-a3b6-81cb864957e9).
--   2. Remove all permanently carrier-refused phone numbers (2x 30006 landline /
--      unreachable carrier, 1x 30005 unknown or blocked by the carrier, plus
--      any earlier permanently refused numbers) from EVERY SMS registry table:
--      20261106203917's fn_sms_scrub_number() and drop triggers covered only 7
--      CA/WH tables and missed commander_members (2x 30006 still present),
--      commander_staff (1x 30005 still present), commander_home_members,
--      commander_onboarding_leads, commander_waitlist,
--      commander_tournament_entries, and newsletter_subscribers ('sms:%').
--   3. Provide public.fn_sms_filter_suppressed_phones(text[]) so World Hub
--      campaign dispatchers can batch-check candidate numbers against
--      smarter_private.sms_suppressed_numbers instead of reading blanked
--      sms_delivery_receipts.to_number rows.
--
-- No chips or money move anywhere in this migration.
--
-- @live-proof: to_regprocedure('public.fn_sms_filter_suppressed_phones(text[])') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_commander_members_drops_suppressed_phone') AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_commander_staff_drops_suppressed_phone') AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_newsletter_subscribers_blocks_suppressed_sms') AND position('commander_members' IN pg_get_functiondef('public.fn_sms_scrub_number(text,text)'::regprocedure)) > 0 AND position('drift_incident:fn_ca_orphaned_checks_watch' IN pg_get_functiondef('public.fn_ca_orphaned_checks_watch()'::regprocedure)) > 0 AND NOT EXISTS (SELECT 1 FROM public.fn_ca_orphaned_checks()) AND NOT EXISTS (SELECT 1 FROM public.ca_drift_incidents WHERE source = 'fn_ca_orphaned_checks_watch' AND resolved_at IS NULL) AND NOT EXISTS (SELECT 1 FROM public.financial_alerts WHERE source = 'drift_incident:fn_ca_orphaned_checks_watch' AND NOT resolved) AND NOT EXISTS (SELECT 1 FROM public.commander_members WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone)) AND NOT EXISTS (SELECT 1 FROM public.commander_staff WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone))

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

-- ── Preimage guards against live production definitions ────────────────────
DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_orphaned_checks()'::regprocedure)) IS DISTINCT FROM 'cd84dc64c1856c469fcd66cea4a609e0' THEN
    RAISE EXCEPTION 'ORPHANED_SMS_PREIMAGE_DRIFT fn_ca_orphaned_checks';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_orphaned_checks_watch()'::regprocedure))
     NOT IN ('573113e330b811c3064156641e6e7ccf', 'f2b8756683848515b3356de6058832c7') THEN
    RAISE EXCEPTION 'ORPHANED_SMS_PREIMAGE_DRIFT fn_ca_orphaned_checks_watch';
  END IF;
  IF md5(pg_get_functiondef('public.fn_sms_scrub_number(text,text)'::regprocedure)) IS DISTINCT FROM 'd5890c399c05e72d8733843dafc6a778' THEN
    RAISE EXCEPTION 'ORPHANED_SMS_PREIMAGE_DRIFT fn_sms_scrub_number';
  END IF;
  IF md5(pg_get_functiondef('public.fn_sms_notice_row_drops_suppressed_phone()'::regprocedure)) IS DISTINCT FROM '1b97073fa46d66321ed7c35c75641197' THEN
    RAISE EXCEPTION 'ORPHANED_SMS_PREIMAGE_DRIFT fn_sms_notice_row_drops_suppressed_phone';
  END IF;
END $guard$;

-- ── 1. Orphaned-checks scope: Trivia/PNM app RPCs + mirror closure ─────────
INSERT INTO public.ca_check_sweep_exemptions (proname, reason)
VALUES
  (
    'trivia_integrity_review_queue_v1',
    'World Hub Trivia admin review queue reader RPC (p_limit), not a Club Arena chip-ledger sweep check'
  ),
  (
    'trivia_record_integrity_signal_v1',
    'World Hub Trivia per-session anti-cheat telemetry writer RPC (p_session_id, p_user_id), not a Club Arena chip-ledger sweep check'
  )
ON CONFLICT (proname) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_ca_orphaned_checks()
 RETURNS TABLE(proname text, args text, why text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH sweep AS (
    SELECT COALESCE(
      (SELECT pg_get_functiondef(p.oid)
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public' AND p.proname='fn_ca_conservation_sweep'
        LIMIT 1), '') AS body
  ),
  candidates AS (
    SELECT p.oid AS oid, p.proname::text AS pn,
           pg_get_function_identity_arguments(p.oid) AS ar
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND p.prorettype <> 'trigger'::regtype
       AND p.proname ~ '(conservation|_check$|_audit$|_watch$|integrity)'
       AND p.proname NOT LIKE '%selftest%'
       /* Non-Club-Arena product RPC prefixes (World Hub Trivia, Poker Near Me)
          share the public schema but are not Club Arena chip-ledger sweeps
          (2026-11-25: trivia_integrity_review_queue_v1 and
          trivia_record_integrity_signal_v1 falsely opened drift a1fb53c2). */
       AND p.proname !~ '^(trivia_|pnm_)'
       /* A DOOR IS NOT A CHECK. A function taking an actor, an op id, a
          case id, a request id, a supplied value or a session id is an
          app-called RPC or helper, not a fleet-wide scheduled sweep. */
       AND pg_get_function_identity_arguments(p.oid) !~ '(p_actor|p_op_id|p_case_id|p_request_id|p_value|p_session_id)'
  )
  SELECT c.pn, c.ar,
         'exists but nothing runs it: no cron entry, not called by fn_ca_conservation_sweep, and no exemption reason'
    FROM candidates c, sweep s
   WHERE NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.command LIKE '%' || c.pn || '%')
     /* A CHECK ANOTHER FUNCTION CALLS IS RUN. The weekly cascade calls
        fn_union_settlement_conservation_assert between its rounds; nothing
        in cron names it, and it is not orphaned. */
     AND NOT EXISTS (SELECT 1 FROM pg_proc q JOIN pg_namespace qn ON qn.oid = q.pronamespace
                      WHERE qn.nspname = 'public' AND q.oid <> c.oid
                        AND q.prosrc LIKE '%' || c.pn || '%')
     AND position(c.pn IN s.body) = 0
     AND NOT EXISTS (SELECT 1 FROM public.ca_check_sweep_exemptions e WHERE e.proname = c.pn)
   ORDER BY 1;
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_orphaned_checks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_orphaned_checks() TO service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_orphaned_checks_watch()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '2s'
 SET statement_timeout TO '30s'
AS $function$
DECLARE v_n int; v_rows jsonb;
BEGIN
  SELECT count(*), jsonb_agg(jsonb_build_object('fn', o.proname, 'args', o.args))
    INTO v_n, v_rows
    FROM public.fn_ca_orphaned_checks() o;

  IF COALESCE(v_n,0) > 0 THEN
    PERFORM public.fn_ca_raise_drift_incident(
      'fn_ca_orphaned_checks_watch', 'unknown', 'warning',
      'orphaned-checks:' || CURRENT_DATE::text,
      0, NULL, NULL, 'ledger', 'pg_proc',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      v_n || ' integrity check function(s) exist that nothing ever runs. '
        || 'Schedule them, add them to fn_ca_conservation_sweep, or exempt them '
        || 'with a reason in ca_check_sweep_exemptions. A check nobody runs '
        || 'reads as a check finding nothing.',
      false, jsonb_build_object('orphans', v_rows));
  END IF;
  -- A WATCH CLOSES WHAT IT OPENED (20261118155109 + 20261125163000): close
  -- both the drift incident and its financial_alerts mirror once re-measured 0.
  -- Its own subtransaction: a refused close never costs the watch its answer.
  IF COALESCE(v_n,0) = 0 THEN
    BEGIN
      UPDATE public.ca_drift_incidents
         SET status = 'resolved', closure_basis = 'verified_remeasured', resolved_at = now(),
             root_cause = 'integrity check functions existed that nothing scheduled, swept or called; each has since been scheduled, called by another function, or exempted with its reason',
             correction_ref = 'verified: fn_ca_orphaned_checks() returns no function',
             resolution = 'every integrity check is scheduled, swept, called by another function, or exempt with its reason'
       WHERE source = 'fn_ca_orphaned_checks_watch' AND resolved_at IS NULL;
      UPDATE public.financial_alerts
         SET resolved = true, resolved_at = now()
       WHERE source = 'drift_incident:fn_ca_orphaned_checks_watch' AND NOT resolved;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fn_ca_orphaned_checks_watch could not close its incidents: %', SQLERRM;
    END;
  END IF;
  RETURN COALESCE(v_n,0);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_orphaned_checks_watch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_orphaned_checks_watch() TO service_role;

-- @probe-for: public.fn_ca_orphaned_checks_watch
DO $probe$
DECLARE v_probe_count integer;
BEGIN
  SELECT public.fn_ca_orphaned_checks_watch() INTO v_probe_count;
  IF v_probe_count IS NULL OR v_probe_count < 0 THEN
    RAISE EXCEPTION 'fn_ca_orphaned_checks_watch probe returned %', v_probe_count;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job) AND v_probe_count <> 0 THEN
    RAISE EXCEPTION 'fn_ca_orphaned_checks_watch probe returned % with active cron.job', v_probe_count;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- Re-measure live: closes drift a1fb53c2 and its financial_alerts mirror bc7164e6.
-- Schema-only DDL rehearsal copies have an empty cron.job table; the probe above
-- already verified execution and trivia_/pnm_ exclusion on production's schema.
DO $verify_orphans$
DECLARE v_left int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job) THEN
    RETURN;
  END IF;
  SELECT public.fn_ca_orphaned_checks_watch() INTO v_left;
  IF COALESCE(v_left, -1) <> 0 THEN
    RAISE EXCEPTION 'ORPHANED_CHECKS_STILL_PRESENT count=%', v_left;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ca_drift_incidents WHERE source = 'fn_ca_orphaned_checks_watch' AND resolved_at IS NULL) THEN
    RAISE EXCEPTION 'ORPHANED_CHECKS_DRIFT_STILL_OPEN';
  END IF;
  IF EXISTS (SELECT 1 FROM public.financial_alerts WHERE source = 'drift_incident:fn_ca_orphaned_checks_watch' AND NOT resolved) THEN
    RAISE EXCEPTION 'ORPHANED_CHECKS_MIRROR_STILL_OPEN';
  END IF;
END $verify_orphans$;

-- ── 2. Complete SMS registry scrubbing, drop triggers & batch filter RPC ───
-- Allow scrubbing broken phone numbers on onboarding leads cleanly to NULL.
ALTER TABLE public.commander_onboarding_leads ALTER COLUMN phone DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_sms_filter_suppressed_phones(p_phones text[])
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(array_agg(DISTINCT u.phone), ARRAY[]::text[])
    FROM unnest(COALESCE(p_phones, ARRAY[]::text[])) AS u(phone)
   WHERE u.phone IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM smarter_private.sms_suppressed_numbers s
        WHERE s.number_hash = public.fn_sms_number_hash(u.phone)
     )
$$;
REVOKE ALL ON FUNCTION public.fn_sms_filter_suppressed_phones(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sms_filter_suppressed_phones(text[]) TO service_role;
COMMENT ON FUNCTION public.fn_sms_filter_suppressed_phones(text[]) IS
  'Returns the subset of caller-supplied candidate phone strings whose E.164 hash is permanently suppressed in smarter_private.sms_suppressed_numbers.';

-- Removes one permanently refused number from EVERY SMS registry table in the platform.
CREATE OR REPLACE FUNCTION public.fn_sms_scrub_number(p_phone text, p_except_sid text DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE d text := public.fn_sms_e164_digits(p_phone); n integer := 0; k integer;
BEGIN
  IF d IS NULL THEN RETURN 0; END IF;
  UPDATE public.profiles SET phone = NULL WHERE phone IS NOT NULL AND public.fn_sms_e164_digits(phone) = d;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE public.sp_relaunch_awards SET phone = NULL WHERE phone IS NOT NULL AND public.fn_sms_e164_digits(phone) = d;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE public.sp_player_announcement_recipients SET phone = NULL WHERE phone IS NOT NULL AND public.fn_sms_e164_digits(phone) = d;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE public.sp_signup_welcome_back_awards SET phone = NULL WHERE phone IS NOT NULL AND public.fn_sms_e164_digits(phone) = d;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  DELETE FROM public.sms_otp_codes WHERE public.fn_sms_e164_digits(phone) = d;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  DELETE FROM public.phone_verification_receipts WHERE public.fn_sms_e164_digits(phone) = d;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  -- Commander & marketing SMS registries (2026-11-25: 2x 30006 in commander_members,
  -- 1x 30005 in commander_staff survived 20261106203917 because these tables were omitted).
  UPDATE public.commander_members SET phone = NULL WHERE phone IS NOT NULL AND public.fn_sms_e164_digits(phone) = d;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE public.commander_home_members SET phone = NULL WHERE phone IS NOT NULL AND public.fn_sms_e164_digits(phone) = d;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE public.commander_staff SET phone = NULL WHERE phone IS NOT NULL AND public.fn_sms_e164_digits(phone) = d;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE public.commander_onboarding_leads SET phone = NULL WHERE phone IS NOT NULL AND public.fn_sms_e164_digits(phone) = d;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE public.commander_waitlist SET player_phone = NULL WHERE player_phone IS NOT NULL AND public.fn_sms_e164_digits(player_phone) = d;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE public.commander_tournament_entries SET player_phone = NULL WHERE player_phone IS NOT NULL AND public.fn_sms_e164_digits(player_phone) = d;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  DELETE FROM public.newsletter_subscribers
   WHERE email LIKE 'sms:%' AND public.fn_sms_e164_digits(substring(email FROM 5)) = d;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  -- Older receipts to the same number keep their status and code, not the number.
  UPDATE public.sms_delivery_receipts SET to_number = NULL
   WHERE to_number IS NOT NULL AND public.fn_sms_e164_digits(to_number) = d
     -- The receipt whose own trigger is running is blanked through NEW.
     AND sid IS DISTINCT FROM p_except_sid;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.fn_sms_scrub_number(text, text) FROM PUBLIC, anon, authenticated;

-- @probe-for: public.fn_sms_scrub_number
DO $probe$
DECLARE v_scrubbed integer;
BEGIN
  SELECT public.fn_sms_scrub_number('+10000000000', NULL) INTO v_scrubbed;
  IF v_scrubbed IS NULL OR v_scrubbed < 0 THEN
    RAISE EXCEPTION 'fn_sms_scrub_number probe returned %', v_scrubbed;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- Dedicated trigger for tables whose phone column is named player_phone.
CREATE OR REPLACE FUNCTION public.fn_sms_player_phone_row_drops_suppressed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.player_phone IS NOT NULL AND public.fn_sms_number_is_suppressed(NEW.player_phone) THEN
    NEW.player_phone := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_sms_player_phone_row_drops_suppressed() FROM PUBLIC, anon, authenticated;

-- Dedicated trigger for newsletter_subscribers storing SMS leads as 'sms:<e164>'.
CREATE OR REPLACE FUNCTION public.fn_sms_newsletter_row_blocks_suppressed_phone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.email IS NOT NULL AND NEW.email LIKE 'sms:%'
     AND public.fn_sms_number_is_suppressed(substring(NEW.email FROM 5)) THEN
    IF TG_OP = 'INSERT' THEN
      RETURN NULL;
    END IF;
    NEW.is_active := false;
    NEW.unsubscribed_at := COALESCE(NEW.unsubscribed_at, now());
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_sms_newsletter_row_blocks_suppressed_phone() FROM PUBLIC, anon, authenticated;

-- Prevent permanently refused numbers from re-entering any Commander or SMS marketing registry.
DROP TRIGGER IF EXISTS trg_commander_members_drops_suppressed_phone ON public.commander_members;
CREATE TRIGGER trg_commander_members_drops_suppressed_phone
  BEFORE INSERT OR UPDATE OF phone ON public.commander_members
  FOR EACH ROW EXECUTE FUNCTION public.fn_sms_notice_row_drops_suppressed_phone();

DROP TRIGGER IF EXISTS trg_commander_home_members_drops_suppressed_phone ON public.commander_home_members;
CREATE TRIGGER trg_commander_home_members_drops_suppressed_phone
  BEFORE INSERT OR UPDATE OF phone ON public.commander_home_members
  FOR EACH ROW EXECUTE FUNCTION public.fn_sms_notice_row_drops_suppressed_phone();

DROP TRIGGER IF EXISTS trg_commander_staff_drops_suppressed_phone ON public.commander_staff;
CREATE TRIGGER trg_commander_staff_drops_suppressed_phone
  BEFORE INSERT OR UPDATE OF phone ON public.commander_staff
  FOR EACH ROW EXECUTE FUNCTION public.fn_sms_notice_row_drops_suppressed_phone();

DROP TRIGGER IF EXISTS trg_commander_onboarding_leads_drops_suppressed_phone ON public.commander_onboarding_leads;
CREATE TRIGGER trg_commander_onboarding_leads_drops_suppressed_phone
  BEFORE INSERT OR UPDATE OF phone ON public.commander_onboarding_leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_sms_notice_row_drops_suppressed_phone();

DROP TRIGGER IF EXISTS trg_commander_waitlist_drops_suppressed_phone ON public.commander_waitlist;
CREATE TRIGGER trg_commander_waitlist_drops_suppressed_phone
  BEFORE INSERT OR UPDATE OF player_phone ON public.commander_waitlist
  FOR EACH ROW EXECUTE FUNCTION public.fn_sms_player_phone_row_drops_suppressed();

DROP TRIGGER IF EXISTS trg_commander_tournament_entries_drops_suppressed_phone ON public.commander_tournament_entries;
CREATE TRIGGER trg_commander_tournament_entries_drops_suppressed_phone
  BEFORE INSERT OR UPDATE OF player_phone ON public.commander_tournament_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_sms_player_phone_row_drops_suppressed();

DROP TRIGGER IF EXISTS trg_newsletter_subscribers_blocks_suppressed_sms ON public.newsletter_subscribers;
CREATE TRIGGER trg_newsletter_subscribers_blocks_suppressed_sms
  BEFORE INSERT OR UPDATE OF email, is_active ON public.newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.fn_sms_newsletter_row_blocks_suppressed_phone();

-- Backfill: scrub every already-suppressed number from every SMS registry table
-- (including the 2x 30006 commander_members rows and 1x 30005 commander_staff row).
UPDATE public.profiles SET phone = NULL
 WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone);
UPDATE public.sp_relaunch_awards SET phone = NULL
 WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone);
UPDATE public.sp_player_announcement_recipients SET phone = NULL
 WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone);
UPDATE public.sp_signup_welcome_back_awards SET phone = NULL
 WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone);
DELETE FROM public.sms_otp_codes
 WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone);
DELETE FROM public.phone_verification_receipts
 WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone);
UPDATE public.commander_members SET phone = NULL
 WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone);
UPDATE public.commander_home_members SET phone = NULL
 WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone);
UPDATE public.commander_staff SET phone = NULL
 WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone);
UPDATE public.commander_onboarding_leads SET phone = NULL
 WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone);
UPDATE public.commander_waitlist SET player_phone = NULL
 WHERE player_phone IS NOT NULL AND public.fn_sms_number_is_suppressed(player_phone);
UPDATE public.commander_tournament_entries SET player_phone = NULL
 WHERE player_phone IS NOT NULL AND public.fn_sms_number_is_suppressed(player_phone);
DELETE FROM public.newsletter_subscribers
 WHERE email LIKE 'sms:%' AND public.fn_sms_number_is_suppressed(substring(email FROM 5));
UPDATE public.sms_delivery_receipts SET to_number = NULL
 WHERE to_number IS NOT NULL AND public.fn_sms_number_is_suppressed(to_number);

-- Fail-closed post-scrub verification across all 14 SMS registry tables.
DO $verify_sms_registries$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone))
     OR EXISTS (SELECT 1 FROM public.sp_relaunch_awards WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone))
     OR EXISTS (SELECT 1 FROM public.sp_player_announcement_recipients WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone))
     OR EXISTS (SELECT 1 FROM public.sp_signup_welcome_back_awards WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone))
     OR EXISTS (SELECT 1 FROM public.sms_otp_codes WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone))
     OR EXISTS (SELECT 1 FROM public.phone_verification_receipts WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone))
     OR EXISTS (SELECT 1 FROM public.commander_members WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone))
     OR EXISTS (SELECT 1 FROM public.commander_home_members WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone))
     OR EXISTS (SELECT 1 FROM public.commander_staff WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone))
     OR EXISTS (SELECT 1 FROM public.commander_onboarding_leads WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone))
     OR EXISTS (SELECT 1 FROM public.commander_waitlist WHERE player_phone IS NOT NULL AND public.fn_sms_number_is_suppressed(player_phone))
     OR EXISTS (SELECT 1 FROM public.commander_tournament_entries WHERE player_phone IS NOT NULL AND public.fn_sms_number_is_suppressed(player_phone))
     OR EXISTS (SELECT 1 FROM public.newsletter_subscribers WHERE email LIKE 'sms:%' AND public.fn_sms_number_is_suppressed(substring(email FROM 5)))
     OR EXISTS (SELECT 1 FROM public.sms_delivery_receipts WHERE to_number IS NOT NULL AND public.fn_sms_number_is_suppressed(to_number)) THEN
    RAISE EXCEPTION 'SMS_REGISTRY_SCRUB_INCOMPLETE a permanently refused number still exists in a registry table';
  END IF;
END $verify_sms_registries$;

COMMIT;
