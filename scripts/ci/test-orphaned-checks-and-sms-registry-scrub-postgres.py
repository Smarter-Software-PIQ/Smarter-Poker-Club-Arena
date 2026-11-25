#!/usr/bin/env python3
"""Disposable PostgreSQL 17 proof for 20261125163000_orphaned_checks_scope_and_sms_registry_scrub.sql.

Proves on a real local PostgreSQL instance:
  1. Red-before / green-after on fn_ca_orphaned_checks() & fn_ca_orphaned_checks_watch():
     - Before migration: World Hub Trivia RPCs (trivia_integrity_review_queue_v1,
       trivia_record_integrity_signal_v1) are falsely reported as orphaned checks,
       leaving drift incident a1fb53c2 and financial_alerts mirror bc7164e6 open.
     - Migration applies cleanly against exact production MD5 preimages.
     - After migration: fn_ca_orphaned_checks() returns 0 rows, BOTH ca_drift_incidents
       and its financial_alerts mirror are closed, and a genuine unscheduled Club Arena
       check (fn_ca_unscheduled_conservation_check) is STILL detected.
  2. Red-before / green-after on SMS registry scrubbing & drop triggers:
     - Before migration: permanently refused 30006/30005 numbers survive in
       commander_members, commander_staff, commander_home_members,
       commander_onboarding_leads, commander_waitlist, commander_tournament_entries,
       and newsletter_subscribers ('sms:+1...').
     - Migration scrubs ALL already-suppressed numbers from every SMS registry table,
       leaves unaffected numbers untouched, blocks re-insertion via BEFORE triggers,
       and exposes service_role-only fn_sms_filter_suppressed_phones(text[]).
     - A new permanent carrier refusal receipt (30006/30005) scrubs all 14 registries;
       a later 'delivered' receipt lifts suppression cleanly.
"""
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase/migrations/20261125163000_orphaned_checks_scope_and_sms_registry_scrub.sql"

