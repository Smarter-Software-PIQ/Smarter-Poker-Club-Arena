#!/usr/bin/env bash
# Hermetic test of scripts/ops/journal-keep/pull.sh: fake gh, fake curl, fake ssh. No network, no host, no real record.
set -u
HERE=$(cd "$(dirname "$0")" && pwd); PULL=$HERE/../pull.sh
T=$(mktemp -d "${TMPDIR:-/tmp}/journal-keep-test.XXXXXX"); trap 'rm -rf "$T"' EXIT
fails=0; n=0
ok() { n=$((n + 1)); if "$@"; then :; else fails=$((fails + 1)); echo "FAIL $n: ${LABEL:-$*}"; fi; }
mkdir -p "$T/bin" "$T/repo"

cat >"$T/bin/gh" <<'F'
#!/usr/bin/env bash
[ -n "${FAKE_GH_DEAD:-}" ] && exit 1
c=0; [ -f "$FAKE_STATE/gh" ] && c=$(cat "$FAKE_STATE/gh"); echo $((c + 1)) >"$FAKE_STATE/gh"
a="$*"
case "$a" in
  "repo view"*) echo owner/repo ;;
  api*apply-merged-migration.yml*) echo "${FAKE_INSTALLER_A:-active}" ;;
  api*dispatch-merged-migrations.yml*) echo "${FAKE_INSTALLER_B:-active}" ;;
  *auto-deploy-hetzner.yml*conclusion*) echo "${FAKE_SUCCESS:-1}" ;;
  *auto-deploy-hetzner.yml*)
    if [ -n "${FAKE_RECEIVER_AFTER:-}" ] && [ -f "$FAKE_STATE/ssh" ] && [ "$(cat "$FAKE_STATE/ssh")" -ge "$FAKE_RECEIVER_AFTER" ]; then echo 1; else echo "${FAKE_RECEIVERS:-0}"; fi ;;
  *stage-engine-release.yml*) echo "${FAKE_STAGE:-0}" ;;
  "run list -L 40"*) echo "${FAKE_ENGINE_RELEASE:-0}" ;;
  "pr list"*) echo "${FAKE_BOOKING-100 2026-11-21T01:00:00Z}" ;;
  *) exit 1 ;;
esac
F
cat >"$T/bin/curl" <<'F'
#!/usr/bin/env bash
[ -n "${FAKE_CURL_DEAD:-}" ] && exit 7
printf '{"status":"%s","settlementStatus":"%s","stalledTableCount":%s,"maintenance":{"phase":"%s"},"engineStartedAt":"%s","releaseSha":"%s"}\n' \
  "${FAKE_STATUS:-ok}" "${FAKE_SETTLEMENT:-ok}" "${FAKE_STALLED:-0}" "${FAKE_PHASE:-idle}" "${FAKE_STARTED:-2026-11-21T02:00:00.123Z}" "${FAKE_SHA:-aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd}"
F
cat >"$T/bin/ssh" <<'F'
#!/usr/bin/env bash
c=0; [ -f "$FAKE_STATE/ssh" ] && c=$(cat "$FAKE_STATE/ssh"); echo $((c + 1)) >"$FAKE_STATE/ssh"
printf '%s\n' "$*" >>"$FAKE_STATE/ssh.args"
[ -n "${FAKE_SSH_EXIT:-}" ] && exit "$FAKE_SSH_EXIT"
python3 -I -c '
import hashlib,json,os,sys
d=hashlib.sha256(); found=records=0
keys=[k for k in sys.stdin.read().split("\n") if k]
for k in keys:
    if k.startswith("ff"): continue
    found+=1
    for i in range(3):
        sha=hashlib.sha256((k+str(i)).encode()).hexdigest(); d.update(sha.encode()); records+=1
        print(json.dumps({"key":k,"record":{"sha256":sha,"bytes":10,"body":"CARDMARK"}}))
digest=d.hexdigest() if not os.environ.get("FAKE_TAMPER") else "0"*64
print(json.dumps({"summary":{"readerVersion":2,"hands":len(keys),"found":found,"records":records,"bytes":records*10,"errors":0,"digest":digest}}))'
F
chmod +x "$T/bin/"*
base() {
  mkdir -p "$T/state"
  env -i PATH="$PATH" HOME="$T" TMPDIR="$T" FAKE_STATE="$T/state" JK_REPO_DIR="$T/repo" JK_GH="$T/bin/gh" JK_CURL="$T/bin/curl" \
    JK_SSH="$T/bin/ssh host" JK_NOW_HHMM="${HHMM:-1200}" JK_STAGE_CUT=2026-11-21T00:00:00Z "$@"
}
guard_is() { # expected-exit, pattern, then VAR=VALUE...
  local want=$1 pattern=$2; shift 2
  local out rc; out=$(HHMM=${HHMM:-1200} base "$@" bash "$PULL" guard 2>&1); rc=$?
  [ "$rc" = "$want" ] && printf '%s' "$out" | grep -q -- "$pattern"
}

