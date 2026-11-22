#!/usr/bin/env python3
"""server/scripts/engine-release-switch-rows.py: a row the candidate rejects fails the release check.

Builds a throwaway git repository holding a minimal full-list migration and later list-once registrations, then runs
the check's candidate and post-seal modes on fixture rows. No database, no network. Run: python3 -B <this file>
"""
import json, os, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPT = os.path.join(ROOT, "server/scripts/engine-release-switch-rows.py")

FULL = """CREATE OR REPLACE FUNCTION public.fn_ca_horse_option_switch_states(p_option text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_option IN (
    -- registry:style-options:begin
    'styleFoldBluff'
    -- registry:style-options:end
    )
      THEN ARRAY['off', 'shadow', 'canary', 'on']
    WHEN p_option IN (
    -- registry:off-only-options:begin
    'lockedOption'
    -- registry:off-only-options:end
    )
      THEN ARRAY['off']
    WHEN p_option IN (
    -- registry:shadow-options:begin
    'shadowOption'
    -- registry:shadow-options:end
    )
      THEN ARRAY['off', 'shadow', 'on_shadow', 'on']
    WHEN p_option IN (
    -- registry:on-shadow-options:begin
    'onShadowOption'
    -- registry:on-shadow-options:end
    )
      THEN ARRAY['off', 'on_shadow', 'on']
    WHEN p_option IN (
    -- registry:plain-options:begin
    'lockedOption', 'shadowOption', 'onShadowOption', 'plainOption'
    -- registry:plain-options:end
    )
      THEN ARRAY['off', 'on']
    ELSE NULL
  END
$function$;
"""
REGISTER = """select public.fn_ca_horse_option_register('newOption', 'plain', false, 'on_shadow', '20261121000002_horse_option_register_new');
select public.fn_ca_horse_option_register('shadowOption', 'plain', false, 'none', '20261121000002_horse_option_register_new');
select public.fn_ca_horse_option_register('plainOption', 'plain', true, 'none', '20261121000002_horse_option_register_new');
"""
WIDEN = "select public.fn_ca_horse_option_allow_shadow('newOption', 'shadow', '20261121000003_widen');\n"