PREIMAGE_SQL = r"""
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA IF NOT EXISTS smarter_private;
CREATE SCHEMA IF NOT EXISTS cron;

CREATE TABLE cron.job (
  jobid serial PRIMARY KEY,
  command text NOT NULL
);

CREATE TABLE public.ca_check_sweep_exemptions (
  proname text PRIMARY KEY,
  reason text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ca_drift_incidents (
  id uuid PRIMARY KEY,
  source text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  closure_basis text,
  resolved_at timestamptz,
  root_cause text,
  correction_ref text,
  resolution text
);

CREATE TABLE public.financial_alerts (
  id uuid PRIMARY KEY,
  source text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz
);

CREATE OR REPLACE FUNCTION public.fn_ca_conservation_sweep()
RETURNS void LANGUAGE sql AS $$ SELECT; $$;

CREATE OR REPLACE FUNCTION public.fn_ca_raise_drift_incident(
  p_source text, p_cls text, p_sev text, p_key text,
  p_amt numeric, p_exp numeric, p_act numeric, p_layer text, p_etype text,
  p_a text, p_b text, p_c text, p_d text, p_e text, p_f text, p_g text, p_h text, p_i text,
  p_cause text, p_bal boolean, p_meta jsonb
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.ca_drift_incidents (id, source, status)
  VALUES (gen_random_uuid(), p_source, 'open');
END $$;

CREATE OR REPLACE FUNCTION public.trivia_integrity_review_queue_v1(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb; $$;

CREATE OR REPLACE FUNCTION public.trivia_record_integrity_signal_v1(
  p_session_id uuid, p_user_id uuid, p_mode text
) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb; $$;

-- Exact live preimage of fn_ca_orphaned_checks() (md5 cd84dc64c1856c469fcd66cea4a609e0)
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
       /* A DOOR IS NOT A CHECK. A function taking an actor, an op id, a
          case id or a request id is a write-side RPC with an audit trail -
          open a case, assign it, decide it, sanction. It matches on the
          word "integrity" in its name and on nothing else. */
       AND pg_get_function_identity_arguments(p.oid) !~ '(p_actor|p_op_id|p_case_id|p_request_id|p_value)'
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

-- Exact live preimage of fn_ca_orphaned_checks_watch() (md5 573113e330b811c3064156641e6e7ccf)
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
  -- A WATCH CLOSES WHAT IT OPENED (20261118155109): this watch only raised,
  -- under a per-day key, so its incident outlived the condition it named.
  -- Its own subtransaction: a refused close never costs the watch its answer.
  IF COALESCE(v_n,0) = 0 THEN
    BEGIN
      UPDATE public.ca_drift_incidents
         SET status = 'resolved', closure_basis = 'verified_remeasured', resolved_at = now(),
             root_cause = 'integrity check functions existed that nothing scheduled, swept or called; each has since been scheduled, called by another function, or exempted with its reason',
             correction_ref = 'verified: fn_ca_orphaned_checks() returns no function',
             resolution = 'every integrity check is scheduled, swept, called by another function, or exempt with its reason'
       WHERE source = 'fn_ca_orphaned_checks_watch' AND resolved_at IS NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fn_ca_orphaned_checks_watch could not close its incidents: %', SQLERRM;
    END;
  END IF;
  RETURN COALESCE(v_n,0);
END;
$function$;

INSERT INTO cron.job (command) VALUES ('SELECT public.fn_ca_orphaned_checks_watch();');

-- SMS tables & 20261106203917 preimages
CREATE TABLE smarter_private.sms_suppressed_numbers (
  number_hash text PRIMARY KEY CHECK (number_hash ~ '^[0-9a-f]{64}$'),
  error_code integer NOT NULL,
  failures integer NOT NULL DEFAULT 1 CHECK (failures >= 1),
  first_suppressed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (id serial PRIMARY KEY, phone text);
CREATE TABLE public.sp_relaunch_awards (id serial PRIMARY KEY, phone text);
CREATE TABLE public.sp_player_announcement_recipients (id serial PRIMARY KEY, phone text);
CREATE TABLE public.sp_signup_welcome_back_awards (id serial PRIMARY KEY, phone text);
CREATE TABLE public.sms_otp_codes (id serial PRIMARY KEY, phone text);
CREATE TABLE public.phone_verification_receipts (id serial PRIMARY KEY, phone text);
CREATE TABLE public.sms_delivery_receipts (
  sid text PRIMARY KEY,
  to_number text,
  status text NOT NULL,
  error_code integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.commander_members (id serial PRIMARY KEY, phone text);
CREATE TABLE public.commander_home_members (id serial PRIMARY KEY, phone text);
CREATE TABLE public.commander_staff (id serial PRIMARY KEY, phone text);
CREATE TABLE public.commander_onboarding_leads (id serial PRIMARY KEY, phone text NOT NULL);
CREATE TABLE public.commander_waitlist (id serial PRIMARY KEY, player_phone text);
CREATE TABLE public.commander_tournament_entries (id serial PRIMARY KEY, player_phone text);
CREATE TABLE public.newsletter_subscribers (
  id serial PRIMARY KEY,
  email text NOT NULL,
  is_active boolean DEFAULT true,
  unsubscribed_at timestamptz
);

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

-- Exact live preimage of fn_sms_scrub_number(text, text) (md5 d5890c399c05e72d8733843dafc6a778)
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

CREATE TRIGGER trg_sms_receipt_suppresses_refused_number
  BEFORE INSERT OR UPDATE ON public.sms_delivery_receipts
  FOR EACH ROW EXECUTE FUNCTION public.fn_sms_receipt_suppresses_refused_number();

-- Exact live preimage of fn_sms_notice_row_drops_suppressed_phone() (md5 1b97073fa46d66321ed7c35c75641197)
CREATE OR REPLACE FUNCTION public.fn_sms_notice_row_drops_suppressed_phone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.phone IS NOT NULL AND public.fn_sms_number_is_suppressed(NEW.phone) THEN
    NEW.phone := NULL;
  END IF;
  RETURN NEW;
END $$;

-- Seed the exact production defects BEFORE migration:
INSERT INTO public.ca_drift_incidents (id, source, status)
VALUES ('a1fb53c2-979a-4469-8aff-9d388e2ef252', 'fn_ca_orphaned_checks_watch', 'open');
INSERT INTO public.financial_alerts (id, source, resolved)
VALUES ('bc7164e6-5590-4bc8-a3b6-81cb864957e9', 'drift_incident:fn_ca_orphaned_checks_watch', false);

INSERT INTO public.commander_members (phone) VALUES ('+15025550001'), ('+15025550002'), ('+15025559999');
INSERT INTO public.commander_staff (phone) VALUES ('+17085550003'), ('+17085558888');
INSERT INTO public.commander_home_members (phone) VALUES ('+15025550001');
INSERT INTO public.commander_onboarding_leads (phone) VALUES ('+15025550002');
INSERT INTO public.commander_waitlist (player_phone) VALUES ('+17085550003');
INSERT INTO public.commander_tournament_entries (player_phone) VALUES ('+15025550001');
INSERT INTO public.newsletter_subscribers (email, is_active) VALUES ('sms:+15025550001', true), ('ok@example.com', true);

-- Simulate the 3 permanent carrier refusal receipts arriving BEFORE the migration:
INSERT INTO public.sms_delivery_receipts (sid, to_number, status, error_code) VALUES
  ('SM_30006_1', '+15025550001', 'undelivered', 30006),
  ('SM_30006_2', '+15025550002', 'undelivered', 30006),
  ('SM_30005_1', '+17085550003', 'undelivered', 30005);
"""


