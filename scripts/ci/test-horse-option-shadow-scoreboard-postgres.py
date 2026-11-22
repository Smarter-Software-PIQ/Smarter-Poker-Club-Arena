#!/usr/bin/env python3
"""Native proof for MIGRATION_FILE (the daily digest carries the Horse option shadow scoreboard).

Throwaway PostgreSQL 17 cluster, never production: a stub fn_sp_daily_digest holding the real 'felt_latency' anchor
line, the migration installed twice (idempotent), fixture counters, then the digest line is read back.
Run: PG_BIN=/usr/lib/postgresql/17/bin python3 -B scripts/ci/test-horse-option-shadow-scoreboard-postgres.py
"""
import glob, json, os, shutil, socket, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIGRATION = sorted(glob.glob(os.path.join(ROOT, "supabase/migrations/*_horse_option_shadow_scoreboard_in_the_daily_digest.sql")))[-1]
os.environ.setdefault("LC_ALL", "C")  # macOS: postmaster refuses to start without a valid locale
PG_BIN = os.environ.get("PG_BIN") or os.path.dirname(shutil.which("initdb") or "/usr/lib/postgresql/17/bin/initdb")

STUB = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.horse_brain_telemetry (day date, feature text, fires bigint, updated_at timestamptz DEFAULT now(), PRIMARY KEY (day, feature));
CREATE TABLE public.ca_horse_style_switch (option text PRIMARY KEY, state text, updated_by text, updated_at timestamptz, note text);
CREATE FUNCTION public.fn_sp_digest_engine_cutover(p_day date) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION public.fn_sp_digest_felt_latency(p_day date) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"kinds":[]}'::jsonb$$;
CREATE FUNCTION public.fn_sp_daily_digest(p_day date DEFAULT NULL, p_send boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE v_day date := coalesce(p_day, current_date);
BEGIN
  RETURN jsonb_build_object(
    'engine_cutover', public.fn_sp_digest_engine_cutover(v_day),
    'felt_latency', public.fn_sp_digest_felt_latency(v_day),
    'day', v_day);
END
$function$;
"""

def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

failures = []
def check(name, cond, info=""):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond: failures.append(name); print(info)

d = tempfile.mkdtemp(prefix="hos-pg-"); data = os.path.join(d, "data"); port = free_port()
subprocess.run([os.path.join(PG_BIN, "initdb"), "-D", data, "-U", "postgres", "-A", "trust", "--no-sync"], check=True, capture_output=True)
subprocess.run([os.path.join(PG_BIN, "pg_ctl"), "-D", data, "-o", f"-p {port} -k {d} -c listen_addresses=''", "-l", os.path.join(d, "log"), "-w", "start"], check=True, capture_output=True)
def psql(sql=None, f=None, ok=True):
    args = [os.path.join(PG_BIN, "psql"), "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", d, "-p", str(port), "-U", "postgres", "-d", "postgres"]
    args += ["-f", f] if f else ["-c", sql]
    r = subprocess.run(args, capture_output=True, text=True)
    if ok and r.returncode: raise SystemExit("psql failed: " + r.stderr[-800:])
    return r
try:
    psql(STUB)
    r = psql(f=MIGRATION, ok=False); check("migration installs on the stub", r.returncode == 0, r.stderr[-800:])
    r = psql(f=MIGRATION, ok=False); check("migration installs a second time (idempotent)", r.returncode == 0, r.stderr[-800:])
    n = psql("select (length(d)-length(replace(d,'fn_sp_digest_horse_option_shadow','')))/length('fn_sp_digest_horse_option_shadow') from (select pg_get_functiondef('public.fn_sp_daily_digest(date,boolean)'::regprocedure) d) x").stdout.strip()
    check("the digest names the scoreboard exactly once", n == "1", n)
    psql("""insert into public.ca_horse_style_switch values ('v16Ratio','shadow','t',now(),''),('omahaCardImpact','on_shadow','t',now(),''),('plainOn','on','t',now(),'');
            insert into public.horse_brain_telemetry(day,feature,fires) values
            ('2026-11-21','option_shadow_v16Ratio_changed_seen',30),('2026-11-21','option_shadow_v16Ratio_same_seen',70),
            ('2026-11-21','option_shadow_v16Ratio_changed_person_seen',4),('2026-11-21','option_shadow_v16Ratio_same_person_seen',6),
            ('2026-11-21','option_shadow_oldOption_changed_seen',2),('2026-11-21','option_shadow_oldOption_same_seen',2),
            ('2026-11-21','option_shadow_skipped_budget_seen',11),('2026-11-21','option_shadow_skipped_rate_seen',5),
            ('2026-11-20','option_shadow_v16Ratio_changed_seen',999)""")
    line = json.loads(psql("select public.fn_sp_daily_digest(date '2026-11-21', false)->'horse_option_shadow'").stdout)
    opts = {o["option"]: o for o in line["options"]}
    v = opts.get("v16Ratio", {})
    check("v16Ratio: 100 re-decided, 30 changed, 30.0%", v.get("redecided") == 100 and v.get("changed") == 30 and float(v.get("changed_pct")) == 30.0, v)
    check("v16Ratio: person/Horse split 4 / 26, 10 person-present re-decisions", v.get("changed_person_present") == 4 and v.get("changed_horse_only") == 26 and v.get("redecided_person_present") == 10, v)
    check("v16Ratio carries its current switch state", v.get("state") == "shadow", v)
    c = opts.get("omahaCardImpact", {})
    check("an option in on_shadow with no counters yet is listed with 0", c.get("state") == "on_shadow" and c.get("redecided") == 0 and c.get("changed_pct") is None, c)
    check("an option with counters but no longer in shadow is still reported", opts.get("oldOption", {}).get("redecided") == 4, opts.get("oldOption"))
    check("a plain ON option is not listed", "plainOn" not in opts, list(opts))
    check("the day's skips (latency guard cost) are reported", line["skips"] == {"option_shadow_skipped_budget_seen": 11, "option_shadow_skipped_rate_seen": 5}, line["skips"])
    check("only the asked day is counted", v.get("changed") == 30, v)
    g = psql("select has_function_privilege('anon','public.fn_sp_digest_horse_option_shadow(date)','execute'), has_function_privilege('service_role','public.fn_sp_digest_horse_option_shadow(date)','execute')").stdout.strip()
    check("anon cannot run it, service_role can", g == "f|t", g)
    psql("CREATE OR REPLACE FUNCTION public.fn_sp_daily_digest(p_day date DEFAULT NULL, p_send boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql AS $f$ BEGIN RETURN '{}'::jsonb; END $f$")
    r = psql(f=MIGRATION, ok=False); check("a digest without the anchor refuses the install (no silent skip)", r.returncode != 0 and "HORSE_OPTION_SHADOW_DIGEST_ANCHOR" in r.stderr, r.stderr[-400:])
finally:
    subprocess.run([os.path.join(PG_BIN, "pg_ctl"), "-D", data, "-m", "immediate", "stop"], capture_output=True)
    shutil.rmtree(d, ignore_errors=True)
sys.exit(1 if failures else 0)
