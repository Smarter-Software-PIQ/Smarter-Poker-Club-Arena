#!/usr/bin/env bash
# Read-only host infrastructure and clock-skew pre-flight check.
#
# STRICT READ-ONLY CONTRACT:
#   - Zero mutations, zero sudo writes, zero SSH key additions.
#   - Remote mode accepts ONLY the Mac's fail-closed SSH aliases:
#     `ca-engine` or `ca-backup` (never raw IPs, never retries refused SSH).
#   - Local mode (`--local`) runs the exact same read-only probe locally.
#
# Exit codes (fail-closed):
#   0  All posture checks healthy
#   1  One or more posture checks failed
#   3  Invalid usage, disallowed host, SSH refusal/error, or unreadable check
set -euo pipefail

MODE=""
HOST_ALIAS=""
DF_PATH="/"
DAEMON_JSON="/etc/docker/daemon.json"
MIN_FREE_GIB="15"
MAX_INODE_PCT="70"
WARN_INODE_PCT=""
MAX_CLOCK_SKEW_MS="250"
MAX_SWAP_USED_PCT="50"
DOCKER_LOG_ROTATION_MODE="fail"
REQUIRE_IMAGES=()

usage() {
  cat >&2 <<'EOF'
Usage: check-host-posture.sh (--local | --host ca-engine|ca-backup) [options]

Options:
  --local                       Run read-only checks on the local host
  --host <ca-engine|ca-backup>  Run read-only checks over fail-closed SSH alias
  --df-path <path>              Filesystem path for disk/inode checks (default: /)
  --daemon-json <path>          Docker daemon.json path (default: /etc/docker/daemon.json)
  --min-free-gib <N>            Minimum free GiB required (default: 15)
  --max-inode-pct <N>           Maximum inode usage percent allowed, strictly < N (default: 70)
  --warn-inode-pct <N>          Optional inode usage percent warning threshold, warn when >= N and < max
  --max-clock-skew-ms <N>       Maximum clock skew in ms allowed, strictly < N (default: 250)
  --max-swap-used-pct <N>       Maximum swap usage percent allowed, strictly < N (default: 50)
  --docker-log-rotation <mode>  Severity for daemon.json log rotation: fail (default) or warn
  --require-image <repo:tag>    Repeatable required local Docker image ref
EOF
}