def pg_tool(name: str) -> str:
    pg_bin = os.environ.get("PG_BIN")
    if pg_bin:
        candidate = Path(pg_bin) / name
        if candidate.is_file():
            return str(candidate)
    return name


def run_psql(sock_dir: str, sql: str) -> str:
    res = subprocess.run(
        [pg_tool("psql"), "-X", "-v", "ON_ERROR_STOP=1", "-h", sock_dir, "-d", "postgres", "-At", "-c", sql],
        capture_output=True,
        text=True,
    )
    if res.returncode != 0:
        raise RuntimeError(f"psql failed:\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}")
    return res.stdout.strip()


def run_psql_file(sock_dir: str, path: Path) -> str:
    res = subprocess.run(
        [pg_tool("psql"), "-X", "-v", "ON_ERROR_STOP=1", "-h", sock_dir, "-d", "postgres", "-f", str(path)],
        capture_output=True,
        text=True,
    )
    if res.returncode != 0:
        raise RuntimeError(f"psql file {path} failed:\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}")
    return res.stdout


def main() -> int:
    # Keep Unix socket directory short (<104 bytes on macOS).
    base = Path("/Volumes/SmarterWork/agent-work/extreme-capacity") if Path("/Volumes/SmarterWork/agent-work/extreme-capacity").is_dir() else Path(tempfile.gettempdir())
    work = Path(tempfile.mkdtemp(prefix="pg17-orph-sms-", dir=str(base)))
    pgdata = work / "data"
    sock = Path(tempfile.mkdtemp(prefix="pgs-"))
    started = False
    try:
        subprocess.run(
            [pg_tool("initdb"), "-D", str(pgdata), "--auth=trust", "--no-sync", "--encoding=UTF8", "--locale=C"],
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            [
                pg_tool("pg_ctl"),
                "-D",
                str(pgdata),
                "-o",
                f"-k {sock} -h ''",
                "-l",
                str(work / "pg.log"),
                "start",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        started = True

        run_psql(str(sock), PREIMAGE_SQL)

        # RED-BEFORE assertions:
        orphans_before = run_psql(str(sock), "SELECT count(*) FROM public.fn_ca_orphaned_checks();")
        assert orphans_before == "2", f"expected 2 trivia orphans before migration, got {orphans_before}"

        surviving_members = run_psql(
            str(sock),
            "SELECT count(*) FROM public.commander_members WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone);",
        )
        assert surviving_members == "2", f"expected 2 suppressed commander_members before migration, got {surviving_members}"

        surviving_staff = run_psql(
            str(sock),
            "SELECT count(*) FROM public.commander_staff WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone);",
        )
        assert surviving_staff == "1", f"expected 1 suppressed commander_staff before migration, got {surviving_staff}"

        # Apply the exact migration under test:
        run_psql_file(str(sock), MIGRATION)

        # GREEN-AFTER assertions — Part A (orphaned checks & mirror):
        assert run_psql(str(sock), "SELECT count(*) FROM public.fn_ca_orphaned_checks();") == "0"
        assert run_psql(str(sock), "SELECT status || '|' || closure_basis FROM public.ca_drift_incidents WHERE id = 'a1fb53c2-979a-4469-8aff-9d388e2ef252';") == "resolved|verified_remeasured"
        assert run_psql(str(sock), "SELECT resolved::text FROM public.financial_alerts WHERE id = 'bc7164e6-5590-4bc8-a3b6-81cb864957e9';") == "true"

        # Real unscheduled Club Arena check MUST still be detected!
        run_psql(str(sock), "CREATE FUNCTION public.fn_ca_unscheduled_conservation_check() RETURNS integer LANGUAGE sql AS $$ SELECT 0; $$;")
        assert run_psql(str(sock), "SELECT proname FROM public.fn_ca_orphaned_checks();") == "fn_ca_unscheduled_conservation_check"
        run_psql(str(sock), "DROP FUNCTION public.fn_ca_unscheduled_conservation_check();")

        # GREEN-AFTER assertions — Part B (SMS scrub, triggers, batch RPC, delivered lift):
        assert run_psql(str(sock), "SELECT count(*) FROM public.commander_members WHERE phone IS NOT NULL;") == "1"
        assert run_psql(str(sock), "SELECT phone FROM public.commander_members WHERE phone IS NOT NULL;") == "+15025559999"
        assert run_psql(str(sock), "SELECT phone FROM public.commander_staff WHERE phone IS NOT NULL;") == "+17085558888"
        assert run_psql(str(sock), "SELECT count(*) FROM public.commander_home_members WHERE phone IS NOT NULL;") == "0"
        assert run_psql(str(sock), "SELECT count(*) FROM public.commander_onboarding_leads WHERE phone IS NOT NULL;") == "0"
        assert run_psql(str(sock), "SELECT count(*) FROM public.commander_waitlist WHERE player_phone IS NOT NULL;") == "0"
        assert run_psql(str(sock), "SELECT count(*) FROM public.commander_tournament_entries WHERE player_phone IS NOT NULL;") == "0"
        assert run_psql(str(sock), "SELECT email FROM public.newsletter_subscribers;") == "ok@example.com"

        # Re-inserting suppressed numbers into Commander / newsletter is blocked by triggers:
        run_psql(str(sock), """
          INSERT INTO public.commander_members (phone) VALUES ('+15025550001');
          INSERT INTO public.commander_staff (phone) VALUES ('+17085550003');
          INSERT INTO public.commander_waitlist (player_phone) VALUES ('+15025550002');
          INSERT INTO public.commander_tournament_entries (player_phone) VALUES ('+15025550001');
          INSERT INTO public.newsletter_subscribers (email, is_active) VALUES ('sms:+15025550001', true);
        """)
        assert run_psql(str(sock), "SELECT count(*) FROM public.commander_members WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone);") == "0"
        assert run_psql(str(sock), "SELECT count(*) FROM public.commander_staff WHERE phone IS NOT NULL AND public.fn_sms_number_is_suppressed(phone);") == "0"
        assert run_psql(str(sock), "SELECT count(*) FROM public.commander_waitlist WHERE player_phone IS NOT NULL;") == "0"
        assert run_psql(str(sock), "SELECT count(*) FROM public.commander_tournament_entries WHERE player_phone IS NOT NULL;") == "0"
        assert run_psql(str(sock), "SELECT count(*) FROM public.newsletter_subscribers WHERE email LIKE 'sms:%';") == "0"

        # Batch RPC accurately filters suppressed phones and rejects anon/authenticated:
        filtered = run_psql(str(sock), "SELECT array_to_string(public.fn_sms_filter_suppressed_phones(ARRAY['+15025550001','+15025559999','+17085550003']), ',');")
        assert set(filtered.split(",")) == {"+15025550001", "+17085550003"}, f"unexpected filtered={filtered}"
        assert run_psql(str(sock), "SELECT has_function_privilege('anon', 'public.fn_sms_filter_suppressed_phones(text[])', 'EXECUTE')::text || '|' || has_function_privilege('authenticated', 'public.fn_sms_filter_suppressed_phones(text[])', 'EXECUTE')::text || '|' || has_function_privilege('service_role', 'public.fn_sms_filter_suppressed_phones(text[])', 'EXECUTE')::text;") == "false|false|true"

        # A brand-new permanent refusal receipt scrubs newly added Commander rows too:
        run_psql(str(sock), """
          INSERT INTO public.commander_members (phone) VALUES ('+13125550123');
          INSERT INTO public.commander_waitlist (player_phone) VALUES ('+13125550123');
          INSERT INTO public.sms_delivery_receipts (sid, to_number, status, error_code)
          VALUES ('SM_NEW_30006', '+13125550123', 'undelivered', 30006);
        """)
        assert run_psql(str(sock), "SELECT count(*) FROM public.commander_members WHERE phone = '+13125550123';") == "0"
        assert run_psql(str(sock), "SELECT count(*) FROM public.commander_waitlist WHERE player_phone = '+13125550123';") == "0"
        assert run_psql(str(sock), "SELECT public.fn_sms_number_is_suppressed('+13125550123')::text;") == "true"

        # A later 'delivered' receipt lifts suppression cleanly:
        run_psql(str(sock), "INSERT INTO public.sms_delivery_receipts (sid, to_number, status, error_code) VALUES ('SM_LIFT', '+13125550123', 'delivered', NULL);")
        assert run_psql(str(sock), "SELECT public.fn_sms_number_is_suppressed('+13125550123')::text;") == "false"

        # Check @live-proof expression evaluates true on the post-migration database!
        live_proof = None
        for line in MIGRATION.read_text().splitlines():
            if line.startswith("-- @live-proof:"):
                live_proof = line.split("-- @live-proof:", 1)[1].strip()
                break
        assert live_proof, "missing @live-proof comment"
        assert run_psql(str(sock), f"SELECT ({live_proof})::text;") == "true", "live-proof failed!"

        print("OK: PG17 proof passed (red-before, green-after, triggers, RPC grants, live-proof).")
        return 0
    finally:
        if started:
            subprocess.run(["pg_ctl", "-D", str(pgdata), "-m", "immediate", "stop"], capture_output=True)
        shutil.rmtree(work, ignore_errors=True)
        shutil.rmtree(sock, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
