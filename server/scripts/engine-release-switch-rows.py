#!/usr/bin/env python3
"""A swap never knocks a live Horse switch row back to its default (the fleet-reset trap), checked by the release.

WHY (2026-11-20). Every engine worker validates the whole option-switch configuration it is handed: one row whose
option the serving build does not register, or whose state it does not allow, makes the worker treat the WHOLE set as
invalid and run every option at its release default (option_switch_config_invalid_seen). Until now the only check was
a lane running helpers/kit/switch.sh --audit-rows by hand before each booking and after each seal. With a cutover
every couple of hours (owner, 2026-11-20 2:38 PM Chicago) that check belongs to the release itself.

  candidate --repo R --sha TARGET [--rows F]
      Every live row of public.ca_horse_style_switch is accepted by TARGET's database whitelist: the newest
      *_horse_option_switch_* full-list migration at TARGET, plus every fn_ca_horse_option_register /
      fn_ca_horse_option_allow_shadow call in a later migration (list-once, 20261120212506). Run it at preflight,
      immediately before dispatch (ENGINE-OWNER-WINDOW-CUTOVER-PLAYBOOK.md step 7, item 8), and before booking.
  post-seal --serving SHA [--since ISO] [--rows F] [--serving-registry F] [--alarms F]
      After SEALED: the registry the serving build publishes (ca_horse_option_registry_serving) accepts every row,
      and no option-switch configuration alarm (option_switch_config_{invalid,unreadable,stale}_seen) has fired
      since ISO (horse_brain_telemetry rows updated after it with fires > 0).
  Exit 0 = every row accepted, 1 = refused (offenders listed), 3 = unknown (unreadable input; never treat as pass).

Reads production through the release workflows' read-only DATABASE_URL (psql, default_transaction_read_only=on),
the same route as engine-release-installed-migrations.py. --rows / --serving-registry / --alarms take JSON files
instead (tests, or a capture). Read-only: never writes the database, GitHub or the host.
"""
import argparse, json, os, re, subprocess, sys

STYLE = ["off", "shadow", "canary", "on"]
LEVEL_STATES = {"shadow": ["off", "shadow", "on_shadow", "on"], "on_shadow": ["off", "on_shadow", "on"], "none": ["off", "on"]}
LEVEL_RANK = {"none": 0, "on_shadow": 1, "shadow": 2}
ALARMS = ["option_switch_config_invalid_seen", "option_switch_config_unreadable_seen", "option_switch_config_stale_seen"]
FULL_LIST = re.compile(r"^supabase/migrations/(\d{14})_horse_option_switch_[A-Za-z0-9_]+\.sql$")
ANY_MIGRATION = re.compile(r"^supabase/migrations/(\d{14})_[A-Za-z0-9_]+\.sql$")


class Unknown(Exception):
    pass


def read_json(path, what):
    """An input file that is missing or not JSON is UNKNOWN, never a pass."""
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        raise Unknown("%s file %s is unreadable (%s)" % (what, path, e.__class__.__name__))


def git(repo, *args):
    r = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, timeout=60)
    if r.returncode:
        raise Unknown("git %s failed: %s" % (" ".join(args[:2]), r.stderr.strip()[-200:]))
    return r.stdout


def states_from_full_list(sql):
    """{option: [states]} from fn_ca_horse_option_switch_states in a full-list migration."""
    i = sql.find("FUNCTION public.fn_ca_horse_option_switch_states")
    if i < 0:
        raise Unknown("the full-list migration defines no fn_ca_horse_option_switch_states")
    body = sql[i:]
    end = body.find("$function$", body.find("AS $function$") + 14)
    body = body[: end if end > 0 else len(body)]
    out = {}
    for m in re.finditer(r"WHEN p_option IN \((.*?)\)\s*THEN ARRAY\[([^\]]+)\]", body, re.S):
        states = [s.strip().strip("'") for s in m.group(2).split(",")]
        for name in re.findall(r"'([A-Za-z][A-Za-z0-9]*)'", re.sub(r"--[^\n]*", "", m.group(1))):
            out.setdefault(name, states)  # CASE order: the first WHEN that names an option decides
    if not out:
        raise Unknown("fn_ca_horse_option_switch_states lists no options")
    return out


def apply_registrations(whitelist, sql):
    """list-once: register keeps the LOWER shadow level and any off-only lock; allow_shadow widens by name."""
    meta = {}
    for name, states in whitelist.items():
        if states == STYLE:
            meta[name] = ("style", False, "none")
        elif states == ["off"]:
            meta[name] = ("plain", True, "none")
        else:
            lvl = "shadow" if "shadow" in states else "on_shadow" if "on_shadow" in states else "none"
            meta[name] = ("plain", False, lvl)
    for m in re.finditer(r"fn_ca_horse_option_register\(\s*'([A-Za-z][A-Za-z0-9]*)'\s*,\s*'(style|plain)'\s*,\s*(true|false)\s*,\s*'(none|on_shadow|shadow)'", sql, re.I):
        name, kind, off_only, lvl = m.group(1), m.group(2), m.group(3).lower() == "true", m.group(4)
        if name in meta:
            k0, o0, l0 = meta[name]
            meta[name] = (k0, o0 or off_only, min(l0, lvl, key=LEVEL_RANK.get))
        else:
            meta[name] = (kind, off_only, lvl)
    for m in re.finditer(r"fn_ca_horse_option_allow_shadow\(\s*'([A-Za-z][A-Za-z0-9]*)'\s*,\s*'(none|on_shadow|shadow)'", sql):
        name, lvl = m.group(1), m.group(2)
        if name in meta:
            k0, o0, l0 = meta[name]
            meta[name] = (k0, o0, max(l0, lvl, key=LEVEL_RANK.get))
    return {n: (STYLE if k == "style" else ["off"] if o else LEVEL_STATES[l]) for n, (k, o, l) in meta.items()}