# The guard.
LABEL="guard ok" ok guard_is 0 "guard: ok"
for t in 0305 0400 0445; do LABEL="guard refuses $t" HHMM=$t ok guard_is 75 "inside 03:05-04:45"; done
for t in 0304 0446 0000 2359; do LABEL="guard allows $t" HHMM=$t ok guard_is 0 "guard: ok"; done
LABEL="status" ok guard_is 75 "not ok/ok/0/idle" FAKE_STATUS=degraded
LABEL="settlement" ok guard_is 75 "not ok/ok/0/idle" FAKE_SETTLEMENT=blocked
LABEL="stalled" ok guard_is 75 "not ok/ok/0/idle" FAKE_STALLED=1
LABEL="phase" ok guard_is 75 "not ok/ok/0/idle" FAKE_PHASE=draining
LABEL="health unreadable" ok guard_is 75 "not ok/ok/0/idle" FAKE_CURL_DEAD=1
LABEL="sha unreadable" ok guard_is 75 "unreadable" FAKE_SHA=nothex
LABEL="installer a" ok guard_is 75 "installer apply-merged-migration.yml is disabled_manually" FAKE_INSTALLER_A=disabled_manually
LABEL="installer b" ok guard_is 75 "installer dispatch-merged-migrations.yml" FAKE_INSTALLER_B=disabled_manually
LABEL="receiver" ok guard_is 75 "deploy receiver run(s) not completed" FAKE_RECEIVERS=1
LABEL="engine release" ok guard_is 75 "Engine Release run(s) not completed" FAKE_ENGINE_RELEASE=2
LABEL="stage" ok guard_is 75 "Stage Engine Release dispatch" FAKE_STAGE=1
LABEL="unsealed: no success" ok guard_is 75 "no successful deploy receiver after it (window open)" FAKE_SUCCESS=0
LABEL="unsealed: engine older than merge" ok guard_is 75 "before booking #100 merged" FAKE_STARTED=2026-11-21T00:59:59.999Z
LABEL="booking unreadable" ok guard_is 75 "newest merged booking is unreadable" FAKE_BOOKING=
LABEL="gh dead" ok guard_is 75 "repository unreadable" FAKE_GH_DEAD=1