def sh(*a, cwd=None):
    return subprocess.run(a, cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()

def run(*args):
    r = subprocess.run([sys.executable, "-B", SCRIPT, *args], capture_output=True, text=True)
    return r.returncode, r.stdout

failures = []
def check(name, cond, out=""):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        failures.append(name); print(out)

with tempfile.TemporaryDirectory() as d:
    repo = os.path.join(d, "repo"); os.makedirs(os.path.join(repo, "supabase/migrations"))
    sh("git", "init", "-q", repo); sh("git", "-C", repo, "config", "user.email", "t@t"); sh("git", "-C", repo, "config", "user.name", "t")
    def commit(path, text):
        open(os.path.join(repo, path), "w").write(text)
        sh("git", "-C", repo, "add", "-A"); sh("git", "-C", repo, "commit", "-q", "-m", path)
        return sh("git", "-C", repo, "rev-parse", "HEAD")
    sha_empty = commit("README", "x")
    sha_full = commit("supabase/migrations/20261120000001_horse_option_switch_fixture.sql", FULL)
    sha_reg = commit("supabase/migrations/20261121000002_horse_option_register_new.sql", REGISTER)
    sha_wide = commit("supabase/migrations/20261121000003_widen.sql", WIDEN)
    rows_file = os.path.join(d, "rows.json")
    def cand(sha, rows):
        json.dump(rows, open(rows_file, "w")); return run("candidate", "--repo", repo, "--sha", sha, "--rows", rows_file)

    good = [{"option": "styleFoldBluff", "state": "canary"}, {"option": "shadowOption", "state": "shadow"},
            {"option": "onShadowOption", "state": "on_shadow"}, {"option": "plainOption", "state": "on"}, {"option": "lockedOption", "state": "off"}]
    rc, out = cand(sha_full, good); check("every accepted row passes (exit 0)", rc == 0 and "OK" in out, out)
    rc, out = cand(sha_full, good + [{"option": "lockedOption", "state": "on"}]); check("an off-only option ON is refused (exit 1)", rc == 1 and "lockedOption = on" in out, out)
    rc, out = cand(sha_full, [{"option": "plainOption", "state": "shadow"}]); check("a state the candidate does not allow is refused", rc == 1 and "allows only ['off', 'on']" in out, out)
    rc, out = cand(sha_full, [{"option": "ghostOption", "state": "off"}]); check("an option the candidate does not register is refused", rc == 1 and "NOT registered" in out, out)
    rc, out = cand(sha_full, [{"option": "styleFoldBluff", "state": "on_shadow"}]); check("a style option cannot be on_shadow", rc == 1, out)
    rc, out = cand(sha_empty, good); check("no full-list migration is UNKNOWN (exit 3), never a pass", rc == 3 and "UNKNOWN" in out, out)
    rc, out = cand(sha_reg, [{"option": "newOption", "state": "on_shadow"}]); check("list-once: a registered option is accepted", rc == 0, out)
    rc, out = cand(sha_reg, [{"option": "newOption", "state": "shadow"}]); check("list-once: a level the registration did not grant is refused", rc == 1, out)
    rc, out = cand(sha_reg, [{"option": "shadowOption", "state": "shadow"}]); check("list-once: registering keeps the LOWER level", rc == 1, out)
    rc, out = cand(sha_reg, [{"option": "plainOption", "state": "on"}]); check("list-once: an off-only lock sticks", rc == 1 and "['off']" in out, out)
    rc, out = cand(sha_wide, [{"option": "newOption", "state": "shadow"}]); check("list-once: allow_shadow widens by name", rc == 0, out)

    reg_file, alarm_file = os.path.join(d, "reg.json"), os.path.join(d, "alarms.json")
    json.dump({"plainOption": ["off", "on"], "styleFoldBluff": ["off", "shadow", "canary", "on"]}, open(reg_file, "w"))
    json.dump([{"option": "plainOption", "state": "on"}], open(rows_file, "w")); json.dump({}, open(alarm_file, "w"))
    rc, out = run("post-seal", "--serving", "abc123", "--rows", rows_file, "--serving-registry", reg_file, "--alarms", alarm_file)
    check("post-seal: serving registry accepts, no alarm -> exit 0", rc == 0, out)
    json.dump([{"option": "plainOption", "state": "on_shadow"}], open(rows_file, "w"))
    rc, out = run("post-seal", "--serving", "abc123", "--rows", rows_file, "--serving-registry", reg_file, "--alarms", alarm_file)
    check("post-seal: a row the serving build rejects -> exit 1", rc == 1, out)
    json.dump([{"option": "plainOption", "state": "on"}], open(rows_file, "w")); json.dump({"option_switch_config_invalid_seen": 9}, open(alarm_file, "w"))
    rc, out = run("post-seal", "--serving", "abc123", "--since", "2026-11-20T22:11:21Z", "--rows", rows_file, "--serving-registry", reg_file, "--alarms", alarm_file)
    check("post-seal: a configuration alarm since the seal -> exit 1", rc == 1 and "option_switch_config_invalid_seen" in out, out)

# Unreadable input is UNKNOWN (exit 3), never a crash and never a pass.
rc, out = run("candidate", "--repo", ROOT, "--sha", "HEAD", "--rows", "/dev/null")
check("an unreadable rows file is UNKNOWN (exit 3)", rc == 3 and "UNKNOWN" in out, out)
# The real tree: this checkout's newest full list parses and names every registered option.
with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
    f.write("[]")
rc, out = run("candidate", "--repo", ROOT, "--sha", "HEAD", "--rows", f.name); os.unlink(f.name)
import re as _re
m = _re.search(r"(\d+) names accepted", out)
check("this checkout's newest full list parses (>= 300 names)", rc == 0 and m and int(m.group(1)) >= 300, out)
sys.exit(1 if failures else 0)
