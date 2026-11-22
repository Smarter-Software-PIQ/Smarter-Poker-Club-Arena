#!/usr/bin/env bash
# COPY HORSE JOURNAL RECORDS OFF THE ENGINE HOST, BY HAND, ONLY WHEN THE RELEASE RULES ALLOW IT (2026-11-21, lane JOURNAL-KEEP).
#
#   pull.sh guard                              print the guard's verdict; touches nothing on the host
#   pull.sh pull DEST KEYS [keep|main] [SHA40] copy the hands named in KEYS into DEST
#
# WHY. The journal is a ring on the engine host (72 h) and the keep store beside it holds the hands a person sat in
# (server/src/services/horseDecisionJournal/keep.ts). Neither is off the host. This is the off-host leg: a person
# starts it on the Mac; it reads through the release's own read-only reader image and writes private files here.
#
# IT NEVER WAITS. The guard runs before the first batch and again before every batch. If any clause is false the
# script says which one and EXITS 75; it does not sleep, poll, retry or post anywhere, and nothing restarts it.
# Run it again by hand when the window has sealed. What it has copied stays; a rerun skips finished batches.
#
# THE GUARD (all must hold; a clause that cannot be read is false):
#   1. Chicago time is outside 03:05-04:45.
#   2. Engine /health: status ok, settlementStatus ok, no stalled table, maintenance phase idle.
#   3. The migration installers are active (apply-merged-migration.yml, dispatch-merged-migrations.yml): no hold.
#   4. No deploy receiver is running (auto-deploy-hetzner.yml, any "Engine Release" run) and no Stage Engine Release
#      was dispatched by hand in the last 45 minutes.
#   5. No window is open: the newest MERGED pull request that changes server/release/owner-maintenance-windows.json
#      (a booking) has been followed by a deploy receiver run that completed successfully, and the serving engine
#      started after that merge. Read from GitHub and /health, never from the wording of a coordination post.
#
# ON THE HOST it runs one throwaway container per batch, exactly as the reader image is proved
# (scripts/ops/journal-reader/publish-reader-image.sh): --network none, --read-only, the store mounted :ro, one CPU,
# nice 19, a time limit. It writes nothing on the host, not even a scratch file: the records stream back over the
# same ssh connection. It refuses a host whose load is 14 or more (exit 76; again, no waiting).
#
# CARDS. A journal record holds what the journal holds. This script never prints a record: records go only into
# DEST/rec/*.jsonl.gz (mode 0600, DEST 0700); the terminal and DEST/pull.log get counts and digests only. DEST must
# be outside every git checkout.
#
# KEYS: one journal hand key per line (64 lowercase hex, the key readHorseJournalHandRecords takes); anything after
# the first blank is ignored, so a label may follow. At most 16 hands a batch.
#
# Exit: 0 done; 75 the guard refused; 76 host busy; 1 refused arguments or a failed batch.
set -u
umask 077
MODE=${1:-}
REPO_DIR=${JK_REPO_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}
SSH=${JK_SSH:-ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 ca-engine}
GH=${JK_GH:-gh}
CURL=${JK_CURL:-curl}
HEALTH_URL=${JK_HEALTH_URL:-https://engine.smarter.poker/health}
JOURNAL=${JK_JOURNAL:-/var/lib/club-arena/horse-decisions}
DOCKER=${JK_DOCKER:-docker}
BATCH=16
say() { printf '[journal-keep] %s\n' "$*" >&2; }
die() { say "REFUSED: $*"; exit 1; }
ghq() { (cd "$REPO_DIR" && $GH "$@") 2>/dev/null; }

HEALTH_SHA=
guard() {
  local hhmm health st set_ stalled phase started sha repo wf state n cut booking merged ok
  # 1. the nightly window
  hhmm=${JK_NOW_HHMM:-$(TZ=America/Chicago date +%H%M)}
  [[ $hhmm =~ ^[0-9]{4}$ ]] || { say "guard: clock unreadable"; return 1; }
  if [ "$((10#$hhmm))" -ge 305 ] && [ "$((10#$hhmm))" -le 445 ]; then
    say "guard: $hhmm Chicago is inside 03:05-04:45"; return 1
  fi
  # 2. the engine
  health=$($CURL -s -m 15 "$HEALTH_URL" 2>/dev/null | python3 -I -c '
import json,sys
h=json.load(sys.stdin); m=h["maintenance"]
print(h["status"], h["settlementStatus"], h["stalledTableCount"], m["phase"], h["engineStartedAt"], h["releaseSha"])' 2>/dev/null)
  read -r st set_ stalled phase started sha <<<"$health"
  if [ "${st:-}" != ok ] || [ "${set_:-}" != ok ] || [ "${stalled:-}" != 0 ] || [ "${phase:-}" != idle ]; then
    say "guard: engine health is not ok/ok/0/idle (${st:-unreadable} ${set_:-} ${stalled:-} ${phase:-})"; return 1
  fi
  [[ ${sha:-} =~ ^[0-9a-f]{40}$ ]] && [[ ${started:-} =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$ ]] ||
    { say "guard: engine release or start time unreadable"; return 1; }
  HEALTH_SHA=$sha
  # 3. the installers
  repo=$(ghq repo view --json nameWithOwner --jq .nameWithOwner)
  [[ ${repo:-} =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || { say "guard: repository unreadable"; return 1; }
  for wf in apply-merged-migration.yml dispatch-merged-migrations.yml; do
    state=$(ghq api "repos/$repo/actions/workflows/$wf" --jq .state)
    [ "${state:-}" = active ] || { say "guard: installer $wf is ${state:-unreadable} (a hold is in force)"; return 1; }
  done
  # 4. receivers
  n=$(ghq run list --workflow auto-deploy-hetzner.yml -L 30 --json status --jq '[.[]|select(.status!="completed")]|length')
  [ "${n:-x}" = 0 ] || { say "guard: ${n:-unreadable} deploy receiver run(s) not completed"; return 1; }
  n=$(ghq run list -L 40 --json name,status --jq '[.[]|select((.name|startswith("Engine Release")) and .status!="completed")]|length')
  [ "${n:-x}" = 0 ] || { say "guard: ${n:-unreadable} Engine Release run(s) not completed"; return 1; }
  cut=${JK_STAGE_CUT:-$(date -u -v-45M +%FT%TZ 2>/dev/null || date -u -d '45 minutes ago' +%FT%TZ)}
  n=$(ghq run list --workflow stage-engine-release.yml -L 20 --json event,createdAt --jq "[.[]|select(.event==\"workflow_dispatch\" and .createdAt>\"$cut\")]|length")
  [ "${n:-x}" = 0 ] || { say "guard: ${n:-unreadable} Stage Engine Release dispatch(es) in the last 45 minutes"; return 1; }
  # 5. no open window
  booking=$(ghq pr list --state merged --limit 40 --json number,mergedAt,files --jq '[.[]|select(any(.files[]; .path=="server/release/owner-maintenance-windows.json"))]|sort_by(.mergedAt)|last|"\(.number) \(.mergedAt)"')
  read -r n merged <<<"${booking:-}"
  [[ ${n:-} =~ ^[0-9]+$ ]] && [[ ${merged:-} =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+Z$ ]] ||
    { say "guard: the newest merged booking is unreadable"; return 1; }
  ok=$(ghq run list --workflow auto-deploy-hetzner.yml -L 30 --json status,conclusion,createdAt --jq "[.[]|select(.status==\"completed\" and .conclusion==\"success\" and .createdAt>\"$merged\")]|length")
  [[ ${ok:-} =~ ^[0-9]+$ ]] && [ "$ok" -ge 1 ] ||
    { say "guard: booking #$n merged $merged has no successful deploy receiver after it (window open)"; return 1; }
  [[ ${started%%.*}Z > $merged ]] ||
    { say "guard: the engine started $started, before booking #$n merged $merged (window open)"; return 1; }
  say "guard: ok (Chicago $hhmm; serving ${sha:0:12} since $started; newest booking #$n merged $merged, sealed)"
  return 0
}

if [ "$MODE" = guard ]; then
  guard && exit 0
  exit 75
fi
[ "$MODE" = pull ] || die "usage: pull.sh guard | pull.sh pull DEST KEYS [keep|main] [SHA40]"
DEST=${2:-}; KEYS=${3:-}; STORE=${4:-keep}; ARG_SHA=${5:-}
[[ $DEST =~ ^/[A-Za-z0-9._/-]{1,200}$ ]] && [[ $DEST != *..* ]] || die "DEST must be an absolute path of [A-Za-z0-9._/-]"
[ -f "$KEYS" ] || die "KEYS file not found"
[ "$STORE" = keep ] || [ "$STORE" = main ] || die "store is keep or main"
[ -z "$ARG_SHA" ] || [[ $ARG_SHA =~ ^[0-9a-f]{40}$ ]] || die "SHA40 must be 40 lowercase hex"
[[ $JOURNAL =~ ^/[A-Za-z0-9._/-]{1,200}$ ]] && [[ $JOURNAL != *..* ]] || die "journal path refused"
mkdir -p "$DEST/rec" || die "cannot create DEST"
chmod 700 "$DEST" "$DEST/rec"
if (cd "$DEST" && git rev-parse --is-inside-work-tree >/dev/null 2>&1); then die "DEST is inside a git checkout"; fi
LOG=$DEST/pull.log
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >>"$LOG"; }
KEYLIST=$(mktemp "$DEST/.keys.XXXXXX") || die "cannot write in DEST"
trap 'rm -f "$KEYLIST" "$DEST"/rec/*.part 2>/dev/null' EXIT
awk '{print $1}' "$KEYS" | grep -E '^[0-9a-f]{64}$' | awk '!seen[$0]++' >"$KEYLIST"
TOTAL=$(grep -c '' "$KEYLIST")
[ "$TOTAL" -ge 1 ] || die "KEYS holds no 64-hex hand key"
[ "$TOTAL" = "$(grep -c '[^[:space:]]' "$KEYS")" ] || die "KEYS holds lines that are not one 64-hex hand key (or repeats)"
MOUNT=$JOURNAL; [ "$STORE" = keep ] && MOUNT=$JOURNAL/keep

# The reader: counts on the last line, records before it. Nothing but the store is read; nothing is written.
READER='
import {readHorseJournalHandRecords, HORSE_JOURNAL_HAND_READER_VERSION} from "/app/dist/services/horseDecisionJournal/review.js";
import {createHash} from "node:crypto";
if (HORSE_JOURNAL_HAND_READER_VERSION !== 2) throw Error("reader_refused");
let input=""; for await (const c of process.stdin) input+=c;
const keys=input.split("\n").filter(Boolean);
if (keys.length<1 || keys.length>16 || keys.some((k)=>!/^[0-9a-f]{64}$/.test(k))) throw Error("selection_bound");
const digest=createHash("sha256"); let found=0, records=0, bytes=0, errors=0; const started=Date.now();
for (const key of keys) {
  if (Date.now()-started > 240000) throw Error("time_bound");
  let rs; try { rs=readHorseJournalHandRecords(process.env.HORSE_DECISION_JOURNAL_DIR,key); } catch { errors++; continue; }
  if (rs.length) found++;
  for (const record of rs) { records++; bytes+=record.bytes; digest.update(record.sha256); process.stdout.write(JSON.stringify({key,record})+"\n"); }
}
process.stdout.write(JSON.stringify({summary:{readerVersion:2,hands:keys.length,found,records,bytes,errors,digest:digest.digest("hex")}})+"\n");
'
# Sent as base64 so no shell on either side ever interprets it.
READER_B64=$(printf '%s' "$READER" | base64 | tr -d '\n')
[[ $READER_B64 =~ ^[A-Za-z0-9+/=]+$ ]] || die "reader encoding failed"
VERIFY='
import gzip,hashlib,json,sys
d=hashlib.sha256(); n=0; summary=None
with gzip.open(sys.argv[1],"rt") as f:
    for line in f:
        o=json.loads(line)
        if "summary" in o: summary=o["summary"]; continue
        if summary is not None: raise SystemExit("records after the summary")
        d.update(o["record"]["sha256"].encode()); n+=1
if summary is None or summary["records"]!=n or summary["digest"]!=d.hexdigest(): raise SystemExit("summary does not match the records")
print(summary["hands"], summary["found"], summary["records"], summary["bytes"], summary["errors"], summary["digest"][:16])
'
say "pull: $TOTAL hands from the $STORE store into $DEST"
log "START store=$STORE hands=$TOTAL"
i=0; done_=0; copied_hands=0; copied_found=0
while [ "$i" -lt "$TOTAL" ]; do
  name=$(printf 'b%05d' "$((i / BATCH))")
  out=$DEST/rec/$name.jsonl.gz
  if [ -s "$out" ]; then i=$((i + BATCH)); done_=$((done_ + 1)); continue; fi
  if ! guard; then log "STOP guard refused before $name"; say "stopped before $name; run again by hand after the seal"; exit 75; fi
  SHA=${ARG_SHA:-$HEALTH_SHA}
  remote="l=\$(cut -d' ' -f1 /proc/loadavg); awk -v l=\"\$l\" 'BEGIN{exit !(l<14)}' || exit 76; timeout 300 nice -n 19 $DOCKER run --rm -i --network none --read-only --cpus 1 --memory 1g --tmpfs /tmp:size=16m -e HORSE_DECISION_JOURNAL_DIR=/j -e GIT_COMMIT_SHA=$SHA -v $MOUNT:/j:ro --entrypoint node hvh-reader:${SHA:0:10} --max-old-space-size=768 --input-type=module -e \"\$(printf %s $READER_B64 | base64 -d)\""
  sed -n "$((i + 1)),$((i + BATCH))p" "$KEYLIST" | $SSH "$remote" 2>>"$LOG.err" | gzip -c >"$out.part"
  rc=${PIPESTATUS[1]}
  if [ "$rc" = 76 ]; then rm -f "$out.part"; log "STOP host busy before $name"; say "engine host load is 14 or more; stopped"; exit 76; fi
  if [ "$rc" != 0 ]; then rm -f "$out.part"; log "FAILED $name ssh/reader exit $rc"; die "batch $name failed (exit $rc); see pull.log.err"; fi
  line=$(python3 -I -c "$VERIFY" "$out.part" 2>>"$LOG.err") || { rm -f "$out.part"; log "FAILED $name verification"; die "batch $name did not verify"; }
  mv "$out.part" "$out"; chmod 600 "$out"
  read -r hands found records bytes errors digest <<<"$line"
  log "$name hands=$hands found=$found records=$records bytes=$bytes errors=$errors digest=$digest"
  copied_hands=$((copied_hands + hands)); copied_found=$((copied_found + found))
  i=$((i + BATCH)); done_=$((done_ + 1))
done
log "DONE batches=$done_ thisRunHands=$copied_hands thisRunFound=$copied_found"
say "done: $done_ batches present; this run read $copied_hands hands, $copied_found with records (missing hands are not in the $STORE store)"
exit 0