# A pull.
keys() { python3 -I -c 'import hashlib,sys
for i in range(int(sys.argv[1])): print(("ff" if i==5 else "")+hashlib.sha256(str(i).encode()).hexdigest()[: 62 if i==5 else 64], "label", i)' "$1"; }
keys 40 >"$T/keys"
rm -rf "$T/state"; out=$(base bash "$PULL" pull "$T/dest" "$T/keys" keep 2>&1); rc=$?
LABEL="pull exits 0" ok [ "$rc" = 0 ]
LABEL="three batches" ok [ "$(ls "$T/dest/rec" | tr '\n' ' ')" = "b00000.jsonl.gz b00001.jsonl.gz b00002.jsonl.gz " ]
LABEL="three host calls" ok [ "$(cat "$T/state/ssh")" = 3 ]
LABEL="private files" ok [ "$(stat -c %a "$T/dest/rec/b00000.jsonl.gz" 2>/dev/null || stat -f %Lp "$T/dest/rec/b00000.jsonl.gz")" = 600 ]
LABEL="private dir" ok [ "$(stat -c %a "$T/dest" 2>/dev/null || stat -f %Lp "$T/dest")" = 700 ]
LABEL="records are in the file" ok [ "$(gzip -dc "$T/dest/rec/b00000.jsonl.gz" | grep -c CARDMARK)" = 45 ]
LABEL="no record on the terminal" ok [ "$(printf '%s' "$out" | grep -c CARDMARK)" = 0 ]
LABEL="no record in the log" ok [ "$(grep -c CARDMARK "$T/dest/pull.log")" = 0 ]
LABEL="log has counts" ok grep -q "b00000 hands=16 found=15 records=45" "$T/dest/pull.log"
LABEL="the keep store is what is mounted" ok grep -q -- "-v /var/lib/club-arena/horse-decisions/keep:/j:ro" "$T/state/ssh.args"
LABEL="read-only, no network" ok grep -q -- "--network none --read-only" "$T/state/ssh.args"
LABEL="reader image of the serving release" ok grep -q -- "hvh-reader:aaaaaaaaaa " "$T/state/ssh.args"
out=$(base bash "$PULL" pull "$T/dest" "$T/keys" keep 2>&1); rc=$?
LABEL="a rerun copies nothing again" ok [ "$rc" = 0 -a "$(cat "$T/state/ssh")" = 3 ]
rm -rf "$T/state" "$T/dest"; base bash "$PULL" pull "$T/dest" "$T/keys" main >/dev/null 2>&1
LABEL="main store mount" ok grep -q -- "-v /var/lib/club-arena/horse-decisions:/j:ro" "$T/state/ssh.args"

# The guard closes during a pull: it stops, it does not wait, and a later run by hand finishes.
rm -rf "$T/state" "$T/dest"; start=$(date +%s)
out=$(base FAKE_RECEIVER_AFTER=1 bash "$PULL" pull "$T/dest" "$T/keys" keep 2>&1); rc=$?
LABEL="stops with 75 when a receiver starts" ok [ "$rc" = 75 ]
LABEL="one batch kept, nothing partial" ok [ "$(ls "$T/dest/rec" | tr '\n' ' ')" = "b00000.jsonl.gz " ]
LABEL="one host call only" ok [ "$(cat "$T/state/ssh")" = 1 ]
LABEL="it did not wait" ok [ "$(($(date +%s) - start))" -lt 20 ]
LABEL="log says why" ok grep -q "STOP guard refused before b00001" "$T/dest/pull.log"
out=$(base bash "$PULL" pull "$T/dest" "$T/keys" keep 2>&1); rc=$?
LABEL="the rerun finishes the rest" ok [ "$rc" = 0 -a "$(cat "$T/state/ssh")" = 3 -a "$(ls "$T/dest/rec" | wc -l | tr -d ' ')" = 3 ]

# Refused before the first batch: the host is never reached.
rm -rf "$T/state" "$T/dest"; base FAKE_PHASE=break bash "$PULL" pull "$T/dest" "$T/keys" keep >/dev/null 2>&1; rc=$?
LABEL="guard refused at start: 75, host untouched" ok [ "$rc" = 75 -a ! -f "$T/state/ssh" ]
rm -rf "$T/state" "$T/dest"; HHMM=0330 base bash "$PULL" pull "$T/dest" "$T/keys" keep >/dev/null 2>&1; rc=$?
LABEL="03:30: 75, host untouched" ok [ "$rc" = 75 -a ! -f "$T/state/ssh" ]

# Host busy, a failed reader, a stream that does not verify.
rm -rf "$T/state" "$T/dest"; base FAKE_SSH_EXIT=76 bash "$PULL" pull "$T/dest" "$T/keys" keep >/dev/null 2>&1; rc=$?
LABEL="host busy: 76, nothing kept" ok [ "$rc" = 76 -a -z "$(ls "$T/dest/rec")" ]
rm -rf "$T/state" "$T/dest"; base FAKE_SSH_EXIT=1 bash "$PULL" pull "$T/dest" "$T/keys" keep >/dev/null 2>&1; rc=$?
LABEL="failed reader: 1, nothing kept" ok [ "$rc" = 1 -a -z "$(ls "$T/dest/rec")" ]
rm -rf "$T/state" "$T/dest"; base FAKE_TAMPER=1 bash "$PULL" pull "$T/dest" "$T/keys" keep >/dev/null 2>&1; rc=$?
LABEL="unverified stream: 1, nothing kept" ok [ "$rc" = 1 -a -z "$(ls "$T/dest/rec")" ]

# Arguments.
rm -rf "$T/state"; (cd "$T/repo" && git init -q . 2>/dev/null); base bash "$PULL" pull "$T/repo/out" "$T/keys" keep >/dev/null 2>&1; rc=$?
LABEL="DEST inside a git checkout is refused, host untouched" ok [ "$rc" = 1 -a ! -f "$T/state/ssh" ]
echo "not-a-key" >"$T/badkeys"; base bash "$PULL" pull "$T/d2" "$T/badkeys" keep >/dev/null 2>&1; rc=$?
LABEL="bad keys refused" ok [ "$rc" = 1 ]
{ keys 2; echo "zz"; } >"$T/mixed"; base bash "$PULL" pull "$T/d3" "$T/mixed" keep >/dev/null 2>&1; rc=$?
LABEL="a file with a non-key line is refused whole" ok [ "$rc" = 1 -a ! -f "$T/state/ssh" ]
base bash "$PULL" pull "$T/d4" "$T/keys" elsewhere >/dev/null 2>&1; LABEL="unknown store refused" ok [ "$?" = 1 ]
base bash "$PULL" pull relative "$T/keys" keep >/dev/null 2>&1; LABEL="relative DEST refused" ok [ "$?" = 1 ]
base bash "$PULL" >/dev/null 2>&1; LABEL="no mode refused" ok [ "$?" = 1 ]

# It cannot wait, and it does not read the coordination inbox.
code=$(grep -v '^[[:space:]]*#' "$PULL")
LABEL="no sleep, no polling loop" ok [ "$(printf '%s\n' "$code" | grep -c -E '(^|[^A-Za-z])(sleep|until|watch|inotifywait|fswatch|nohup|screen|crontab|launchctl)([^A-Za-z]|$)|while true|while :')" = 0 ]
LABEL="no inbox wording" ok [ "$(printf '%s\n' "$code" | grep -c -E 'COORDINATION-INBOX|SUBJECT:|SEALED|BOOKING MERGED|extreme-archive')" = 0 ]
LABEL="one loop, over the batches" ok [ "$(printf '%s\n' "$code" | grep -c -E '^[[:space:]]*while ')" = 1 ]

echo "journal-keep pull: $((n - fails))/$n passed"; [ "$fails" = 0 ]
