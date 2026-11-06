-- NEEDS YOUR ATTENTION, 2026-11-05 DIGEST: FIVE ITEMS CLOSED AT THEIR ROOTS
-- (Dan, 2026-11-06: "FIX ANY AND ALL OF THESE ISSUES, AND REMOVE THE TWO
-- BLOCKED NUMBERS FROM THE DATABASE ... HARDCODE FIX ... NO PATCHES ... THEN
-- HARDEN THEM TO PREVENT FUTURE REGRESSIONS").
--
-- 1. A NUMBER THE CARRIER PERMANENTLY REFUSES LEAVES THE DATABASE BY ITSELF.
--    Two texts on 2026-11-05 came back 30005 (number unknown or blocked by the
--    carrier). The platform kept both numbers and kept texting them: the
--    receipt was recorded and nothing acted on it. Now a final receipt with a
--    permanent carrier code (30004 blocked by the handset, 30005 unknown or
--    blocked, 30006 landline / unreachable carrier, 21211 invalid, 21610
--    STOP, 21614 not a mobile) suppresses the number (a sha256 of its digits,
--    never the number), removes it from profiles and from every notice list,
--    drops any pending verification code for it and blanks the receipt's own
--    to_number. Notice lists refuse to store a suppressed number again. A
--    later 'delivered' receipt to the same digits lifts the suppression (the
--    player fixed their line and verified it themselves). The two numbers of
--    2026-11-05 go through that same trigger below; nothing is hand-deleted.
--
-- 2. THE OTP SEND LOG CARRIES TWILIO'S MESSAGE ID. Verification codes were
--    sent with no delivery callback, so a code the carrier dropped read as
--    "sent" (2026-11-06 00:44, a new player asked for a code 42 seconds after
--    signing up and never received a delivery answer). The World Hub route now
--    asks for the callback and writes the sid here, so every code has a
--    receipt in sms_delivery_receipts and the trigger above covers it.
--
-- 3. ONE ALERT IS ONE TYPE. The digest's "critical alert types new this week
--    or doubled" counted the financial_alerts: and drift_incident: mirror rows
--    of an alert as separate types: 2026-11-05 said 10 where there were 6
--    (Tournament.atomic_finish_refused and
--    fn_ca_tournament_finished_but_not_completed each counted three times). A
--    mirror is left out whenever its base alert is in the same day's counts.
--    Each listed type keeps its own exact count and its own original event
--    ids, so the digest's linkage proof is unchanged.
--
-- 4. THE ESCROW SHADOW READS THE GUARANTEE PROMO EXCESS RETURN.
--    20261105225426 returns promo funding above max(0, G - C) to the Midway
--    promo wallet at guarantee finalization (one 'reversal' leg out of
--    prize_liability, kind guarantee_promo_excess_return). The maintained
--    escrow moved it; the shadow (fn_ca_tournament_escrow_chips) never read
--    it, so Morning Free Buy (NLH) f4793b0d (guarantee 250, players paid 351,
--    189 promo returned, every prize paid) opened a 189 chip "drift". The
--    shadow nets that leg from the promo entry money (never from bounty).
--
-- 5. A RECOVERED SCHEDULED JOB CLOSES ITS OWN INCIDENT. fn_ca_cron_failure_watch
--    opens an incident for a failing cron job but nothing ever closed one:
--    three were open past deadline for jobs that had succeeded every run for a
--    day (ca-engine-release-stall-check-hourly since 2026-11-02,
--    sp_prune_hand_history_10m, horse-daily-audit-fallback). The watch now
--    records each completed run in ca_detector_runs and joins the
--    re-measurement closer (fn_ca_resolve_cleared_incidents), which closes an
--    incident only when the same detector ran past it without raising it
--    again ('verified_remeasured', never by age).
--
-- 6. FOUR OVERDUE INCIDENTS WHOSE CONDITION IS MEASURED GONE ARE CLOSED, EACH
--    BY ITS OWN PREDICATE, CHECKED IN THIS TRANSACTION (any predicate false =>
--    that incident stays open):
--      f4793b0d escrow drift      : maintained escrow = corrected shadow = 0
--      c41182ee satellite refusal : COMPLETED, 12 ticket awards delivered,
--                                   escrow = shadow = 0
--      ffaa23eb finish outcome    : COMPLETED, winner credited its prize,
--                                   escrow = shadow = 0
--      tournament_dark storm cap  : 0 unresolved of every
--                                   GameServer.tournament_dark_after_rebuild
--                                   alert, no RUNNING tournament older than 12h
--    No chips move anywhere in this file.
--
-- @live-proof: to_regprocedure('public.fn_sms_number_is_suppressed(text)') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sms_receipt_suppresses_refused_number') AND position('guarantee_promo_excess_return' IN pg_get_functiondef('public.fn_ca_tournament_escrow_chips(uuid)'::regprocedure)) > 0 AND position('fn_ca_cron_failure_watch' IN pg_get_functiondef('public.fn_ca_resolve_cleared_incidents()'::regprocedure)) > 0 AND position('mirror of an alert' IN pg_get_functiondef('public.fn_sp_digest_attention(date,jsonb)'::regprocedure)) > 0

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fn_sp_digest_attention(date,jsonb)'::regprocedure)) IS DISTINCT FROM '92d82cffd94f0d8a23f0710c97abebd7' THEN
    RAISE EXCEPTION 'ATTENTION_ROOTS_PREIMAGE_DRIFT fn_sp_digest_attention';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_tournament_escrow_chips(uuid)'::regprocedure)) IS DISTINCT FROM 'eca151b101661e01d75394639d9fd00c' THEN
    RAISE EXCEPTION 'ATTENTION_ROOTS_PREIMAGE_DRIFT fn_ca_tournament_escrow_chips';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_cron_failure_watch()'::regprocedure)) IS DISTINCT FROM 'f8657d84657bf72112cd07ae40798d73' THEN
    RAISE EXCEPTION 'ATTENTION_ROOTS_PREIMAGE_DRIFT fn_ca_cron_failure_watch';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_resolve_cleared_incidents()'::regprocedure)) IS DISTINCT FROM '0f95f1e1dcb54e77ea6ce04b4d98a08e' THEN
    RAISE EXCEPTION 'ATTENTION_ROOTS_PREIMAGE_DRIFT fn_ca_resolve_cleared_incidents';
  END IF;
END $guard$;

-- ── 1. Carrier-refused numbers ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS smarter_private.sms_suppressed_numbers (
  number_hash         text PRIMARY KEY CHECK (number_hash ~ '^[0-9a-f]{64}$'),
  error_code          integer NOT NULL,
  failures            integer NOT NULL DEFAULT 1 CHECK (failures >= 1),
  first_suppressed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at      timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON smarter_private.sms_suppressed_numbers FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE smarter_private.sms_suppressed_numbers IS
  'Numbers a carrier permanently refused, as sha256 of their E.164 digits only. Written by trg_sms_receipt_suppresses_refused_number; lifted by a delivered receipt.';

-- E.164 digits: a 10-digit number is a US number without its country code.
CREATE OR REPLACE FUNCTION public.fn_sms_e164_digits(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'pg_catalog'
AS $$
  SELECT CASE WHEN length(d) = 10 THEN '1' || d ELSE nullif(d, '') END
    FROM (SELECT regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') AS d) x
$$;

CREATE OR REPLACE FUNCTION public.fn_sms_number_hash(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'pg_catalog'
AS $$
  SELECT CASE WHEN public.fn_sms_e164_digits(p_phone) IS NULL THEN NULL
              ELSE encode(sha256(convert_to(public.fn_sms_e164_digits(p_phone), 'UTF8')), 'hex') END
$$;

CREATE OR REPLACE FUNCTION public.fn_sms_permanent_refusal(p_code integer)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'pg_catalog'
AS $$ SELECT coalesce(p_code = ANY (ARRAY[30004, 30005, 30006, 21211, 21610, 21614]), false) $$;

CREATE OR REPLACE FUNCTION public.fn_sms_number_is_suppressed(p_phone text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (SELECT 1 FROM smarter_private.sms_suppressed_numbers s
                  WHERE s.number_hash = public.fn_sms_number_hash(p_phone))
$$;
REVOKE ALL ON FUNCTION public.fn_sms_number_is_suppressed(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sms_number_is_suppressed(text) TO service_role;

-- Removes one number from every place the platform keeps a phone number.
CREATE OR REPLACE FUNCTION public.fn_sms_scrub_number(p_phone text, p_except_sid text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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
  -- Older receipts to the same number keep their status and code, not the number.
  UPDATE public.sms_delivery_receipts SET to_number = NULL
   WHERE to_number IS NOT NULL AND public.fn_sms_e164_digits(to_number) = d
     -- The receipt whose own trigger is running is blanked through NEW.
     AND sid IS DISTINCT FROM p_except_sid;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.fn_sms_scrub_number(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_sms_receipt_suppresses_refused_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE h text;
BEGIN
  IF NEW.to_number IS NULL THEN RETURN NEW; END IF;
  h := public.fn_sms_number_hash(NEW.to_number);
  IF h IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IN ('undelivered', 'failed') AND public.fn_sms_permanent_refusal(NEW.error_code) THEN
    INSERT INTO smarter_private.sms_suppressed_numbers AS s (number_hash, error_code)
    VALUES (h, NEW.error_code)
    ON CONFLICT (number_hash) DO UPDATE
       SET failures = s.failures + 1, error_code = EXCLUDED.error_code, last_failed_at = now();
    PERFORM public.fn_sms_scrub_number(NEW.to_number, NEW.sid);
    NEW.to_number := NULL;
  ELSIF NEW.status = 'delivered' THEN
    DELETE FROM smarter_private.sms_suppressed_numbers WHERE number_hash = h;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_sms_receipt_suppresses_refused_number() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sms_receipt_suppresses_refused_number ON public.sms_delivery_receipts;
CREATE TRIGGER trg_sms_receipt_suppresses_refused_number
  BEFORE INSERT OR UPDATE ON public.sms_delivery_receipts
  FOR EACH ROW EXECUTE FUNCTION public.fn_sms_receipt_suppresses_refused_number();

-- A notice list never stores a number the carrier refused.
CREATE OR REPLACE FUNCTION public.fn_sms_notice_row_drops_suppressed_phone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.phone IS NOT NULL AND public.fn_sms_number_is_suppressed(NEW.phone) THEN
    NEW.phone := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_sms_notice_row_drops_suppressed_phone() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_relaunch_award_drops_suppressed_phone ON public.sp_relaunch_awards;
CREATE TRIGGER trg_relaunch_award_drops_suppressed_phone
  BEFORE INSERT OR UPDATE OF phone ON public.sp_relaunch_awards
  FOR EACH ROW EXECUTE FUNCTION public.fn_sms_notice_row_drops_suppressed_phone();
DROP TRIGGER IF EXISTS trg_announcement_recipient_drops_suppressed_phone ON public.sp_player_announcement_recipients;
CREATE TRIGGER trg_announcement_recipient_drops_suppressed_phone
  BEFORE INSERT OR UPDATE OF phone ON public.sp_player_announcement_recipients
  FOR EACH ROW EXECUTE FUNCTION public.fn_sms_notice_row_drops_suppressed_phone();
DROP TRIGGER IF EXISTS trg_welcome_back_award_drops_suppressed_phone ON public.sp_signup_welcome_back_awards;
CREATE TRIGGER trg_welcome_back_award_drops_suppressed_phone
  BEFORE INSERT OR UPDATE OF phone ON public.sp_signup_welcome_back_awards
  FOR EACH ROW EXECUTE FUNCTION public.fn_sms_notice_row_drops_suppressed_phone();

-- The two 30005 numbers of 2026-11-05 go through the same trigger.
UPDATE public.sms_delivery_receipts
   SET updated_at = updated_at
 WHERE to_number IS NOT NULL
   AND status IN ('undelivered', 'failed')
   AND public.fn_sms_permanent_refusal(error_code);

DO $verify_sms$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sms_delivery_receipts
              WHERE to_number IS NOT NULL AND status IN ('undelivered','failed')
                AND public.fn_sms_permanent_refusal(error_code)) THEN
    RAISE EXCEPTION 'ATTENTION_ROOTS_SMS a refused number is still on a receipt';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p
              WHERE p.phone IS NOT NULL AND public.fn_sms_number_is_suppressed(p.phone)) THEN
    RAISE EXCEPTION 'ATTENTION_ROOTS_SMS a refused number is still on a profile';
  END IF;
END $verify_sms$;

-- ── 2. OTP send log carries the message id ─────────────────────────────────
ALTER TABLE public.sms_otp_send_log ADD COLUMN IF NOT EXISTS twilio_sid text;
COMMENT ON COLUMN public.sms_otp_send_log.twilio_sid IS
  'Twilio message id of the code; its carrier result is sms_delivery_receipts.sid.';

-- ── 3. A mirror of an alert is not a second alert type ─────────────────────
DO $digest$
DECLARE b text; old text; replacement text;
BEGIN
  SELECT pg_get_functiondef('public.fn_sp_digest_attention(date,jsonb)'::regprocedure) INTO b;
  old := E'       WHERE seen.alertname IS NULL\n          OR (cur.value::numeric >= 10 AND cur.value::numeric >= 2 * COALESCE(pd.prior,0))\n';
  replacement := E'       WHERE (seen.alertname IS NULL\n          OR (cur.value::numeric >= 10 AND cur.value::numeric >= 2 * COALESCE(pd.prior,0)))\n'
              || E'         -- A financial_alerts: or drift_incident: row is a mirror of an alert\n'
              || E'         -- already counted under its own name that day (2026-11-06: 10 types\n'
              || E'         -- were really 6). The base keeps its exact count and event ids.\n'
              || E'         AND NOT (cur.key ~ ''^(drift_incident:|financial_alerts:)''\n'
              || E'                  AND COALESCE(p_metrics#>''{health,alert_names}'',''{}''::jsonb)\n'
              || E'                      ? regexp_replace(cur.key, ''^(drift_incident:)?(financial_alerts:)?'', ''''))\n';
  IF (length(b) - length(replace(b, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'ATTENTION_ROOTS_PREIMAGE_DRIFT fn_sp_digest_attention anchor';
  END IF;
  EXECUTE replace(b, old, replacement);
END $digest$;

-- ── 4. The shadow reads the guarantee promo excess return ──────────────────
DO $shadow$
DECLARE b text; a1 text; r1 text; a2 text; r2 text;
BEGIN
  SELECT pg_get_functiondef('public.fn_ca_tournament_escrow_chips(uuid)'::regprocedure) INTO b;
  a1 := E'*coalesce((l.metadata->>''bounty_part'')::numeric,l.amount)),0) AS bounty';
  r1 := E'*coalesce((l.metadata->>''bounty_part'')::numeric,\n             CASE WHEN l.metadata->>''kind''=''guarantee_promo_excess_return'' THEN 0 ELSE l.amount END)),0) AS bounty';
  a2 := E'    AND l.metadata->>''kind''=''midway_free_buy_promo_head''\n    AND l.category IN (''promo_send'',''reversal'')';
  r2 := E'    AND ((l.metadata->>''kind''=''midway_free_buy_promo_head''\n          AND l.category IN (''promo_send'',''reversal''))\n'
     || E'      -- 20261105225426 returns promo above max(0, G - C) at finalization.\n'
     || E'      OR (l.metadata->>''kind''=''guarantee_promo_excess_return''\n'
     || E'          AND l.category=''reversal'' AND l.from_type=''prize_liability''\n'
     || E'          AND l.from_entity_id=p_tournament_id))';
  IF (length(b) - length(replace(b, a1, ''))) / length(a1) <> 1
     OR (length(b) - length(replace(b, a2, ''))) / length(a2) <> 1 THEN
    RAISE EXCEPTION 'ATTENTION_ROOTS_PREIMAGE_DRIFT fn_ca_tournament_escrow_chips anchors';
  END IF;
  EXECUTE replace(replace(b, a1, r1), a2, r2);
END $shadow$;

-- ── 5. The cron watch records its runs and joins the re-measurement closer ─
DO $cron$
DECLARE b text; old text; replacement text;
BEGIN
  SELECT pg_get_functiondef('public.fn_ca_cron_failure_watch()'::regprocedure) INTO b;
  old := E'  RETURN n;\nEND';
  replacement := E'  -- A completed run is a re-measurement fn_ca_resolve_cleared_incidents reads.\n'
              || E'  INSERT INTO public.ca_detector_runs (detector, detail)\n'
              || E'  VALUES (''fn_ca_cron_failure_watch'', jsonb_build_object(''raised'', n));\n'
              || E'  RETURN n;\nEND';
  IF (length(b) - length(replace(b, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'ATTENTION_ROOTS_PREIMAGE_DRIFT fn_ca_cron_failure_watch anchor';
  END IF;
  EXECUTE replace(b, old, replacement);

  SELECT pg_get_functiondef('public.fn_ca_resolve_cleared_incidents()'::regprocedure) INTO b;
  old := E'ARRAY[''fn_ca_conservation_sweep'',''fn_ca_ratchet_watch'',''fn_bbj_reconcile'',''fn_ca_money_rpc_drift'']';
  replacement := E'ARRAY[''fn_ca_conservation_sweep'',''fn_ca_ratchet_watch'',''fn_bbj_reconcile'',''fn_ca_money_rpc_drift'',''fn_ca_cron_failure_watch'']';
  IF (length(b) - length(replace(b, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'ATTENTION_ROOTS_PREIMAGE_DRIFT fn_ca_resolve_cleared_incidents anchor';
  END IF;
  EXECUTE replace(b, old, replacement);
END $cron$;

-- ── 6. Overdue incidents whose condition is measured gone ──────────────────
DO $close$
DECLARE
  v_actor constant uuid := '2d1cd6c3-5700-4af9-a271-d4863fdab20d';
  e record; s record; ok boolean;
BEGIN
  -- Morning Free Buy (NLH): the corrected shadow agrees with the escrow.
  SELECT * INTO e FROM public.tournament_escrow WHERE tournament_id = 'f4793b0d-d51e-4a7a-82bc-1c822993eece';
  SELECT * INTO s FROM public.fn_ca_tournament_escrow('f4793b0d-d51e-4a7a-82bc-1c822993eece');
  ok := e.tournament_id IS NOT NULL
        AND abs(e.prize_balance - (s.prize_balance - e.reserve_out + e.reserve_in)) <= 0.01
        AND abs(e.bounty_balance - s.bounty_balance) <= 0.01 AND abs(e.fee_balance - s.fee_balance) <= 0.01;
  IF ok THEN
    UPDATE public.ca_drift_incidents SET status = 'resolved', closure_basis = 'verified_remeasured',
           resolved_at = now(), resolved_by = v_actor,
           root_cause = 'the escrow shadow did not read the guarantee promo excess return of 20261105225426 (189 promo chips above the 250 guarantee, which players covered with 351)',
           correction_ref = 'verified: 20261106203917 shadow reads guarantee_promo_excess_return; escrow and shadow both 0',
           resolution = 'no chips moved. Every prize was paid (29 payouts, 351); the promo excess went back to the Midway promo wallet by design.'
     WHERE id = '3a229ba8-10a2-4d90-9a97-314cb6e20df7' AND resolved_at IS NULL;
  END IF;

  -- Prime Time Satellite 5: completed, all twelve seats delivered.
  SELECT * INTO e FROM public.tournament_escrow WHERE tournament_id = 'c41182ee-6e7a-453f-870d-57167a124bbd';
  SELECT * INTO s FROM public.fn_ca_tournament_escrow('c41182ee-6e7a-453f-870d-57167a124bbd');
  ok := EXISTS (SELECT 1 FROM public.tournaments WHERE id = 'c41182ee-6e7a-453f-870d-57167a124bbd' AND status = 'COMPLETED')
        AND (SELECT count(*) FROM public.tournament_satellite_awards WHERE tournament_id = 'c41182ee-6e7a-453f-870d-57167a124bbd') = 12
        AND e.prize_balance = 0 AND e.bounty_balance = 0 AND e.fee_balance = 0
        AND s.prize_balance = 0 AND s.bounty_balance = 0 AND s.fee_balance = 0;
  IF ok THEN
    UPDATE public.ca_drift_incidents SET status = 'resolved', closure_basis = 'verified_remeasured',
           resolved_at = now(), resolved_by = v_actor,
           root_cause = 'the satellite settled against a stale field count (fixed by 20261106113500 satellite_settlement_uses_the_running_live_field_count)',
           correction_ref = 'verified: tournament COMPLETED, 12 of 12 ticket awards delivered, escrow and shadow 0',
           resolution = 'no chips moved here; the refused delivery retried and landed.'
     WHERE id = '1b9254ba-7092-48ad-a080-56f43d729d21' AND resolved_at IS NULL;
    UPDATE public.financial_alerts SET resolved = true, resolved_at = now()
     WHERE id = '72de2467-5d43-44a9-bc25-dc078800d94e' AND NOT resolved;
  END IF;

  -- NLH Heads-Up 5 Turbo: the finish whose reply was lost had committed.
  SELECT * INTO e FROM public.tournament_escrow WHERE tournament_id = 'ffaa23eb-8af5-40f2-8338-adb2722897e1';
  SELECT * INTO s FROM public.fn_ca_tournament_escrow('ffaa23eb-8af5-40f2-8338-adb2722897e1');
  ok := EXISTS (SELECT 1 FROM public.tournaments WHERE id = 'ffaa23eb-8af5-40f2-8338-adb2722897e1' AND status = 'COMPLETED')
        AND EXISTS (SELECT 1 FROM public.wallet_transactions
                     WHERE related_entity_id = 'ffaa23eb-8af5-40f2-8338-adb2722897e1' AND category = 'prize'
                       AND type = 'credit' AND user_id = '67031c9c-6286-49d6-b00b-893737522f3b')
        AND e.prize_balance = 0 AND e.bounty_balance = 0 AND e.fee_balance = 0
        AND s.prize_balance = 0 AND s.bounty_balance = 0 AND s.fee_balance = 0;
  IF ok THEN
    UPDATE public.ca_drift_incidents SET status = 'resolved', closure_basis = 'verified_remeasured',
           resolved_at = now(), resolved_by = v_actor,
           root_cause = 'the atomic finish committed but its reply was lost, so the engine recorded the outcome as unknown',
           correction_ref = 'verified: tournament COMPLETED, winner credited its prize, escrow and shadow 0',
           resolution = 'no chips moved; the original finish is the settlement.'
     WHERE id = '3fd6be90-a3d9-42d4-8ad2-d7cd3fe28bd5' AND resolved_at IS NULL;
    UPDATE public.financial_alerts SET resolved = true, resolved_at = now()
     WHERE id = '6b85e6ab-3bd2-4436-bb04-6abd2cad3892' AND NOT resolved;
  END IF;

  -- Tournament-dark storm cap of 2026-10-30.
  ok := NOT EXISTS (SELECT 1 FROM public.financial_alerts
                     WHERE source = 'GameServer.tournament_dark_after_rebuild' AND NOT resolved)
        AND NOT EXISTS (SELECT 1 FROM public.tournaments
                         WHERE status = 'RUNNING' AND started_at < now() - interval '12 hours');
  IF ok THEN
    UPDATE public.ca_drift_incidents SET status = 'resolved', closure_basis = 'verified_remeasured',
           resolved_at = now(), resolved_by = v_actor,
           root_cause = 'storm cap over GameServer.tournament_dark_after_rebuild alerts of 2026-10-30',
           correction_ref = 'verified: every tournament_dark_after_rebuild alert is resolved and no tournament has run past 12 hours',
           resolution = 'no chips moved; each capped alert was settled by its own resolver.'
     WHERE id = '8f93292b-4409-4e98-a93c-6f9e6e1cc3a5' AND resolved_at IS NULL;
  END IF;
END $close$;

COMMIT;