def candidate_whitelist(repo, sha):
    files = git(repo, "ls-tree", "-r", "--name-only", sha, "supabase/migrations/").split()
    full = sorted((FULL_LIST.match(f).group(1), f) for f in files if FULL_LIST.match(f))
    if not full:
        raise Unknown("no *_horse_option_switch_* migration at " + sha[:12])
    base_version, base = full[-1]
    whitelist = states_from_full_list(git(repo, "show", "%s:%s" % (sha, base)))
    later = sorted((ANY_MIGRATION.match(f).group(1), f) for f in files
                   if ANY_MIGRATION.match(f) and ANY_MIGRATION.match(f).group(1) > base_version)
    for _, f in later:
        text = git(repo, "show", "%s:%s" % (sha, f))
        if "fn_ca_horse_option_register" in text or "fn_ca_horse_option_allow_shadow" in text:
            whitelist = apply_registrations(whitelist, text)
    return whitelist, base


def psql(sql):
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise Unknown("DATABASE_URL is not set; production is unreadable")
    env = {**os.environ, "PGOPTIONS": "-c default_transaction_read_only=on -c statement_timeout=30000", "PGCONNECT_TIMEOUT": "10"}
    env.pop("LD_LIBRARY_PATH", None)
    r = subprocess.run(["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "--dbname", url],
                       input=sql, capture_output=True, text=True, timeout=90, env=env)
    if r.returncode:
        raise Unknown("production is unreadable (psql exit %d)" % r.returncode)
    return json.loads(r.stdout or "null")


def live_rows(rows_file):
    if rows_file:
        return read_json(rows_file, "rows")
    return psql("SELECT coalesce(json_agg(json_build_object('option', option, 'state', state) ORDER BY option), '[]') "
                "FROM public.ca_horse_style_switch;") or []


def judge(rows, accepted, label):
    """Offenders: rows the label's whitelist does not accept."""
    bad = []
    for r in rows:
        states = accepted.get(r["option"])
        if states is None:
            bad.append("%s = %s: NOT registered by %s" % (r["option"], r["state"], label))
        elif r["state"] not in states:
            bad.append("%s = %s: %s allows only %s" % (r["option"], r["state"], label, states))
    return bad


def cmd_candidate(a):
    accepted, base = candidate_whitelist(a.repo, a.sha)
    rows = live_rows(a.rows)
    bad = judge(rows, accepted, "candidate " + a.sha[:12])
    print("candidate %s: %d names accepted (newest full list %s); %d live rows" % (a.sha[:12], len(accepted), base.split("/")[-1], len(rows)))
    return report(bad)


def cmd_post_seal(a):
    if a.serving_registry:
        registry = read_json(a.serving_registry, "serving registry")
    else:
        doc = psql("SELECT registry FROM public.ca_horse_option_registry_serving WHERE release_sha = '%s' "
                   "ORDER BY seen_at DESC LIMIT 1;" % re.sub(r"[^0-9a-f]", "", a.serving))
        if not doc:
            raise Unknown("the serving build %s has published no registry (ca_horse_option_registry_serving)" % a.serving[:12])
        registry = doc
    rows = live_rows(a.rows)
    bad = judge(rows, registry, "serving " + a.serving[:12])
    if a.alarms:
        fired = read_json(a.alarms, "alarms")
    elif a.since:
        since = re.sub(r"[^0-9TZ:.+\- ]", "", a.since)
        names = ",".join("'%s'" % n for n in ALARMS)
        fired = psql("SELECT coalesce(json_object_agg(feature, fires), '{}') FROM (SELECT feature, sum(fires)::bigint fires "
                     "FROM horse_brain_telemetry WHERE feature IN (%s) AND updated_at > '%s' AND fires > 0 GROUP BY 1) t;" % (names, since)) or {}
    else:
        fired = {}
    bad += ["configuration alarm %s fired %s times since %s" % (k, v, a.since) for k, v in sorted(fired.items()) if v]
    print("post-seal %s: %d registered names; %d live rows; alarms checked: %s" % (a.serving[:12], len(registry), len(rows), bool(a.since or a.alarms)))
    return report(bad)


def report(bad):
    if bad:
        print("REFUSED: %d offender(s); a swap with these rows runs every option at its default:" % len(bad))
        for b in bad:
            print("  " + b)
        return 1
    print("OK: every live row is accepted")
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("candidate"); c.add_argument("--repo", default="."); c.add_argument("--sha", required=True); c.add_argument("--rows")
    s = sub.add_parser("post-seal"); s.add_argument("--serving", required=True); s.add_argument("--since"); s.add_argument("--rows")
    s.add_argument("--serving-registry"); s.add_argument("--alarms")
    a = p.parse_args(argv)
    try:
        return cmd_candidate(a) if a.cmd == "candidate" else cmd_post_seal(a)
    except Unknown as e:
        print("UNKNOWN: %s (not a pass)" % e)
        return 3


if __name__ == "__main__":
    sys.exit(main())