emit_error_json() {
  local code="$1"
  local mode_val="$2"
  local target_val="$3"
  local msg="$4"
  python3 -B - "$code" "$mode_val" "$target_val" "$msg" <<'PY'
import json, sys
print(json.dumps({
    "schemaVersion": 1,
    "ok": False,
    "exitCode": int(sys.argv[1]),
    "mode": sys.argv[2] or "unknown",
    "target": sys.argv[3] or "unknown",
    "checks": {},
    "failures": [sys.argv[4]],
}, indent=2))
PY
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)
      MODE="local"
      shift
      ;;
    --host)
      if [[ $# -lt 2 ]]; then
        emit_error_json 3 "remote" "" "--host requires an argument (ca-engine or ca-backup)"
        exit 3
      fi
      MODE="remote"
      HOST_ALIAS="$2"
      shift 2
      ;;
    --df-path)
      if [[ $# -lt 2 ]]; then
        emit_error_json 3 "${MODE:-unknown}" "${HOST_ALIAS:-local}" "--df-path requires a value"
        exit 3
      fi
      DF_PATH="$2"
      shift 2
      ;;
    --daemon-json)
      if [[ $# -lt 2 ]]; then
        emit_error_json 3 "${MODE:-unknown}" "${HOST_ALIAS:-local}" "--daemon-json requires a value"
        exit 3
      fi
      DAEMON_JSON="$2"
      shift 2
      ;;
    --min-free-gib)
      if [[ $# -lt 2 ]]; then
        emit_error_json 3 "${MODE:-unknown}" "${HOST_ALIAS:-local}" "--min-free-gib requires a value"
        exit 3
      fi
      MIN_FREE_GIB="$2"
      shift 2
      ;;
    --max-inode-pct)
      if [[ $# -lt 2 ]]; then
        emit_error_json 3 "${MODE:-unknown}" "${HOST_ALIAS:-local}" "--max-inode-pct requires a value"
        exit 3
      fi
      MAX_INODE_PCT="$2"
      shift 2
      ;;
    --warn-inode-pct)
      if [[ $# -lt 2 ]]; then
        emit_error_json 3 "${MODE:-unknown}" "${HOST_ALIAS:-local}" "--warn-inode-pct requires a value"
        exit 3
      fi
      WARN_INODE_PCT="$2"
      shift 2
      ;;
    --max-clock-skew-ms)
      if [[ $# -lt 2 ]]; then
        emit_error_json 3 "${MODE:-unknown}" "${HOST_ALIAS:-local}" "--max-clock-skew-ms requires a value"
        exit 3
      fi
      MAX_CLOCK_SKEW_MS="$2"
      shift 2
      ;;
    --max-swap-used-pct)
      if [[ $# -lt 2 ]]; then
        emit_error_json 3 "${MODE:-unknown}" "${HOST_ALIAS:-local}" "--max-swap-used-pct requires a value"
        exit 3
      fi
      MAX_SWAP_USED_PCT="$2"
      shift 2
      ;;
    --docker-log-rotation)
      if [[ $# -lt 2 ]]; then
        emit_error_json 3 "${MODE:-unknown}" "${HOST_ALIAS:-local}" "--docker-log-rotation requires a value"
        exit 3
      fi
      DOCKER_LOG_ROTATION_MODE="$2"
      shift 2
      ;;
    --require-image)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        emit_error_json 3 "${MODE:-unknown}" "${HOST_ALIAS:-local}" "--require-image requires a non-empty image reference"
        exit 3
      fi
      REQUIRE_IMAGES+=("$2")
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      emit_error_json 3 "${MODE:-unknown}" "${HOST_ALIAS:-local}" "unknown argument: $1"
      exit 3
      ;;
  esac
done

if [[ -z "$MODE" ]]; then
  emit_error_json 3 "unknown" "" "must specify either --local or --host <ca-engine|ca-backup>"
  exit 3
fi

if [[ "$MODE" == "remote" && "$HOST_ALIAS" != "ca-engine" && "$HOST_ALIAS" != "ca-backup" ]]; then
  emit_error_json 3 "remote" "$HOST_ALIAS" "disallowed SSH target: only ca-engine and ca-backup are permitted"
  exit 3
fi

if [[ "$DOCKER_LOG_ROTATION_MODE" != "fail" && "$DOCKER_LOG_ROTATION_MODE" != "warn" ]]; then
  emit_error_json 3 "$MODE" "${HOST_ALIAS:-local}" "invalid --docker-log-rotation mode: must be fail or warn"
  exit 3
fi

# Validate numeric thresholds upfront (fail closed)
if ! python3 -B - "$MIN_FREE_GIB" "$MAX_INODE_PCT" "$MAX_CLOCK_SKEW_MS" "$MAX_SWAP_USED_PCT" "$WARN_INODE_PCT" <<'PY' >/dev/null 2>&1
import math, sys
vals = [float(x) for x in sys.argv[1:5]]
if any(not math.isfinite(v) or v < 0 for v in vals):
    raise SystemExit(1)
warn_raw = sys.argv[5]
if warn_raw != "":
    w = float(warn_raw)
    if not math.isfinite(w) or w < 0 or w > vals[1]:
        raise SystemExit(1)
PY
then
  emit_error_json 3 "$MODE" "${HOST_ALIAS:-local}" "invalid numeric threshold argument"
  exit 3
fi

# Self-contained read-only probe executed locally or over fail-closed SSH stdin.
read -r -d '' PROBE_PY <<'PYEOF' || true
import json
import math
import os
import re
import shutil
import subprocess
import sys

def run_ro(cmd, timeout=10):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError) as exc:
        return None, str(exc)

def check_disk(df_path, min_free_gib):
    res = run_ro(["df", "-Pk", df_path])
    if isinstance(res, tuple) or res.returncode != 0:
        return {"ok": False, "unreadable": True, "error": "df -Pk failed"}
    lines = [l.strip() for l in res.stdout.splitlines() if l.strip()]
    if len(lines) < 2:
        return {"ok": False, "unreadable": True, "error": "df -Pk returned no data row"}
    parts = lines[-1].split()
    if len(parts) < 4:
        return {"ok": False, "unreadable": True, "error": "df -Pk output malformed"}
    try:
        avail_kib = int(parts[3])
    except ValueError:
        return {"ok": False, "unreadable": True, "error": "df -Pk available KiB not integer"}
    free_gib = round(avail_kib / (1024.0 * 1024.0), 2)
    return {
        "ok": free_gib >= min_free_gib,
        "unreadable": False,
        "path": df_path,
        "freeGiB": free_gib,
        "minFreeGiB": min_free_gib,
    }

def check_inodes(df_path, max_inode_pct, warn_inode_pct=None):
    res = run_ro(["df", "-Pi", df_path])
    if isinstance(res, tuple) or res.returncode != 0:
        res = run_ro(["df", "-i", df_path])
    if isinstance(res, tuple) or res.returncode != 0:
        return {"ok": False, "unreadable": True, "error": "df -Pi failed"}
    lines = [l.strip() for l in res.stdout.splitlines() if l.strip()]
    if len(lines) < 2:
        return {"ok": False, "unreadable": True, "error": "df -Pi returned no data row"}
    header = lines[0].split()
    row = lines[-1].split()
    pct_val = None
    # Locate column matching IUse% (Linux) or %iused (macOS)
    for idx, col in enumerate(header):
        low = col.lower()
        if low in ("iuse%", "%iused") and idx < len(row):
            m = re.fullmatch(r"(\d+(?:\.\d+)?)%", row[idx])
            if m:
                pct_val = float(m.group(1))
                break
    if pct_val is None:
        # Fallback: check tokens ending with %; prefer last one before mountpoint
        pct_tokens = [tok for tok in row if re.fullmatch(r"\d+(?:\.\d+)?%", tok)]
        if pct_tokens:
            pct_val = float(pct_tokens[-1][:-1])
    if pct_val is None:
        return {"ok": False, "unreadable": True, "error": "could not parse inode percentage"}
    ok = pct_val < max_inode_pct
    warning = bool(ok and warn_inode_pct is not None and pct_val >= warn_inode_pct)
    out = {
        "ok": ok,
        "warning": warning,
        "unreadable": False,
        "path": df_path,
        "inodeUsedPct": pct_val,
        "maxInodePct": max_inode_pct,
    }
    if warn_inode_pct is not None:
        out["warnInodePct"] = warn_inode_pct
    if warning:
        out["warningMessage"] = f"inode usage {pct_val}% >= warn threshold {warn_inode_pct}% (hard limit < {max_inode_pct}%)"
    return out

def check_clock_skew(max_skew_ms):
    if shutil.which("chronyc"):
        res = run_ro(["chronyc", "tracking"])
        if isinstance(res, tuple) or res.returncode != 0:
            return {"ok": False, "unreadable": True, "source": "chronyc", "error": "chronyc tracking failed"}
        out = res.stdout
        leap_m = re.search(r"Leap status\s*:\s*(.+)", out, re.IGNORECASE)
        if leap_m and "not synchronised" in leap_m.group(1).lower():
            return {"ok": False, "unreadable": False, "source": "chronyc", "synchronized": False, "error": "chrony not synchronised"}
        sys_m = re.search(r"System time\s*:\s*([0-9.eE+-]+)\s+seconds", out, re.IGNORECASE)
        if not sys_m:
            return {"ok": False, "unreadable": True, "source": "chronyc", "error": "could not parse chronyc System time"}
        skew_ms = round(abs(float(sys_m.group(1))) * 1000.0, 3)
        return {
            "ok": skew_ms < max_skew_ms,
            "unreadable": False,
            "source": "chronyc",
            "synchronized": True,
            "skewMs": skew_ms,
            "maxClockSkewMs": max_skew_ms,
        }

    if shutil.which("timedatectl"):
        res = run_ro(["timedatectl", "show", "-p", "NTPSynchronized", "--value"])
        if isinstance(res, tuple) or res.returncode != 0:
            return {"ok": False, "unreadable": True, "source": "timedatectl", "error": "timedatectl show failed"}
        synced = res.stdout.strip().lower() == "yes"
        if not synced:
            return {
                "ok": False,
                "unreadable": False,
                "source": "timedatectl",
                "synchronized": False,
                "skewMs": None,
                "maxClockSkewMs": max_skew_ms,
                "error": "NTPSynchronized is not yes",
            }
        ts = run_ro(["timedatectl", "timesync-status"])
        skew_ms = None
        if not isinstance(ts, tuple) and ts.returncode == 0:
            offset_line = re.search(r"(?m)^\s*Offset:\s*(.+?)\s*$", ts.stdout)
            if offset_line:
                raw_offset = offset_line.group(1).strip()
                s = raw_offset
                if s.startswith(("+", "-")):
                    s = s[1:].strip()
                if not s:
                    parsed_ms = None
                elif re.fullmatch(r"0+(?:\.0+)?", s):
                    parsed_ms = 0.0
                else:
                    unit_ms = {"h": 3600000.0, "min": 60000.0, "s": 1000.0, "ms": 1.0, "us": 0.001}
                    token_re = re.compile(r"([0-9]+(?:\.[0-9]+)?)\s*(h|min|ms|us|s)\b")
                    pos = 0
                    total_ms = 0.0
                    seen = False
                    valid = True
                    for tok in token_re.finditer(s):
                        if s[pos:tok.start()].strip():
                            valid = False
                            break
                        total_ms += float(tok.group(1)) * unit_ms[tok.group(2)]
                        pos = tok.end()
                        seen = True
                    if not valid or not seen or s[pos:].strip():
                        parsed_ms = None
                    else:
                        parsed_ms = round(abs(total_ms), 3)
                if parsed_ms is None:
                    return {
                        "ok": False,
                        "unreadable": True,
                        "source": "timedatectl",
                        "synchronized": True,
                        "skewMs": None,
                        "maxClockSkewMs": max_skew_ms,
                        "error": f"could not parse timedatectl Offset: {raw_offset}",
                    }
                skew_ms = parsed_ms
        if skew_ms is None:
            return {
                "ok": True,
                "unreadable": False,
                "source": "timedatectl",
                "synchronized": True,
                "skewMs": None,
                "maxClockSkewMs": max_skew_ms,
                "note": "NTPSynchronized=yes; offset counter unavailable",
            }
        return {
            "ok": skew_ms < max_skew_ms,
            "unreadable": False,
            "source": "timedatectl",
            "synchronized": True,
            "skewMs": skew_ms,
            "maxClockSkewMs": max_skew_ms,
        }

    return {
        "ok": True,
        "unreadable": False,
        "source": "unavailable",
        "synchronized": None,
        "skewMs": None,
        "maxClockSkewMs": max_skew_ms,
        "note": "neither chronyc nor timedatectl installed on host",
    }

def check_docker_log_rotation(daemon_json_path, mode="fail"):
    try:
        with open(daemon_json_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except OSError as exc:
        msg = f"unable to read daemon.json: {exc.strerror or exc}"
        if mode == "warn":
            return {
                "ok": True,
                "warning": True,
                "unreadable": False,
                "path": daemon_json_path,
                "warningMessage": msg,
            }
        return {
            "ok": False,
            "warning": False,
            "unreadable": False,
            "path": daemon_json_path,
            "error": msg,
        }
    except json.JSONDecodeError as exc:
        return {
            "ok": False,
            "warning": False,
            "unreadable": True,
            "path": daemon_json_path,
            "error": f"malformed daemon.json: {exc.msg}",
        }
    if not isinstance(data, dict):
        return {"ok": False, "warning": False, "unreadable": True, "path": daemon_json_path, "error": "daemon.json is not an object"}
    driver = data.get("log-driver", "json-file")
    log_opts = data.get("log-opts")
    max_size = log_opts.get("max-size") if isinstance(log_opts, dict) else None
    max_file = log_opts.get("max-file") if isinstance(log_opts, dict) else None
    valid_size = isinstance(max_size, str) and bool(re.fullmatch(r"\d+[kmgKMG]?", max_size.strip()))
    compliant = (driver == "json-file") and valid_size
    if compliant:
        return {
            "ok": True,
            "warning": False,
            "unreadable": False,
            "path": daemon_json_path,
            "logDriver": driver,
            "maxSize": max_size,
            "maxFile": max_file,
        }
    if mode == "warn":
        return {
            "ok": True,
            "warning": True,
            "unreadable": False,
            "path": daemon_json_path,
            "logDriver": driver,
            "maxSize": max_size,
            "maxFile": max_file,
            "warningMessage": "daemon.json lacks json-file log-opts.max-size (relying on container --log-opt)",
        }
    return {
        "ok": False,
        "warning": False,
        "unreadable": False,
        "path": daemon_json_path,
        "logDriver": driver,
        "maxSize": max_size,
        "maxFile": max_file,
    }

def check_swap(max_swap_used_pct):
    # Prefer `free -b` if present (Linux and mocked tests)
    if shutil.which("free"):
        res = run_ro(["free", "-b"])
        if not isinstance(res, tuple) and res.returncode == 0:
            for line in res.stdout.splitlines():
                if line.lower().startswith("swap:"):
                    parts = line.split()
                    if len(parts) >= 3:
                        try:
                            total = int(parts[1])
                            used = int(parts[2])
                            pct = 0.0 if total == 0 else round((used / total) * 100.0, 2)
                            return {
                                "ok": True if total == 0 else pct < max_swap_used_pct,
                                "unreadable": False,
                                "source": "free",
                                "swapTotalBytes": total,
                                "swapUsedBytes": used,
                                "swapUsedPct": pct,
                                "maxSwapUsedPct": max_swap_used_pct,
                            }
                        except ValueError:
                            pass
    if os.path.exists("/proc/meminfo"):
        try:
            text = open("/proc/meminfo", "r", encoding="utf-8").read()
            tot_m = re.search(r"^SwapTotal:\s+(\d+)\s+kB", text, re.MULTILINE)
            free_m = re.search(r"^SwapFree:\s+(\d+)\s+kB", text, re.MULTILINE)
            if tot_m and free_m:
                total = int(tot_m.group(1)) * 1024
                used = max(0, total - int(free_m.group(1)) * 1024)
                pct = 0.0 if total == 0 else round((used / total) * 100.0, 2)
                return {
                    "ok": True if total == 0 else pct < max_swap_used_pct,
                    "unreadable": False,
                    "source": "/proc/meminfo",
                    "swapTotalBytes": total,
                    "swapUsedBytes": used,
                    "swapUsedPct": pct,
                    "maxSwapUsedPct": max_swap_used_pct,
                }
        except OSError:
            pass
    if shutil.which("sysctl"):
        res = run_ro(["sysctl", "-n", "vm.swapusage"])
        if not isinstance(res, tuple) and res.returncode == 0:
            tot_m = re.search(r"total\s*=\s*([0-9.]+)([KMGTP]?)", res.stdout, re.IGNORECASE)
            used_m = re.search(r"used\s*=\s*([0-9.]+)([KMGTP]?)", res.stdout, re.IGNORECASE)
            if tot_m and used_m:
                mult = {"": 1, "K": 1024, "M": 1024**2, "G": 1024**3, "T": 1024**4, "P": 1024**5}
                total = int(float(tot_m.group(1)) * mult.get(tot_m.group(2).upper(), 1))
                used = int(float(used_m.group(1)) * mult.get(used_m.group(2).upper(), 1))
                pct = 0.0 if total == 0 else round((used / total) * 100.0, 2)
                return {
                    "ok": True if total == 0 else pct < max_swap_used_pct,
                    "unreadable": False,
                    "source": "sysctl",
                    "swapTotalBytes": total,
                    "swapUsedBytes": used,
                    "swapUsedPct": pct,
                    "maxSwapUsedPct": max_swap_used_pct,
                }
    return {"ok": False, "unreadable": True, "error": "swap telemetry unreadable"}

def check_images(images):
    if not images:
        return {"ok": True, "unreadable": False, "requested": [], "present": [], "missing": []}
    if not shutil.which("docker"):
        return {
            "ok": False,
            "unreadable": True,
            "requested": images,
            "present": [],
            "missing": images,
            "error": "docker CLI not found",
        }
    present = []
    missing = []
    for ref in images:
        res = run_ro(["docker", "image", "inspect", "--format", "{{.Id}}", ref], timeout=15)
        if not isinstance(res, tuple) and res.returncode == 0 and res.stdout.strip():
            present.append({"ref": ref, "id": res.stdout.strip()})
        else:
            missing.append(ref)
    return {
        "ok": len(missing) == 0,
        "unreadable": False,
        "requested": images,
        "present": present,
        "missing": missing,
    }

def main():
    mode = sys.argv[1]
    target = sys.argv[2]
    df_path = sys.argv[3]
    daemon_json = sys.argv[4]
    min_free_gib = float(sys.argv[5])
    max_inode_pct = float(sys.argv[6])
    max_clock_skew_ms = float(sys.argv[7])
    max_swap_used_pct = float(sys.argv[8])
    warn_raw = sys.argv[9]
    warn_inode_pct = float(warn_raw) if warn_raw not in ("", "none") else None
    docker_log_mode = sys.argv[10]
    images = sys.argv[11:]

    checks = {
        "disk": check_disk(df_path, min_free_gib),
        "inode": check_inodes(df_path, max_inode_pct, warn_inode_pct),
        "clockSkew": check_clock_skew(max_clock_skew_ms),
        "dockerLogRotation": check_docker_log_rotation(daemon_json, docker_log_mode),
        "swap": check_swap(max_swap_used_pct),
        "requiredImages": check_images(images),
    }

    failures = []
    warnings = []
    any_unreadable = False
    for name, result in checks.items():
        if result.get("unreadable"):
            any_unreadable = True
        if result.get("warning"):
            wmsg = result.get("warningMessage") or f"{name}: posture warning"
            warnings.append(f"{name}: {wmsg}")
        if not result.get("ok"):
            err = result.get("error")
            if err:
                failures.append(f"{name}: {err}")
            else:
                failures.append(f"{name}: posture check failed")

    if not failures:
        exit_code = 0
    elif any_unreadable:
        exit_code = 3
    else:
        exit_code = 1

    payload = {
        "schemaVersion": 1,
        "ok": exit_code == 0,
        "exitCode": exit_code,
        "mode": mode,
        "target": target,
        "checks": checks,
        "warnings": warnings,
        "failures": failures,
    }
    print(json.dumps(payload, indent=2))
    sys.exit(exit_code)

main()
PYEOF

WARN_INODE_ARG="${WARN_INODE_PCT:-none}"

if [[ "$MODE" == "local" ]]; then
  set +e
  OUT=$(python3 -B - "local" "local" "$DF_PATH" "$DAEMON_JSON" "$MIN_FREE_GIB" "$MAX_INODE_PCT" "$MAX_CLOCK_SKEW_MS" "$MAX_SWAP_USED_PCT" "$WARN_INODE_ARG" "$DOCKER_LOG_ROTATION_MODE" ${REQUIRE_IMAGES[@]+"${REQUIRE_IMAGES[@]}"} <<< "$PROBE_PY")
  RC=$?
  set -e
  printf '%s\n' "$OUT"
  exit "$RC"
fi

# Remote mode: single fail-closed SSH call via sanctioned Mac alias (NEVER retry).
# Quote every remote argument with printf '%q ' and pass sentinel "none" when
# WARN_INODE_PCT is empty so OpenSSH remote shell joining never drops empty args
# or splits/injects paths with spaces.
REMOTE_RC=0
REMOTE_OUT=""
REMOTE_ARGS=$(printf '%q ' "remote" "$HOST_ALIAS" "$DF_PATH" "$DAEMON_JSON" "$MIN_FREE_GIB" "$MAX_INODE_PCT" "$MAX_CLOCK_SKEW_MS" "$MAX_SWAP_USED_PCT" "$WARN_INODE_ARG" "$DOCKER_LOG_ROTATION_MODE" ${REQUIRE_IMAGES[@]+"${REQUIRE_IMAGES[@]}"})
set +e
case "$HOST_ALIAS" in
  ca-engine)
    REMOTE_OUT=$(ssh ca-engine "python3 -B - ${REMOTE_ARGS}" <<< "$PROBE_PY")
    REMOTE_RC=$?
    ;;
  ca-backup)
    REMOTE_OUT=$(ssh ca-backup "python3 -B - ${REMOTE_ARGS}" <<< "$PROBE_PY")
    REMOTE_RC=$?
    ;;
  *)
    emit_error_json 3 "remote" "$HOST_ALIAS" "disallowed SSH target"
    exit 3
    ;;
esac
set -e

if [[ -z "$REMOTE_OUT" || "$REMOTE_RC" -eq 255 ]]; then
  emit_error_json 3 "remote" "$HOST_ALIAS" "SSH connection failed or refused (fail-closed, not retried; rc=${REMOTE_RC})"
  exit 3
fi

printf '%s\n' "$REMOTE_OUT"
exit "$REMOTE_RC"
