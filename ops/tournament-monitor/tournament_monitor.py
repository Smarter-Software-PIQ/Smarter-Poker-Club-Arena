#!/usr/bin/env python3
"""Smarter.Poker Club Arena temporary tournament monitor.

Deterministic, read-only checker. It DETECTS and RECORDS only:
  - no corrective action, no engine changes, no database writes (HTTP GET only),
  - no money movement, no email or notification of any kind.

One invocation = one monitoring cycle. systemd runs it every 180 s
(tournament-monitor.timer). A separate Claude session reads the state files.

Outputs (all under /opt/tournament-monitor):
  state/latest.json          last cycle, rewritten atomically
  state/cycles.jsonl         one summary line per cycle (append-only)
  state/findings.jsonl       one line per finding transition (opened / escalated /
                             resolved / reopened), append-only, keyed by fingerprint
  state/findings_state.json  current view of every finding (open + resolved)
  state/heartbeat            time of the last successful cycle
  state/claude_heartbeat     touched by a Claude chat session when it reads the handoff
  state/monitor.log          skipped cycles, errors
  window.json                the 24 h observation window (never reset)
  incidents/<fingerprint>.json
                             one incident record per distinct finding fingerprint:
                             the source of truth that carries a finding across chat
                             sessions (Detected -> ... -> Closed). The checker opens
                             and updates records; it never deletes or closes one.

Subcommands (a chat session uses these over ssh; the systemd unit passes none):
  tournament_monitor.py                       one monitoring cycle (default)
  tournament_monitor.py handoff [--by WHO]    plain-text handoff; touches state/claude_heartbeat
  tournament_monitor.py incidents [--open]    incident records as JSON
  tournament_monitor.py incident <fp> --stage <Stage> --by WHO --note TEXT
                                  [--pr N] [--migration V] [--release SHA] [--owner WHO]

The incident record is a record keeper, not a repair: nothing here fixes, retries,
notifies or schedules anything (CLAUDE.md 10.11, 10.12, 10.85).

Optional test input: /opt/tournament-monitor/test-input.json. Synthetic events in it
are evaluated by the same rules and tagged test=true. Production data is never touched.
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import fcntl
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

BASE = os.environ.get("TM_BASE", "/opt/tournament-monitor")
STATE = os.path.join(BASE, "state")
INCIDENTS = os.path.join(BASE, "incidents")
CLAUDE_HEARTBEAT = os.path.join(STATE, "claude_heartbeat")
ENV_FILE = os.environ.get("TM_ENV_FILE", "/opt/club-arena/server/.env")
HEALTH_URL = os.environ.get("TM_HEALTH_URL", "https://engine.smarter.poker/health")
METRICS_URL = os.environ.get("TM_METRICS_URL", "http://127.0.0.1:8080/metrics")
CONTAINER = os.environ.get("TM_CONTAINER", "club-arena-engine")
TEST_INPUT = os.path.join(BASE, "test-input.json")
LOCK = os.path.join(BASE, "run.lock")
CHI = ZoneInfo("America/Chicago")
MONITOR_VERSION = "1.2.0"

INTERVAL_S = 180
CLAUDE_HEARTBEAT_MAX_S = 1800   # informational only since 1.2.0: latest.json reports the handoff as unattended
# A record whose symptom has not been observed for this long, and that nobody has claimed, is moved
# to CLEARED_STAGE by the checker (10 clean cycles at 180 s). CLEARED is not Closed: it says the
# symptom stopped without a recorded fix, so the record stays listed for root-cause review and any
# recurrence reopens it.
CLEAR_AFTER_S = 1800
CLEARED_STAGE = "Cleared, no fix recorded"

# Incident stages, in order. "Reopened" is a transition (recorded in stage_history), not a
# stage: a reopened record returns to "Detected".
STAGES = ["Detected", "Investigating", "Fix implemented", "Pushed/merged", "Deployed",
          "Production fix verified", "Phase 2 hardening", "Hardening deployed and verified", "Closed"]
STAGE_INDEX = {s: i for i, s in enumerate(STAGES)}
TERMINAL_STAGES = {"Closed", CLEARED_STAGE}
MISSED_GAP_S = 300
WINDOW_HOURS = 24
# Per-state thresholds (seconds)
NO_HAND_WARN_S = 480          # running, not on break / maintenance: no hand for 8 min
NO_HAND_CRIT_S = 900          # 15 min
POST_BREAK_GRACE_S = 180      # after a break / maintenance ends
BREAK_OVERRUN_S = 240         # on_break flag still set this long after break_ends_at (outside maintenance)
START_OVERDUE_S = 300         # MTT past start, enough players, not started
NEVER_DEALT_S = 600           # started but no hand at all
DECIDED_UNSETTLED_S = 600     # <=1 player left and still RUNNING
SETTLE_GRACE_S = 600          # completed but escrow open / no payouts after this long
SETTLE_LOOKBACK_MIN = 45      # completed events re-checked for settlement
TIMEBANK_S = 20
TIMEBANKS_PER_DECISION = 2
ACTION_GRACE_S = 30
LEASE_STALE_S = 90
RECOVERY_LOOP_N = 2           # zombie rebuilds of one table inside RECOVERY_LOOP_WINDOW_S
RECOVERY_LOOP_WINDOW_S = 1800
SOFT_CONFIRM_CYCLES = 2       # soft symptoms must persist this many cycles before opening
LOG_SINCE_MAX_S = 900

PROGRESS = {"no_hand_progress", "action_overdue", "table_no_hand_progress", "started_no_hands",
            "engine_stalled_table", "start_overdue", "break_overrun"}
SOFT = {"tables_unbalanced", "final_table_not_formed", "elimination_pending",
        "full_not_started", "table_no_hand_progress"}


# ----------------------------------------------------------------- utilities
def now_utc():
    return dt.datetime.now(dt.timezone.utc)


def iso(t):
    return t.astimezone(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z") if t else None


def chi(t):
    return t.astimezone(CHI).isoformat(timespec="seconds") if t else None


def parse_ts(s):
    if not s:
        return None
    try:
        s = s.replace("Z", "+00:00")
        # PostgREST may return 1-6 fractional digits
        m = re.match(r"^(.*T\d\d:\d\d:\d\d)(\.\d+)?(.*)$", s)
        if m and m.group(2):
            s = m.group(1) + (m.group(2) + "000000")[:7] + m.group(3)
        t = dt.datetime.fromisoformat(s)
        if t.tzinfo is None:
            t = t.replace(tzinfo=dt.timezone.utc)
        return t
    except Exception:
        return None


def ms_ts(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc) if ms else None


def atomic_write(path, text):
    tmp = f"{path}.tmp.{os.getpid()}"
    with open(tmp, "w") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def append_line(path, obj):
    with open(path, "a") as f:
        f.write(json.dumps(obj, separators=(",", ":"), default=str) + "\n")
        f.flush()
        os.fsync(f.fileno())


def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def log(msg):
    line = f"{iso(now_utc())} {msg}"
    try:
        with open(os.path.join(STATE, "monitor.log"), "a") as f:
            f.write(line + "\n")
    except Exception:
        pass
    print(line, flush=True)


SECRET_RX = re.compile(r"(eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+|"
                       r"(?i:(?:key|token|secret|password|authorization)[\"']?\s*[:=]\s*[\"']?)[^\s\"',]+)")


def redact(s):
    return SECRET_RX.sub("[redacted]", s)


def fingerprint(event_id, table_id, symptom):
    raw = f"{event_id or '-'}|{table_id or '-'}|{symptom}"
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


# ----------------------------------------------------------------- sources
def read_env_key(name):
    val = None
    with open(ENV_FILE) as f:
        for line in f:
            m = re.match(rf"^\s*{name}\s*=\s*(.*)$", line)
            if m:
                val = m.group(1).strip().strip('"').strip("'").strip()
    return val


class Supa:
    def __init__(self):
        self.url = (read_env_key("SUPABASE_URL") or "").rstrip("/")
        key = read_env_key("SUPABASE_SERVICE_ROLE_KEY") or ""
        if not self.url or not key:
            raise RuntimeError("Supabase URL or service key missing in engine env file")
        self._h = {"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"}
        self.requests = 0

    def get(self, table, params, page=1000, max_rows=20000):
        """Read-only paginated GET against PostgREST."""
        out, offset = [], 0
        while True:
            q = dict(params)
            q["limit"] = str(page)
            q["offset"] = str(offset)
            url = f"{self.url}/rest/v1/{table}?{urllib.parse.urlencode(q, safe='(),.*:')}"
            req = urllib.request.Request(url, headers=self._h, method="GET")
            last = None
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(req, timeout=25) as r:
                        rows = json.loads(r.read())
                    self.requests += 1
                    break
                except urllib.error.HTTPError as e:
                    last = f"HTTP {e.code} on {table}"
                    if e.code < 500:
                        raise RuntimeError(last)
                except Exception as e:  # network
                    last = f"{type(e).__name__} on {table}"
                time.sleep(1 + attempt)
            else:
                raise RuntimeError(last or f"read failed on {table}")
            out.extend(rows)
            if len(rows) < page or len(out) >= max_rows:
                return out
            offset += page


def http_get(url, timeout=12):
    req = urllib.request.Request(url, headers={"User-Agent": "tournament-monitor/1"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def parse_metrics(text):
    m = {"ms_since_progress": {}, "hands_dealt": {}, "gauges": {}}
    rx = re.compile(r'^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+([-+0-9.eE]+|NaN)')
    for line in text.splitlines():
        if not line or line[0] == "#":
            continue
        mm = rx.match(line)
        if not mm:
            continue
        name, labels, val = mm.group(1), mm.group(2) or "", mm.group(3)
        try:
            v = float(val)
        except ValueError:
            continue
        lab = dict(re.findall(r'(\w+)="([^"]*)"', labels))
        if name == "poker_table_ms_since_progress" and "table_id" in lab:
            m["ms_since_progress"][lab["table_id"]] = {"ms": v, "paused": lab.get("paused") == "1"}
        elif name == "poker_table_hands_dealt" and "table_id" in lab:
            m["hands_dealt"][lab["table_id"]] = v
        elif name.startswith("poker_tournament") and not labels:
            m["gauges"][name] = v
    return m


def docker_logs(since_s):
    try:
        p = subprocess.run(["docker", "logs", "--timestamps", "--since", f"{int(since_s)}s", CONTAINER],
                           capture_output=True, text=True, timeout=40)
        return (p.stdout + "\n" + p.stderr).splitlines(), None
    except Exception as e:
        return [], f"docker logs failed: {type(e).__name__}"


# ----------------------------------------------------------------- classification
def _num(v):
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def prize_pool_zero_is_a_defect(t):
    """A running event with a prize pool of 0 is a defect, except a bounty-only knockout.

    A bounty-only PKO / Mystery Bounty (no guarantee, every chip in the bounty pool) legitimately runs
    and finishes with a place prize pool of 0 (#9617, #9620, migration bounty_only_pko_ends_with_two_players):
    flagging it raised a permanent false critical on every Midday and Midnight Free Buy. A guaranteed event,
    or any event with nothing in its bounty pool either, still flags.
    """
    if _num(t.get("prize_pool")) > 0:
        return False
    knockout = bool(t.get("is_pko")) or bool(t.get("is_mystery_bounty"))
    if knockout and _num(t.get("guaranteed_prize")) <= 0 and _num(t.get("bounty_pool")) > 0:
        return False
    return True


def fmt_of(t):
    tt = (t.get("tournament_type") or "").upper()
    if tt == "SPIN":
        return "SPIN"
    if tt == "SNG":
        return "SNG"
    if tt == "SATELLITE" or t.get("satellite_target_id") or t.get("satellite_target"):
        return "SATELLITE"
    return "MTT"


def chunks(xs, n):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def inlist(ids):
    return "in.(" + ",".join(ids) + ")"


# ----------------------------------------------------------------- the cycle
class Cycle:
    def __init__(self):
        self.start = now_utc()
        self.candidates = []   # findings detected this cycle
        self.source_errors = []
        self.events = {}       # id -> per-event status record
        self.health = None
        self.metrics = None
        self.log_lines = []
        self.release_sha = None
        self.suppressed = False
        self.cycle_no = 0

    def add(self, symptom, severity, summary, event=None, table_id=None, details=None, test=False):
        eid = event["id"] if event else None
        self.candidates.append({
            "fingerprint": fingerprint(eid, table_id, symptom),
            "symptom": symptom,
            "severity": severity,
            "summary": summary,
            "event_id": eid,
            "event_name": event.get("name") if event else None,
            "format": event.get("_format") if event else None,
            "table_id": table_id,
            "details": details or {},
            "test": bool(test or (event or {}).get("_test")),
        })
        if eid and eid in self.events:
            self.events[eid]["symptoms"].append(symptom)


def run_cycle(prev_state):
    c = Cycle()
    now = c.start

    # ---- engine health
    try:
        c.health = json.loads(http_get(HEALTH_URL))
        c.release_sha = c.health.get("releaseSha")
    except Exception as e:
        c.source_errors.append(f"health: {type(e).__name__}")
    # ---- engine telemetry (read-only Prometheus text)
    try:
        c.metrics = parse_metrics(http_get(METRICS_URL))
    except Exception as e:
        c.source_errors.append(f"metrics: {type(e).__name__}")
    # ---- engine logs since the previous cycle (read-only)
    last_start = parse_ts(prev_state.get("last_cycle_start"))
    since = min(LOG_SINCE_MAX_S, max(INTERVAL_S + 30, (now - last_start).total_seconds() + 15 if last_start else 240))
    c.log_lines, lerr = docker_logs(since)
    if lerr:
        c.source_errors.append(lerr)

    h = c.health or {}
    maint = h.get("maintenance") or {}
    maint_active = bool(maint.get("active"))
    recovery_active = h.get("recovery") is not None
    maint_end = ms_ts(maint.get("breakEndsAt")) if maint_active else None
    # remember the end of the most recent maintenance window for post-window grace
    last_maint_end = parse_ts(prev_state.get("last_maintenance_end"))
    if maint_active and maint_end:
        last_maint_end = max(last_maint_end or maint_end, maint_end)
    suppress_progress = maint_active or recovery_active
    maint_dur_ms = ((maint.get("schedule") or {}).get("durationMs")) or 300000
    lease_owner = ((h.get("tournamentLease") or {}).get("instanceId")
                   or (h.get("leadership") or {}).get("holder"))

    timings = {}
    mark = [time.monotonic()]

    def lap(name):
        t1 = time.monotonic()
        timings[name] = round(t1 - mark[0], 2)
        mark[0] = t1
    lap("engine_sources")
    # ---- discovery
    supa = Supa()
    cols = ("id,name,status,tournament_type,satellite_target_id,satellite_target,start_time,started_at,ended_at,"
            "current_players,max_players,min_players,table_size,prize_pool,prize_pool_finalized,free_buy,"
            "guaranteed_prize,on_break,break_started_at,break_ends_at,action_time_seconds,late_reg_mins,"
            "current_level,updated_at,satellite_seats,created_at,is_pko,is_mystery_bounty,bounty_pool")
    horizon = iso(now + dt.timedelta(hours=1))
    running = supa.get("tournaments", {"select": cols, "status": "eq.RUNNING", "order": "start_time,id"})
    registering = supa.get("tournaments", {"select": cols, "status": "eq.REGISTERING",
                                           "start_time": f"lte.{horizon}", "order": "start_time,id"})
    recent_done = supa.get("tournaments", {"select": cols, "status": "eq.COMPLETED",
                                           "ended_at": f"gte.{iso(now - dt.timedelta(minutes=SETTLE_LOOKBACK_MIN))}",
                                           "order": "ended_at.desc,id"})
    other_status = supa.get("tournaments", {"select": "id,status", "status": "not.in.(RUNNING,REGISTERING,COMPLETED,CANCELLED)",
                                            "order": "start_time,id"}, max_rows=5000)
    if other_status:
        running += supa.get("tournaments", {"select": cols, "id": inlist([r["id"] for r in other_status[:200]])})

    lap("discovery")
    # synthetic test events (never production data)
    test_events = []
    if os.path.exists(TEST_INPUT):
        try:
            ti = load_json(TEST_INPUT, {})
            for ev in ti.get("events", []):
                ev = dict(ev)
                ev["_test"] = True
                test_events.append(ev)
        except Exception as e:
            c.source_errors.append(f"test-input unreadable: {type(e).__name__}")

    for t in running + registering + recent_done + test_events:
        t["_format"] = fmt_of(t)

    # ---- per-event data for running events
    run_ids = [t["id"] for t in running]
    players, leases, escrows = {}, {}, {}
    per_event_err = {}

    def fetch_players(ids):
        return supa.get("tournament_players", {"select": "tournament_id,table_id,status,chips,seat_number,rebuy_prompt_until",
                                               "tournament_id": inlist(ids), "status": "neq.eliminated",
                                               "order": "tournament_id,user_id"})
    for grp in chunks(run_ids, 40):
        try:
            for p in fetch_players(grp):
                players.setdefault(p["tournament_id"], []).append(p)
        except Exception as e:
            for i in grp:
                per_event_err[i] = f"players: {e}"
    for grp in chunks(run_ids, 100):
        try:
            for r in supa.get("engine_tournament_leases", {"select": "tournament_id,instance_id,heartbeat_at,engine_version",
                                                           "tournament_id": inlist(grp)}):
                leases[r["tournament_id"]] = r
        except Exception as e:
            for i in grp:
                per_event_err.setdefault(i, f"leases: {e}")

    lap("players_leases")
    # last hand per event + per table (multi-table events)
    last_hand_event, last_hand_table = {}, {}

    def q_last_event(eid):
        r = supa.get("hand_history", {"select": "created_at,table_id,hand_number", "tournament_id": f"eq.{eid}",
                                      "order": "created_at.desc"}, page=1, max_rows=1)
        return eid, (r[0] if r else None)

    def q_last_table(tid):
        r = supa.get("hand_history", {"select": "created_at,hand_number", "table_id": f"eq.{tid}",
                                      "order": "hand_number.desc"}, page=1, max_rows=1)
        return tid, (r[0] if r else None)

    multi_tables = set()
    for eid, ps in players.items():
        tids = {p["table_id"] for p in ps if p.get("table_id")}
        if len(tids) > 1:
            multi_tables |= tids
    with cf.ThreadPoolExecutor(max_workers=12) as ex:
        futs = {ex.submit(q_last_event, e): ("e", e) for e in run_ids}
        futs.update({ex.submit(q_last_table, t): ("t", t) for t in multi_tables})
        for f in cf.as_completed(futs):
            kind, key = futs[f]
            try:
                k, row = f.result()
                (last_hand_event if kind == "e" else last_hand_table)[k] = row
            except Exception as e:
                if kind == "e":
                    per_event_err.setdefault(key, f"hand_history: {e}")
                else:
                    c.source_errors.append(f"hand_history table {key[:8]}: {type(e).__name__}")

    lap("hand_history")
    # settlement data for recently completed
    done_ids = [t["id"] for t in recent_done]
    payouts_n, awards_n = {}, {}
    for grp in chunks(done_ids, 100):
        try:
            for r in supa.get("tournament_escrow", {"select": "tournament_id,prize_balance,bounty_balance,fee_balance,closed_at,enforced",
                                                    "tournament_id": inlist(grp)}):
                escrows[r["tournament_id"]] = r
            for r in supa.get("tournament_payouts", {"select": "tournament_id,source", "tournament_id": inlist(grp),
                                                     "order": "tournament_id,position"}, max_rows=50000):
                payouts_n[r["tournament_id"]] = payouts_n.get(r["tournament_id"], 0) + 1
                if r.get("source") in ("satellite_seat", "satellite_ticket"):
                    awards_n[r["tournament_id"]] = awards_n.get(r["tournament_id"], 0) + 1
        except Exception as e:
            for i in grp:
                per_event_err.setdefault(i, f"settlement: {e}")
    # satellite seats / tickets are delivered as payout rows with source satellite_seat / satellite_ticket

    lap("settlement")
    # table -> event map (for engine telemetry & logs)
    table_event = {}
    for eid, ps in players.items():
        for p in ps:
            if p.get("table_id"):
                table_event[p["table_id"]] = eid

    # recovery-loop tracking from engine logs
    rebuild_hist = prev_state.get("rebuild_history", {})
    rx_rebuild = re.compile(r"zombie_engine_rebuilt\].*Engine for ([0-9a-f\-]{36})")
    rebuilds_this_cycle = {}
    # Log windows overlap between cycles on purpose; each rebuild is keyed by its own docker
    # timestamp so the same log line is never counted twice.
    for line in c.log_lines:
        m = rx_rebuild.search(line)
        if m:
            ts = line.split(" ", 1)[0]
            seen_ts = rebuild_hist.setdefault(m.group(1), [])
            if ts not in seen_ts:
                seen_ts.append(ts)
                rebuilds_this_cycle[m.group(1)] = rebuilds_this_cycle.get(m.group(1), 0) + 1
    cutoff = now - dt.timedelta(seconds=RECOVERY_LOOP_WINDOW_S)
    rebuild_hist = {k: [x for x in v if isinstance(x, str) and (parse_ts(x) or now) >= cutoff]
                    for k, v in rebuild_hist.items()}
    rebuild_hist = {k: v for k, v in rebuild_hist.items() if v}

    by_id = {t["id"]: t for t in running + registering + recent_done + test_events}

    def excerpt(*needles):
        needles = [n for n in needles if n]
        if not needles:
            return []
        out = []
        for line in reversed(c.log_lines):
            if any(n in line for n in needles):
                out.append(redact(line[:400]))
                if len(out) >= 6:
                    break
        return list(reversed(out))

    # ---- evaluate events
    def ev_record(t, active, state):
        c.events[t["id"]] = {"id": t["id"], "name": t.get("name"), "format": t["_format"],
                             "status": t.get("status"), "state": state, "active": active,
                             "checked": True, "checks": [], "symptoms": [], "test": bool(t.get("_test")),
                             "start_time": t.get("start_time"), "players": t.get("current_players")}
        return c.events[t["id"]]

    def unchecked(t, reason):
        r = c.events.setdefault(t["id"], {"id": t["id"], "name": t.get("name"), "format": t["_format"],
                                          "status": t.get("status"), "active": True, "checks": [],
                                          "symptoms": [], "test": bool(t.get("_test"))})
        r["checked"] = False
        r["state"] = "unchecked"
        r["unchecked_reason"] = reason
        c.add("monitoring_gap", "warning", f"Could not check event: {reason}", t)

    # REGISTERING within the next hour
    for t in registering + [e for e in test_events if e.get("status") == "REGISTERING"]:
        st = parse_ts(t.get("start_time"))
        fmt = t["_format"]
        r = ev_record(t, True, "registering")
        r["checks"] = ["registration"]
        if not st:
            continue
        past = (now - st).total_seconds()
        if past <= 0:
            r["state"] = "scheduled"
            continue
        n = t.get("current_players") or 0
        if fmt in ("SPIN", "SNG"):
            mx = t.get("max_players") or 0
            if mx and n >= mx and past > 180:
                c.add("full_not_started", "warning", f"{fmt} is full ({n}/{mx}) but has not started", t,
                      details={"players": n, "max_players": mx, "start_time": t.get("start_time")})
            else:
                r["state"] = "filling"
        else:
            mn = t.get("min_players") or 2
            if n < mn:
                r["state"] = "waiting_min_players"
            elif past > START_OVERDUE_S and not suppress_progress:
                c.add("start_overdue", "critical",
                      f"{fmt} is {int(past // 60)} min past its start time with {n} registered and has not started", t,
                      details={"start_time": t.get("start_time"), "registered": n, "min_players": mn})
            else:
                r["state"] = "starting"

    # RUNNING (and any unexpected status)
    for t in running + [e for e in test_events if e.get("status") != "REGISTERING" and e.get("status") != "COMPLETED"]:
        eid = t["id"]
        if eid in per_event_err and not t.get("_test"):
            unchecked(t, per_event_err[eid])
            continue
        r = ev_record(t, True, "running")
        fmt = t["_format"]
        if t.get("status") not in ("RUNNING",):
            c.add("unexpected_status", "warning", f"Event in unexpected status {t.get('status')}", t,
                  details={"status": t.get("status")})
        if t.get("_test"):
            ps = t.get("_players", [])
            lh = {"created_at": t.get("_last_hand_at")} if t.get("_last_hand_at") else None
            lease = t.get("_lease", "skip")
        else:
            ps = players.get(eid, [])
            lh = last_hand_event.get(eid)
            lease = leases.get(eid)
        r["checks"] = ["hand_progress", "seating", "lease", "eliminations", "balancing", "prize_pool"]
        started = parse_ts(t.get("started_at")) or parse_ts(t.get("start_time"))
        last_hand = parse_ts((lh or {}).get("created_at"))
        on_break = bool(t.get("on_break"))
        b_start, b_end = parse_ts(t.get("break_started_at")), parse_ts(t.get("break_ends_at"))
        playing = [p for p in ps if (p.get("status") or "").lower() == "playing"]
        alive = [p for p in playing if (p.get("chips") or 0) > 0]
        tables = {}
        for p in playing:
            if p.get("table_id"):
                tables.setdefault(p["table_id"], 0)
                tables[p["table_id"]] += 1
        r.update({"tables": len(tables), "playing": len(playing),
                  "last_hand_at": iso(last_hand), "on_break": on_break,
                  "break_ends_at": t.get("break_ends_at")})

        # --- decided but not settled
        since_start = (now - started).total_seconds() if started else 0
        last_activity = max([x for x in (last_hand, started) if x] or [now])
        if len(alive) <= 1 and since_start > 120:
            idle = (now - last_activity).total_seconds()
            if idle > DECIDED_UNSETTLED_S:
                c.add("decided_not_settled", "critical",
                      f"{len(alive)} player(s) with chips left and the event is still RUNNING "
                      f"{int(idle // 60)} min after its last hand", t,
                      details={"players_with_chips": len(alive), "last_hand_at": iso(last_hand)})
                r["state"] = "decided_unsettled"
            else:
                r["state"] = "finishing"
        else:
            # --- hand progress with per-state thresholds
            progress_ref = max([x for x in (last_hand, started) if x])
            if on_break and b_end and b_end > now:
                r["state"] = "on_break"
                if last_hand and b_start and (b_start - last_hand).total_seconds() > NO_HAND_WARN_S:
                    age = int((now - last_hand).total_seconds())
                    c.add("no_hand_progress", "critical",
                          f"No hand recorded for {age // 60} min; it had already stopped dealing "
                          f"{int((b_start - last_hand).total_seconds() // 60)} min before its break began", t,
                          details={"last_hand_at": iso(last_hand), "seconds_since_last_hand": age,
                                   "break_started_at": iso(b_start), "on_break_flag": True})
                    r["state"] = "stalled"
            elif suppress_progress:
                r["state"] = "maintenance_window"
            else:
                ref = progress_ref
                # Grace after a break / maintenance window applies only if the event was dealing
                # normally when that window began; an event already frozen gets no fresh grace.
                windows = []
                if b_end and b_end <= now:
                    windows.append((b_start or b_end, b_end))
                if last_maint_end and last_maint_end <= now:
                    windows.append((last_maint_end - dt.timedelta(milliseconds=maint_dur_ms), last_maint_end))
                for w_start, w_end in windows:
                    if last_hand is None or (w_start - last_hand).total_seconds() <= NO_HAND_WARN_S:
                        ref = max(ref, w_end + dt.timedelta(seconds=POST_BREAK_GRACE_S))
                idle = (now - ref).total_seconds()
                if on_break and b_end and (now - b_end).total_seconds() > BREAK_OVERRUN_S:
                    c.add("break_overrun", "warning",
                          f"Break should have ended {int((now - b_end).total_seconds() // 60)} min ago", t,
                          details={"break_ends_at": iso(b_end)})
                if last_hand is None and since_start > NEVER_DEALT_S:
                    c.add("started_no_hands", "critical",
                          f"Started {int(since_start // 60)} min ago and no hand has been recorded", t,
                          details={"started_at": iso(started)})
                    r["state"] = "never_dealt"
                elif idle > NO_HAND_WARN_S and last_hand is not None:
                    age = int((now - last_hand).total_seconds())
                    sev = "critical" if idle > NO_HAND_CRIT_S else "warning"
                    c.add("no_hand_progress", sev,
                          f"No hand recorded for {age // 60} min (last hand {iso(last_hand)}), not on break, "
                          f"no maintenance window", t,
                          details={"last_hand_at": iso(last_hand), "seconds_since_last_hand": age,
                                   "on_break_flag": on_break, "break_ends_at": iso(b_end)})
                    r["state"] = "stalled"

            # --- per-table progress (multi-table events, DB view)
            if not suppress_progress and len(tables) > 1 and r["state"] == "running" and last_hand:
                for tid in tables:
                    tl = parse_ts((last_hand_table.get(tid) or {}).get("created_at"))
                    if tl is None:
                        continue
                    lag = (last_hand - tl).total_seconds()
                    if lag > NO_HAND_WARN_S:
                        c.add("table_no_hand_progress", "warning",
                              f"Table has dealt no hand for {int(lag // 60)} min while other tables in the event did", t,
                              table_id=tid, details={"table_last_hand_at": iso(tl), "event_last_hand_at": iso(last_hand)})

        # --- seating
        unseated = [p for p in alive if not p.get("table_id")]
        if unseated and since_start > 180:
            c.add("unseated_players", "critical", f"{len(unseated)} player(s) with chips have no table", t,
                  details={"count": len(unseated)})
        if since_start > 180 and alive and not tables:
            c.add("no_tables", "critical", "Event is running but no table holds any player", t)
        # duplicate seats
        seen = {}
        for p in playing:
            if p.get("table_id") and p.get("seat_number") is not None:
                k = (p["table_id"], p["seat_number"])
                seen[k] = seen.get(k, 0) + 1
        for (tid, seat), n in seen.items():
            if n > 1:
                c.add("seat_collision", "critical", f"{n} players share seat {seat}", t, table_id=tid,
                      details={"seat": seat, "players": n})
        # --- eliminations
        # 0 chips while a rebuy offer is still open (rebuy_prompt_until in the future) is legitimate
        zero = [p for p in playing if (p.get("chips") or 0) <= 0
                and not ((parse_ts(p.get("rebuy_prompt_until")) or now) > now)]
        if zero:
            c.add("elimination_pending", "warning",
                  f"{len(zero)} player(s) marked playing with 0 chips and no open rebuy offer", t,
                  details={"count": len(zero)})
        # --- balancing / final table
        size = t.get("table_size") or 9
        if len(tables) > 1 and r["state"] in ("running",):
            counts = sorted(tables.values())
            if counts[-1] - counts[0] > 2:
                c.add("tables_unbalanced", "warning", f"Table sizes differ by {counts[-1] - counts[0]} ({counts})", t,
                      details={"table_counts": counts})
            if len(alive) <= size:
                c.add("final_table_not_formed", "warning",
                      f"{len(alive)} players left (table size {size}) but still spread over {len(tables)} tables", t,
                      details={"players": len(alive), "tables": len(tables), "table_size": size})
        # --- prize pool
        if since_start > 600 and len(ps) >= 2 and prize_pool_zero_is_a_defect(t):
            c.add("prize_pool_zero", "critical", "Running event shows a prize pool of 0", t,
                  details={"prize_pool": t.get("prize_pool"), "prize_pool_finalized": t.get("prize_pool_finalized"),
                           "free_buy": t.get("free_buy"), "guaranteed_prize": t.get("guaranteed_prize"),
                           "is_pko": t.get("is_pko"), "bounty_pool": t.get("bounty_pool")})
        # --- lease / ownership
        if lease == "skip":
            pass
        elif lease is None:
            if since_start > 120:
                c.add("lease_missing", "critical", "Running event has no engine lease row", t)
        else:
            hb = parse_ts(lease.get("heartbeat_at"))
            if hb is None or (now - hb).total_seconds() > LEASE_STALE_S:
                c.add("lease_heartbeat_stale", "critical",
                      f"Engine lease heartbeat is {int((now - hb).total_seconds()) if hb else '?'} s old", t,
                      details={"heartbeat_at": iso(hb), "instance_id": lease.get("instance_id")})
            if lease_owner and lease.get("instance_id") and lease.get("instance_id") != lease_owner:
                c.add("lease_foreign_owner", "critical", "Event lease held by an engine instance that is not the leader", t,
                      details={"lease_instance": lease.get("instance_id"), "leader": lease_owner})

        # --- engine telemetry per table (action deadlines)
        if c.metrics is None:
            r["checks"].append("telemetry:missing")
        else:
            limit = (t.get("action_time_seconds") or 15) + TIMEBANK_S * TIMEBANKS_PER_DECISION + ACTION_GRACE_S
            for tid in tables:
                sp = c.metrics["ms_since_progress"].get(tid)
                if sp and not sp["paused"] and not suppress_progress and sp["ms"] / 1000 > limit:
                    c.add("action_overdue", "critical",
                          f"Table has made no progress for {int(sp['ms'] / 1000)} s (clock+time bank+grace = {limit} s) "
                          f"and is not paused", t, table_id=tid,
                          details={"ms_since_progress": sp["ms"], "limit_s": limit})
            r["checks"].append("action_deadlines")
        # --- recovery loops on this event's tables
        for tid in list(tables) + ([eid] if eid in rebuild_hist else []):
            n = len(rebuild_hist.get(tid, []))
            if n >= RECOVERY_LOOP_N:
                c.add("recovery_loop", "critical",
                      f"Engine rebuilt this table {n} times in {RECOVERY_LOOP_WINDOW_S // 60} min (zombie loop)", t,
                      table_id=tid, details={"rebuilds": n})

    # COMPLETED in the lookback: settlement checks
    settled_recent = 0
    for t in recent_done + [e for e in test_events if e.get("status") == "COMPLETED"]:
        eid = t["id"]
        if eid in per_event_err and not t.get("_test"):
            unchecked(t, per_event_err[eid])
            continue
        ended = parse_ts(t.get("ended_at")) or now
        age = (now - ended).total_seconds()
        esc = t.get("_escrow") if t.get("_test") else escrows.get(eid)
        npay = t.get("_payouts", 0) if t.get("_test") else payouts_n.get(eid, 0)
        problems = []
        if esc:
            bal = sum(float(esc.get(k) or 0) for k in ("prize_balance", "bounty_balance", "fee_balance"))
            if abs(bal) > 0.0001:
                problems.append(("escrow_not_zero", f"Escrow still holds {bal:g} after finish",
                                 {k: esc.get(k) for k in ("prize_balance", "bounty_balance", "fee_balance")}))
            if not esc.get("closed_at"):
                problems.append(("escrow_not_closed", "Escrow not closed after finish", {}))
        if float(t.get("prize_pool") or 0) > 0 and npay == 0:
            problems.append(("payouts_missing", f"Prize pool {t.get('prize_pool')} but no payout rows", {}))
        if t["_format"] == "SATELLITE":
            na = t.get("_awards", 0) if t.get("_test") else awards_n.get(eid, 0)
            if na == 0:
                problems.append(("satellite_tickets_missing", "Satellite finished with no seat/ticket award payouts",
                                 {"satellite_seats": t.get("satellite_seats")}))
        if not problems:
            settled_recent += 1
            continue
        r = ev_record(t, True, "settling")
        r["checks"] = ["payouts", "escrow"] + (["satellite_tickets"] if t["_format"] == "SATELLITE" else [])
        if age > SETTLE_GRACE_S:
            r["state"] = "unsettled"
            for sym, msg, det in problems:
                c.add(sym, "critical", msg, t, details=dict(det, ended_at=iso(ended)))

    # ---- engine-wide checks
    if c.health is None:
        c.add("health_unreachable", "critical", "Engine /health could not be read", None)
    else:
        mg = h.get("memoryGovernor") or {}
        mem = h.get("memory") or {}
        rss = mem.get("rssMb") or mg.get("rssMb")
        hard = mg.get("hardCeilingMb") or 8192
        if rss and rss > hard:
            c.add("engine_memory_over_ceiling", "critical", f"Engine memory {rss} MB is over its {hard} MB ceiling",
                  None, details={"rssMb": rss, "hardCeilingMb": hard, "pressureSince": mg.get("pressureSince"),
                                 "level": mg.get("level"), "mode": mg.get("mode")})
        if (h.get("tournamentManagersQuarantined") or 0) > 0:
            c.add("managers_quarantined", "critical", f"{h['tournamentManagersQuarantined']} tournament manager(s) quarantined",
                  None, details={"quarantined": h.get("quarantinedTournamentManagers")})
        if (h.get("blockedSettlementCount") or 0) > 0:
            c.add("settlements_blocked", "critical", f"{h['blockedSettlementCount']} settlement(s) blocked", None,
                  details={"blocked": h.get("blockedSettlements")})
        if h.get("wholeFleetStalled"):
            c.add("whole_fleet_stalled", "critical", "Engine reports the whole fleet stalled", None)
        if (h.get("tournamentResumesFailing") or 0) > 0:
            c.add("tournament_resumes_failing", "warning", f"{h['tournamentResumesFailing']} tournament resume(s) failing", None)
        tl = h.get("tournamentLease") or {}
        if (tl.get("conflictCount") or 0) > 0 or (tl.get("heartbeatErrors") or 0) > 0:
            c.add("lease_errors", "critical", "Engine reports tournament lease conflicts or heartbeat errors", None,
                  details={k: tl.get(k) for k in ("conflictCount", "claimErrors", "heartbeatErrors", "conflicts")})
        if h.get("status") not in (None, "ok") or h.get("liveness") not in (None, "ok"):
            c.add("engine_not_ok", "critical", f"Engine status {h.get('status')} / liveness {h.get('liveness')}", None)
        for st in (h.get("stalledTables") or []):
            tid = st.get("tableId") if isinstance(st, dict) else str(st)
            ev = by_id.get(table_event.get(tid))
            if ev and not suppress_progress:
                c.add("engine_stalled_table", "critical", "Engine lists this tournament table as stalled", ev,
                      table_id=tid, details={"engine": st})
    if c.metrics is None:
        c.add("telemetry_missing", "critical", "Engine telemetry (/metrics) could not be read", None)
    else:
        g = c.metrics["gauges"]
        if g.get("poker_tournament_metrics_stale_seconds", 0) > 600:
            c.add("telemetry_stale", "warning", "Engine tournament telemetry snapshot is stale", None,
                  details={"stale_seconds": g.get("poker_tournament_metrics_stale_seconds")})
        if g.get("poker_tournament_fleet_unserved", 0) > 0:
            c.add("fleet_unserved", "critical", "Engine leader owns no tournament manager while events are RUNNING", None)
        for k in ("poker_tournament_tables_never_started", "poker_tournament_tables_failing_admission",
                  "poker_tournament_seatless_phantoms", "poker_tournaments_stuck_completing",
                  "poker_tournaments_unpaid_completed"):
            if g.get(k, 0) > 0 and not (suppress_progress and k == "poker_tournament_tables_never_started"):
                c.add("engine_gauge_" + k.replace("poker_", ""), "warning", f"Engine gauge {k} = {g[k]:g}", None,
                      details={k: g[k]})
    # recovery loops on tables not mapped to any event (still tournament-relevant if rebuilt repeatedly)
    for tid, v in rebuild_hist.items():
        if tid not in table_event and len(v) >= RECOVERY_LOOP_N:
            c.add("recovery_loop", "warning", f"Engine rebuilt table {tid[:8]} {len(v)} times in "
                  f"{RECOVERY_LOOP_WINDOW_S // 60} min (table not mapped to a running event)", None, table_id=tid,
                  details={"rebuilds": len(v)})
    for e in c.source_errors:
        if not e.startswith("hand_history table"):
            c.add("monitoring_source_error", "warning", f"Data source problem: {e.split(':')[0]}", None,
                  table_id=e.split(":")[0], details={"error": e})

    # attach log excerpts and releaseSha
    for f in c.candidates:
        eid = f["event_id"]
        f["log_excerpt"] = excerpt(f["table_id"] if f["table_id"] and len(f["table_id"]) == 36 else None,
                                   eid, eid[:8] if eid else None) if not f["test"] else []
        f["releaseSha"] = c.release_sha

    c.suppressed = suppress_progress
    extra = {"maint_active": maint_active, "recovery_active": recovery_active, "last_maint_end": last_maint_end,
             "rebuild_hist": rebuild_hist, "rebuilds_this_cycle": rebuilds_this_cycle, "settled_recent": settled_recent,
             "recent_done": len(recent_done), "supabase_requests": supa.requests, "test_events": len(test_events),
             "maint": maint, "lease_owner": lease_owner, "timings": timings}
    return c, extra


# ----------------------------------------------------------------- findings lifecycle
def reconcile(c, fstate, prev_state, now):
    """Merge this cycle's candidates into the persistent findings state."""
    pending = prev_state.get("soft_pending", {})
    new_pending = {}
    seen = set()
    opened, updated, resolved, transitions = [], [], [], []
    for cand in c.candidates:
        fp = cand["fingerprint"]
        if fp in seen:
            continue
        seen.add(fp)
        cur = fstate.get(fp)
        if cand["symptom"] in SOFT and not (cur and cur["status"] == "open"):
            n = pending.get(fp, 0) + 1
            if n < SOFT_CONFIRM_CYCLES:
                new_pending[fp] = n
                continue
        if cur is None or cur["status"] == "resolved":
            rec = dict(cand)
            rec.update({"status": "open", "first_seen": iso(now), "last_seen": iso(now), "occurrences": 1,
                        "cycles_seen": [c.cycle_no], "reopened": bool(cur)})
            if cur:
                rec["first_seen"] = cur["first_seen"]
                rec["occurrences"] = cur.get("occurrences", 0) + 1
                rec["times_reopened"] = cur.get("times_reopened", 0) + 1
            fstate[fp] = rec
            opened.append(fp)
            transitions.append(("reopened" if cur else "opened", rec))
        else:
            sev_changed = cur["severity"] != cand["severity"]
            cur.update({"last_seen": iso(now), "occurrences": cur.get("occurrences", 1) + 1,
                        "summary": cand["summary"], "details": cand["details"], "severity": cand["severity"],
                        "releaseSha": cand["releaseSha"]})
            if cand["log_excerpt"]:
                cur["log_excerpt"] = cand["log_excerpt"]
            cur["last_cycle"] = c.cycle_no
            updated.append(fp)
            if sev_changed:
                transitions.append(("escalated" if cand["severity"] == "critical" else "deescalated", cur))
    # resolve open findings not seen this cycle (missed-cycle findings resolve after 3 clean cycles)
    for fp, rec in fstate.items():
        if rec["status"] != "open" or fp in seen:
            continue
        if c.suppressed and rec["symptom"] in PROGRESS and rec.get("event_id") in c.events:
            # Progress cannot be judged inside a maintenance / recovery window: hold, do not resolve.
            rec["held_note"] = f"held open through maintenance window at {iso(now)}"
            rec["last_cycle"] = c.cycle_no
            continue
        if rec["symptom"] == "missed_cycle":
            last = parse_ts(rec["last_seen"])
            if last and (now - last).total_seconds() < 3 * INTERVAL_S:
                continue
        rec["status"] = "resolved"
        rec["resolved_at"] = iso(now)
        rec["resolution"] = "condition no longer observed"
        resolved.append(fp)
        transitions.append(("resolved", rec))
    return opened, updated, resolved, transitions, new_pending


def slim(rec):
    keys = ("fingerprint", "status", "severity", "symptom", "summary", "event_id", "event_name", "format",
            "table_id", "first_seen", "last_seen", "occurrences", "details", "log_excerpt", "releaseSha", "test",
            "resolved_at")
    return {k: rec.get(k) for k in keys if k in rec}


# ----------------------------------------------------------------- incident records
# One JSON file per distinct finding fingerprint under incidents/. A record is the source of
# truth for a finding across Claude chat sessions: the checker opens it at first sight, keeps
# last_seen / times_seen / resolved_at current, reopens it when a resolved symptom returns, and
# NEVER deletes or closes it. Only an explicit `incident <fp> --stage Closed` closes a record.
# Since 1.2.0 the checker moves an UNCLAIMED record still at Detected to CLEARED_STAGE once its
# symptom has been absent for CLEAR_AFTER_S, writing the evidence (last seen, minutes clean, release)
# into stage_history. That is a statement that the symptom stopped, never that it was fixed; a
# recurrence reopens the record, and claimed records are left to their owner.
# The checker's own operator-absence finding (no_claude_session) gets no record and is not
# counted as an incident, so it cannot keep itself alive.
NO_RECORD_SYMPTOMS = {"no_claude_session"}
CHECKER_ACTOR = "tournament_monitor"


def incident_path(fp):
    if not re.fullmatch(r"[0-9a-f]{16}", fp or ""):
        raise ValueError(f"not a finding fingerprint: {fp!r}")
    return os.path.join(INCIDENTS, f"{fp}.json")


def load_incident(fp):
    try:
        with open(incident_path(fp)) as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def save_incident(rec):
    os.makedirs(INCIDENTS, exist_ok=True)
    atomic_write(incident_path(rec["fingerprint"]), json.dumps(rec, indent=1, default=str) + "\n")


def list_incidents(open_only=False):
    out = []
    try:
        names = sorted(os.listdir(INCIDENTS))
    except FileNotFoundError:
        names = []
    for name in names:
        if not name.endswith(".json"):
            continue
        rec = load_json(os.path.join(INCIDENTS, name), None)
        if isinstance(rec, dict) and rec.get("fingerprint"):
            if open_only and not incident_is_open(rec):
                continue
            out.append(rec)
    out.sort(key=lambda r: (r.get("severity") != "critical", r.get("first_seen_utc") or ""))
    return out


def incident_is_open(rec):
    return rec.get("stage") not in TERMINAL_STAGES


def _history(stage, now, by, note):
    return {"stage": stage, "at_utc": iso(now), "at_chicago": chi(now), "by": by, "note": note}


def new_incident(finding, now, cycle_no):
    first = parse_ts(finding.get("first_seen")) or now
    return {
        "fingerprint": finding["fingerprint"],
        "symptom": finding.get("symptom"),
        "severity": finding.get("severity"),
        "finding": finding.get("summary"),
        "tournament_id": finding.get("event_id"),
        "tournament_name": finding.get("event_name"),
        "table_id": finding.get("table_id"),
        "format": finding.get("format"),
        "test": bool(finding.get("test")),
        "first_seen_utc": iso(first), "first_seen_chicago": chi(first),
        "last_seen_utc": iso(now), "last_seen_chicago": chi(now),
        "times_seen": max(1, int(finding.get("occurrences") or 1)),
        "times_reopened": 0,
        "resolved_at": None,
        "stage": "Detected",
        "stage_history": [_history("Detected", now, CHECKER_ACTOR, finding.get("summary"))],
        "owner": None,
        "links": {"prs": [], "migrations": [], "releases": []},
        "release_sha_first_seen": finding.get("releaseSha"),
        "details": finding.get("details") or {},
        "created_by_cycle": cycle_no,
        "last_cycle": cycle_no,
    }


def reopen_incident(rec, now, by, note):
    rec["stage"] = "Detected"
    rec["resolved_at"] = None
    rec["times_reopened"] = int(rec.get("times_reopened") or 0) + 1
    rec.setdefault("stage_history", []).append(_history("Reopened", now, by, note))


def sync_incidents(fstate, seen_this_cycle, now, cycle_no):
    """Bring incidents/ in line with this cycle's findings. Returns a summary dict."""
    created, reopened, resolved = [], [], []
    for fp, f in fstate.items():
        if f.get("symptom") in NO_RECORD_SYMPTOMS:
            continue
        rec = load_incident(fp)
        seen = fp in seen_this_cycle and f.get("status") == "open"
        if rec is None:
            rec = new_incident(f, now, cycle_no)
            if f.get("status") == "resolved":
                rec["resolved_at"] = f.get("resolved_at") or iso(now)
            created.append(fp)
            save_incident(rec)
            continue
        changed = False
        if seen:
            if rec.get("resolved_at") is not None or rec.get("stage") in TERMINAL_STAGES:
                was = rec.get("stage")
                reopen_incident(rec, now, CHECKER_ACTOR,
                                f"symptom observed again by cycle {cycle_no} (record was at stage {was}); "
                                f"finding: {f.get('summary')}")
                reopened.append(fp)
            rec["last_seen_utc"], rec["last_seen_chicago"] = iso(now), chi(now)
            rec["times_seen"] = int(rec.get("times_seen") or 0) + 1
            rec["severity"] = f.get("severity")
            rec["finding"] = f.get("summary")
            rec["details"] = f.get("details") or {}
            rec["last_cycle"] = cycle_no
            changed = True
        elif f.get("status") == "resolved" and rec.get("resolved_at") is None:
            rec["resolved_at"] = f.get("resolved_at") or iso(now)
            rec["last_cycle"] = cycle_no
            resolved.append(fp)
            changed = True
        if changed:
            save_incident(rec)
    cleared = clear_quiet_incidents(fstate, now, cycle_no)
    open_recs = list_incidents(open_only=True)
    by_stage = {}
    for r in open_recs:
        by_stage[r["stage"]] = by_stage.get(r["stage"], 0) + 1
    return {"created_this_cycle": created, "reopened_this_cycle": reopened,
            "symptom_resolved_this_cycle": resolved, "cleared_this_cycle": cleared,
            "open_count": len(open_recs), "open_production": sum(1 for r in open_recs if not r.get("test")),
            "unclaimed": sum(1 for r in open_recs if not r.get("owner")),
            "symptom_active": sum(1 for r in open_recs if r.get("resolved_at") is None),
            "by_stage": by_stage}


def clear_quiet_incidents(fstate, now, cycle_no):
    """Move unclaimed Detected records whose symptom has been absent for CLEAR_AFTER_S to CLEARED_STAGE."""
    cleared = []
    for rec in list_incidents(open_only=True):
        if rec.get("stage") != "Detected" or rec.get("owner"):
            continue
        fp = rec["fingerprint"]
        f = fstate.get(fp) or {}
        if f.get("status") == "open":
            continue
        quiet_since = parse_ts(rec.get("resolved_at")) or parse_ts(f.get("resolved_at"))
        if quiet_since is None and not f:
            # the finding is no longer tracked at all (pruned or never resolved in this state file):
            # the last time the checker saw it is the only honest anchor
            quiet_since = parse_ts(rec.get("last_seen_utc"))
        if quiet_since is None:
            continue
        clean_s = int((now - quiet_since).total_seconds())
        if clean_s < CLEAR_AFTER_S:
            continue
        note = (f"checker: symptom not observed for {clean_s // 60} min ({clean_s // INTERVAL_S} clean cycles) "
                f"since {iso(quiet_since)}; last seen {rec.get('last_seen_utc')}; release at last sight "
                f"{f.get('releaseSha') or rec.get('release_sha_first_seen')}. No fix is recorded: the root cause "
                f"is not established. A recurrence reopens this record.")
        rec["stage"] = CLEARED_STAGE
        rec["cleared_at"] = iso(now)
        if rec.get("resolved_at") is None:
            rec["resolved_at"] = iso(quiet_since)
        rec.setdefault("stage_history", []).append(_history(CLEARED_STAGE, now, CHECKER_ACTOR, note))
        rec["last_cycle"] = cycle_no
        save_incident(rec)
        cleared.append(fp)
    return cleared


def advance_incident(fp, stage, by, note, pr=None, migration=None, release=None, owner=None, now=None):
    """Move a record forward one or more stages (or Reopened). Validates order; never deletes."""
    now = now or now_utc()
    rec = load_incident(fp)
    if rec is None:
        raise ValueError(f"no incident record for fingerprint {fp}")
    if not (by or "").strip():
        raise ValueError("--by is required: name the chat session or person advancing the record")
    if not (note or "").strip():
        raise ValueError("--note is required: say what was done or verified at this stage")
    if stage == "Reopened":
        reopen_incident(rec, now, by, note)
    else:
        if stage not in STAGE_INDEX:
            raise ValueError(f"unknown stage {stage!r}; stages in order: {', '.join(STAGES)} (or Reopened)")
        cur = STAGE_INDEX.get(rec.get("stage"), 0)
        new = STAGE_INDEX[stage]
        if new < cur:
            raise ValueError(f"cannot move from {rec['stage']!r} back to {stage!r}; "
                             f"use --stage Reopened if the symptom returned")
        rec["stage"] = stage
        rec.setdefault("stage_history", []).append(_history(stage, now, by, note))
        if stage == "Closed":
            rec["closed_at"] = iso(now)
    if owner:
        rec["owner"] = owner
    elif not rec.get("owner"):
        rec["owner"] = by
    links = rec.setdefault("links", {"prs": [], "migrations": [], "releases": []})
    for key, val in (("prs", pr), ("migrations", migration), ("releases", release)):
        if val is not None:
            links.setdefault(key, [])
            if str(val) not in [str(x) for x in links[key]]:
                links[key].append(val)
    rec["last_updated_utc"] = iso(now)
    save_incident(rec)
    return rec


def claude_heartbeat_age(now):
    """Returns (age_seconds or None, record dict or None). None age = never read."""
    hb = load_json(CLAUDE_HEARTBEAT, None)
    if not isinstance(hb, dict):
        return None, None
    at = parse_ts(hb.get("at_utc"))
    if at is None:
        return None, hb
    return max(0, int((now - at).total_seconds())), hb


def touch_claude_heartbeat(by, now=None):
    now = now or now_utc()
    os.makedirs(STATE, exist_ok=True)
    atomic_write(CLAUDE_HEARTBEAT, json.dumps({"at_utc": iso(now), "at_chicago": chi(now), "by": by}) + "\n")


def _age_text(seconds):
    if seconds is None:
        return "never"
    m = seconds // 60
    if m < 60:
        return f"{m} min"
    h, m = divmod(m, 60)
    if h < 48:
        return f"{h} h {m} min"
    return f"{h // 24} d {h % 24} h"


def handoff_text(now=None):
    """Compact plain-text handoff for the next chat session. Read-only (the caller touches the heartbeat)."""
    now = now or now_utc()
    latest = load_json(os.path.join(STATE, "latest.json"), {})
    window = load_json(os.path.join(BASE, "window.json"), {}) or latest.get("window") or {}
    hb_age, hb = claude_heartbeat_age(now)
    incidents = list_incidents(open_only=True)
    lines = []
    lines.append(f"TOURNAMENT MONITOR HANDOFF  generated {iso(now)} ({chi(now)} Chicago)  monitor {MONITOR_VERSION}")
    lines.append(f"Window: {window.get('status', 'unknown')}; started {window.get('started_chicago')} "
                 f"ends {window.get('ends_chicago')}"
                 + (f"; {window.get('extended_reason')}" if window.get("extended_reason") else ""))
    cov = latest.get("coverage") or {}
    if latest:
        ended = parse_ts(latest.get("ended_utc"))
        age = _age_text(int((now - ended).total_seconds())) if ended else "unknown"
        lines.append(f"Last cycle: #{latest.get('cycle')} at {latest.get('ended_chicago')} Chicago ({age} ago), "
                     f"checked {cov.get('checked')}/{cov.get('expected')} active events, "
                     f"{cov.get('unchecked', 0)} unchecked, by format {cov.get('by_format')}, "
                     f"open findings {((latest.get('findings') or {}).get('open_count'))} "
                     f"(critical {((latest.get('findings') or {}).get('open_critical'))}), "
                     f"engine release {((latest.get('engine') or {}).get('releaseSha'))}")
        if cov.get("source_errors"):
            lines.append(f"  source errors last cycle: {cov['source_errors']}")
    else:
        lines.append("Last cycle: none recorded (state/latest.json missing)")
    lines.append("Previous handoff read: " + ("never" if hb_age is None else f"{_age_text(hb_age)} ago")
                 + (f" by {hb.get('by')}" if hb and hb.get("by") else ""))
    lines.append("")
    if not incidents:
        lines.append("OPEN INCIDENTS: none")
    else:
        lines.append(f"OPEN INCIDENTS: {len(incidents)} "
                     f"({sum(1 for r in incidents if not r.get('owner'))} unclaimed, "
                     f"{sum(1 for r in incidents if r.get('resolved_at') is None)} with the symptom still observed)")
        for r in incidents:
            first = parse_ts(r.get("first_seen_utc"))
            age = _age_text(int((now - first).total_seconds())) if first else "unknown"
            sym_state = ("symptom still observed" if r.get("resolved_at") is None
                         else f"symptom not seen since {r.get('resolved_at')}")
            lines.append(f"- {r['fingerprint']}  [{r.get('severity')}] {r.get('symptom')}"
                         + ("  (TEST)" if r.get("test") else ""))
            lines.append(f"    stage: {r.get('stage')}   owner: {r.get('owner') or 'UNCLAIMED'}   age: {age}   "
                         f"seen {r.get('times_seen')}x, last {r.get('last_seen_chicago')}   {sym_state}"
                         + (f"   reopened {r['times_reopened']}x" if r.get("times_reopened") else ""))
            lines.append(f"    event: {r.get('tournament_name') or '-'} ({r.get('tournament_id') or '-'})"
                         f" {r.get('format') or ''}" + (f"  table {r['table_id']}" if r.get("table_id") else ""))
            lines.append(f"    finding: {r.get('finding')}")
            links = r.get("links") or {}
            if any(links.get(k) for k in ("prs", "migrations", "releases")):
                lines.append(f"    links: prs={links.get('prs') or []} migrations={links.get('migrations') or []} "
                             f"releases={links.get('releases') or []}")
            hist = r.get("stage_history") or []
            if hist:
                h = hist[-1]
                lines.append(f"    last note ({h.get('stage')} by {h.get('by')} at {h.get('at_utc')}): {h.get('note')}")
    cleared = [r for r in list_incidents() if r.get("stage") == CLEARED_STAGE]
    if cleared:
        lines.append("")
        lines.append(f"CLEARED WITHOUT A RECORDED FIX: {len(cleared)} (symptom stopped; root cause not established; "
                     f"a recurrence reopens the record)")
        for r in cleared[:20]:
            lines.append(f"- {r['fingerprint']}  [{r.get('severity')}] {r.get('symptom')}  "
                         f"{r.get('tournament_name') or '-'}  last seen {r.get('last_seen_chicago')}  "
                         f"cleared {r.get('cleared_at')}")
        if len(cleared) > 20:
            lines.append(f"  ... and {len(cleared) - 20} more (python3 tournament_monitor.py incidents)")
    lines.append("")
    lines.append("STAGES (in order): " + " -> ".join(STAGES) + "   (Reopened returns a record to Detected; "
                 f"the checker moves an unclaimed Detected record to '{CLEARED_STAGE}' after "
                 f"{CLEAR_AFTER_S // 60} min without the symptom)")
    lines.append("COMMANDS (run on the engine host, in /opt/tournament-monitor):")
    fp_example = incidents[0]["fingerprint"] if incidents else "<fingerprint>"
    lines.append(f"  claim:    python3 tournament_monitor.py incident {fp_example} --stage Investigating "
                 f"--by '<chat id or name>' --note '<what you are looking at>'")
    lines.append(f"  advance:  python3 tournament_monitor.py incident {fp_example} --stage 'Fix implemented' "
                 f"--by '<who>' --note '<root cause and the change>' [--pr N] [--migration VERSION] [--release SHA]")
    lines.append(f"  close:    python3 tournament_monitor.py incident {fp_example} --stage Closed "
                 f"--by '<who>' --note '<how production and the hardening were verified>'")
    lines.append(f"  reopen:   python3 tournament_monitor.py incident {fp_example} --stage Reopened --by '<who>' --note '<why>'")
    lines.append("  list:     python3 tournament_monitor.py incidents --open")
    lines.append("  record:   cat incidents/<fingerprint>.json")
    lines.append("The record is the source of truth across chats; the checker never closes one. "
                 "A record is not a fix: carry it through the stages by fixing the cause at the root (CLAUDE.md 10.11, 10.12).")
    return "\n".join(lines) + "\n"


def cli_handoff(args):
    text = handoff_text()
    touch_claude_heartbeat(args.by or os.environ.get("TM_READER") or "claude-chat")
    sys.stdout.write(text)
    return 0


def cli_incidents(args):
    recs = list_incidents(open_only=bool(args.open))
    sys.stdout.write(json.dumps(recs, indent=1, default=str) + "\n")
    return 0


def cli_incident(args):
    try:
        rec = advance_incident(args.fingerprint, args.stage, args.by, args.note, pr=args.pr,
                               migration=args.migration, release=args.release, owner=args.owner)
    except ValueError as e:
        sys.stderr.write(f"refused: {e}\n")
        return 2
    sys.stdout.write(json.dumps({"fingerprint": rec["fingerprint"], "stage": rec["stage"], "owner": rec.get("owner"),
                                 "links": rec.get("links"), "resolved_at": rec.get("resolved_at"),
                                 "stage_history_len": len(rec.get("stage_history") or [])}, indent=1) + "\n")
    return 0


def build_parser():
    p = argparse.ArgumentParser(prog="tournament_monitor.py",
                                description="Read-only tournament checker with incident records (no args = one cycle).")
    sub = p.add_subparsers(dest="cmd")
    h = sub.add_parser("handoff", help="print the plain-text handoff and touch state/claude_heartbeat")
    h.add_argument("--by", default=None, help="who is reading (chat id or name); recorded in the heartbeat")
    i = sub.add_parser("incidents", help="print incident records as JSON")
    i.add_argument("--open", action="store_true", help="only records not at stage Closed")
    a = sub.add_parser("incident", help="advance one incident record's stage")
    a.add_argument("fingerprint")
    a.add_argument("--stage", required=True, help="one of: " + ", ".join(STAGES) + ", Reopened")
    a.add_argument("--by", required=True)
    a.add_argument("--note", required=True)
    a.add_argument("--pr", type=int, default=None)
    a.add_argument("--migration", default=None)
    a.add_argument("--release", default=None)
    a.add_argument("--owner", default=None, help="set the owner explicitly (defaults to --by when unclaimed)")
    return p


# ----------------------------------------------------------------- main
def main():
    os.makedirs(STATE, exist_ok=True)
    lockf = open(LOCK, "w")
    try:
        fcntl.flock(lockf, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        t = now_utc()
        log("SKIPPED cycle: lock held by a running cycle")
        append_line(os.path.join(STATE, "cycles.jsonl"),
                    {"type": "skipped", "at_utc": iso(t), "at_chicago": chi(t), "reason": "lock held"})
        return 0
    lockf.write(str(os.getpid()))
    lockf.flush()

    prev = load_json(os.path.join(STATE, "monitor_state.json"), {})
    fstate = load_json(os.path.join(STATE, "findings_state.json"), {})
    window_path = os.path.join(BASE, "window.json")
    window = load_json(window_path, None)
    start = now_utc()

    if window and window.get("status") == "complete":
        log("window complete and no open findings; nothing to do")
        return 0

    cycle_no = int(prev.get("cycle", 0)) + 1
    if not window:
        end = start + dt.timedelta(hours=WINDOW_HOURS)
        window = {"started_utc": iso(start), "started_chicago": chi(start), "ends_utc": iso(end),
                  "ends_chicago": chi(end), "duration_hours": WINDOW_HOURS, "status": "observing",
                  "first_cycle": cycle_no, "authorized": "Dan Bekavac 2026-11-05 13:59 CT",
                  "note": "Persisted at first cycle; restarts never reset it."}
        atomic_write(window_path, json.dumps(window, indent=2))

    # missed-cycle check against the previous heartbeat
    hb_prev = None
    try:
        with open(os.path.join(STATE, "heartbeat")) as f:
            hb_prev = parse_ts(json.loads(f.read()).get("last_success_utc"))
    except Exception:
        pass

    try:
        c, extra = run_cycle(prev)
    except Exception as e:
        log(f"CYCLE FAILED: {type(e).__name__}: {redact(str(e))[:300]}")
        append_line(os.path.join(STATE, "cycles.jsonl"),
                    {"type": "failed", "cycle": cycle_no, "at_utc": iso(start), "at_chicago": chi(start),
                     "error": f"{type(e).__name__}: {redact(str(e))[:300]}"})
        prev["cycle"] = cycle_no
        atomic_write(os.path.join(STATE, "monitor_state.json"), json.dumps(prev))
        return 1
    c.cycle_no = cycle_no
    if hb_prev:
        gap = (start - hb_prev).total_seconds()
        if gap > MISSED_GAP_S:
            c.add("missed_cycle", "warning", f"{int(gap)} s since the previous successful cycle (limit {MISSED_GAP_S} s)",
                  None,
                  details={"gap_seconds": int(gap), "previous_success_utc": iso(hb_prev)})
            c.candidates[-1]["log_excerpt"] = []
            c.candidates[-1]["releaseSha"] = c.release_sha

    # Operator presence is REPORTED (latest.json claude_session), never raised as a finding (1.2.0).
    # The only way to keep a chat reading on a timer would be the Claude scheduler, which CLAUDE.md
    # 10.85 forbids agents to use; a finding that no agent may legitimately clear is a permanent false alarm.
    hb_age, hb_rec = claude_heartbeat_age(start)
    open_before = list_incidents(open_only=True)
    open_before_prod = [r for r in open_before if not r.get("test")]

    end = now_utc()
    opened, updated, resolved, transitions, pending = reconcile(c, fstate, prev, end)
    try:
        incidents = sync_incidents(fstate, set(opened) | set(updated), end, cycle_no)
    except Exception as e:
        log(f"incident records: {type(e).__name__}: {redact(str(e))[:200]}")
        incidents = {"error": f"{type(e).__name__}", "open_count": len(open_before), "open_production": len(open_before_prod),
                     "unclaimed": sum(1 for r in open_before if not r.get("owner")),
                     "created_this_cycle": [], "reopened_this_cycle": [], "symptom_resolved_this_cycle": [],
                     "symptom_active": None, "by_stage": {}}
    fpath = os.path.join(STATE, "findings.jsonl")
    for kind, rec in transitions:
        line = slim(rec)
        line.update({"transition": kind, "cycle": cycle_no, "at_utc": iso(end), "at_chicago": chi(end)})
        append_line(fpath, line)
    # prune resolved findings older than 48h from the state view (history remains in findings.jsonl)
    for fp in [k for k, v in fstate.items() if v["status"] == "resolved"
               and parse_ts(v.get("resolved_at")) and (end - parse_ts(v["resolved_at"])).total_seconds() > 172800]:
        fstate.pop(fp)
    atomic_write(os.path.join(STATE, "findings_state.json"), json.dumps(fstate, indent=1, default=str))

    open_f = [slim(v) for v in fstate.values() if v["status"] == "open"]
    open_f.sort(key=lambda r: (r["severity"] != "critical", r.get("first_seen") or ""))
    open_prod = [f for f in open_f if not f.get("test")]

    # window bookkeeping
    w_end = parse_ts(window["ends_utc"])
    if end >= w_end:
        if open_prod:
            window["status"] = "extended_open_findings"
            window["extended_reason"] = f"{len(open_prod)} finding(s) still open at {chi(end)}"
            window["last_checked_chicago"] = chi(end)
        else:
            window["status"] = "complete"
            window["completed_chicago"] = chi(end)
            window["completed_utc"] = iso(end)
        atomic_write(window_path, json.dumps(window, indent=2))

    events = list(c.events.values())
    active = [e for e in events if e.get("active")]
    counts = {}
    for e in active:
        k = ("TEST_" if e.get("test") else "") + e["format"]
        counts[k] = counts.get(k, 0) + 1
    expected = len(active)
    checked = sum(1 for e in active if e.get("checked"))
    h = c.health or {}
    mem = (h.get("memory") or {})
    latest = {
        "monitor_version": MONITOR_VERSION,
        "cycle": cycle_no,
        "started_utc": iso(start), "started_chicago": chi(start),
        "ended_utc": iso(end), "ended_chicago": chi(end),
        "duration_s": round((end - start).total_seconds(), 1),
        "stage_timings_s": extra["timings"],
        "window": window,
        "engine": {"releaseSha": c.release_sha, "health_ok": c.health is not None,
                   "telemetry_ok": c.metrics is not None,
                   "maintenance_active": extra["maint_active"], "maintenance_phase": (extra["maint"] or {}).get("phase"),
                   "maintenance_reason": (extra["maint"] or {}).get("reason"),
                   "maintenance_ends_utc": iso(ms_ts((extra["maint"] or {}).get("breakEndsAt"))) if extra["maint_active"] else None,
                   "recovery_active": extra["recovery_active"], "rssMb": mem.get("rssMb"),
                   "memory_hard_ceiling_mb": (h.get("memoryGovernor") or {}).get("hardCeilingMb"),
                   "lease_owner": extra["lease_owner"], "uptime_s": h.get("uptime"),
                   "active_tournaments_reported": h.get("activeTournaments"),
                   "zombie_rebuilds_this_cycle": extra["rebuilds_this_cycle"]},
        "coverage": {"expected": expected, "checked": checked, "unchecked": expected - checked,
                     "unchecked_events": [{"id": e["id"], "name": e.get("name"), "reason": e.get("unchecked_reason")}
                                          for e in active if not e.get("checked")],
                     "by_format": counts,
                     "recently_completed_checked": extra["recent_done"],
                     "recently_completed_settled": extra["settled_recent"],
                     "source_errors": c.source_errors,
                     "test_events": extra["test_events"],
                     "definition": "active = REGISTERING starting within 1h (incl. past-start Spin/SNG filling) + every "
                                   "non-terminal status (RUNNING etc.) + COMPLETED in the last "
                                   f"{SETTLE_LOOKBACK_MIN} min that is not yet settled"},
        "findings": {"new_this_cycle": [slim(fstate[f]) for f in opened],
                     "resolved_this_cycle": [slim(fstate[f]) for f in resolved if f in fstate],
                     "open_count": len(open_f), "open_critical": sum(1 for f in open_f if f["severity"] == "critical"),
                     "open": open_f,
                     "soft_pending_confirmation": len(pending)},
        "incidents": dict(incidents, directory=INCIDENTS),
        "claude_session": {"heartbeat_file": CLAUDE_HEARTBEAT,
                           "last_read_utc": (hb_rec or {}).get("at_utc"), "last_reader": (hb_rec or {}).get("by"),
                           "age_s": hb_age, "age_minutes": (hb_age // 60) if hb_age is not None else None,
                           "max_age_s": CLAUDE_HEARTBEAT_MAX_S,
                           "unattended": bool(open_before_prod and (hb_age is None or hb_age > CLAUDE_HEARTBEAT_MAX_S))},
        "events": sorted(events, key=lambda e: (e["format"], e.get("name") or "")),
    }
    atomic_write(os.path.join(STATE, "latest.json"), json.dumps(latest, indent=1, default=str))
    append_line(os.path.join(STATE, "cycles.jsonl"), {
        "type": "cycle", "cycle": cycle_no, "started_utc": iso(start), "started_chicago": chi(start),
        "ended_utc": iso(end), "duration_s": latest["duration_s"], "expected": expected, "checked": checked,
        "by_format": counts, "new_findings": len(opened), "resolved": len(resolved), "open_findings": len(open_f),
        "open_critical": latest["findings"]["open_critical"], "maintenance_active": extra["maint_active"],
        "releaseSha": c.release_sha, "source_errors": len(c.source_errors), "window_status": window["status"],
        "open_incidents": incidents.get("open_count"), "unclaimed_incidents": incidents.get("unclaimed"),
        "claude_heartbeat_age_s": hb_age})
    atomic_write(os.path.join(STATE, "heartbeat"),
                 json.dumps({"last_success_utc": iso(end), "last_success_chicago": chi(end), "cycle": cycle_no}) + "\n")
    new_prev = {"cycle": cycle_no, "last_cycle_start": iso(start), "soft_pending": pending,
                "rebuild_history": extra["rebuild_hist"],
                "last_maintenance_end": iso(extra["last_maint_end"]) if extra["last_maint_end"] else None}
    atomic_write(os.path.join(STATE, "monitor_state.json"), json.dumps(new_prev))
    log(f"cycle {cycle_no} ok: expected={expected} checked={checked} open={len(open_f)} new={len(opened)} "
        f"resolved={len(resolved)} incidents_open={incidents.get('open_count')} "
        f"unclaimed={incidents.get('unclaimed')} claude_hb_age={_age_text(hb_age)} "
        f"{round((end - start).total_seconds(), 1)}s")
    if window["status"] == "complete":
        log("observation window complete with no open findings; stopping the timer")
        subprocess.run(["systemctl", "disable", "--now", "tournament-monitor.timer"], capture_output=True, timeout=20)
    return 0


def entry(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if not argv:
        return main()
    args = build_parser().parse_args(argv)
    if args.cmd == "handoff":
        return cli_handoff(args)
    if args.cmd == "incidents":
        return cli_incidents(args)
    if args.cmd == "incident":
        return cli_incident(args)
    return main()


if __name__ == "__main__":
    sys.exit(entry())
