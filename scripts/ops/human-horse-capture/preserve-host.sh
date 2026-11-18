#!/bin/bash
# Mac-side control of bounded host preservation (toolkit v3, 2026-11-15, session 01Gw7aDs). All times ISO UTC; epochs only via window.py.
#   preserve-host.sh start  RELEASE8 FROM_ISO END_ISO   (END may be provisional; at most 48 h; installs scripts on the engine host, starts ONE detached job)
#   preserve-host.sh close  RELEASE8 END_ISO            (applies the boundary: END rewritten; the running job finishes the last part and exits DONE)
#   preserve-host.sh status RELEASE8
#   preserve-host.sh stop   RELEASE8                    (STOP file; the job exits before the next part)
# Needs HVH_OPERATOR. Host folders: /root/hvh-work-<R> (scripts, logs, state), /var/lib/club-arena/hvh-preserve-<R> (byte copies + manifests).
# Repository port: the engine host is always the Mac's sanctioned alias (its fail-closed settings live in ~/.ssh/config); HVH_JOURNAL_DIR (journal on the host, default /var/lib/club-arena/horse-decisions; passed to the host job).
set -u; M=${1:?mode}; R=${2:?release8}; T=$(cd "$(dirname "$0")" && pwd); SSH="ssh -o BatchMode=yes -o ConnectTimeout=10 ca-engine"; JDIR=${HVH_JOURNAL_DIR:-/var/lib/club-arena/horse-decisions}
case "$R" in *[!0-9a-z-]*|"") echo "refused: release"; exit 2;; esac; H=/root/hvh-work-$R
[ "$M" = status ] || [[ ${HVH_OPERATOR:-} =~ ^[A-Za-z0-9_.-]{1,80}$ ]] || { echo "refused: HVH_OPERATOR must be [A-Za-z0-9_.-], at most 80"; exit 7; }
[[ $JDIR =~ ^/[A-Za-z0-9._/-]{1,200}$ ]] && [[ $JDIR != *..* ]] || { echo "refused: HVH_JOURNAL_DIR must be an absolute path of [A-Za-z0-9._/-] without .."; exit 7; }
# N3: close and stop act only for the operator that started the job (OPERATOR file; for a job started before it existed, the running job's own argument)
owner(){ local o; o=$($SSH "sudo cat $H/OPERATOR 2>/dev/null || sudo pgrep -fa '^bash $H/preserve-window.sh ' | head -1 | cut -d' ' -f4" < /dev/null); [ -n "$o" ] && [ "$o" = "$HVH_OPERATOR" ] || { echo "refused: $R is operated by '${o:-unknown}', not $HVH_OPERATOR"; exit 7; }; }
case $M in
start) [ -z "${HVH_SHA:-}" ] || [[ $HVH_SHA =~ ^[0-9a-f]{40}$ ]] || { echo "refused: HVH_SHA must be 40 hex"; exit 4; }; [ -z "${HVH_SHA:-}" ] || case "$HVH_SHA" in $R*) ;; *) echo "refused: HVH_SHA does not start with $R"; exit 4;; esac
  read FE EE < <(python3 $T/window.py epochs "$3" "$4") || exit 2
  $SSH "sudo test ! -e $H/FROM" < /dev/null || { echo "refused: $H already started (use close/status)"; exit 9; }
  $SSH "sudo mkdir -p $H && sudo chmod 700 $H && sudo tee $H/preserve-window.sh >/dev/null" < $T/host/preserve-window.sh && $SSH "sudo tee $H/preserve-part.sh >/dev/null" < $T/host/preserve-part.sh || exit 3
  for f in preserve-window.sh preserve-part.sh; do [ "$($SSH "sudo sha256sum $H/$f" < /dev/null | cut -c1-64)" = "$(shasum -a 256 $T/host/$f | cut -c1-64)" ] || { echo "copy mismatch $f"; exit 3; }; done
  $SSH "echo $FE | sudo tee $H/FROM >/dev/null; echo $EE | sudo tee $H/END >/dev/null; echo $HVH_OPERATOR | sudo tee $H/OPERATOR >/dev/null; echo '$3 $4' | sudo tee $H/WINDOW.iso >/dev/null; sudo sh -c 'HVH_JOURNAL_DIR=$JDIR nohup setsid bash $H/preserve-window.sh $HVH_OPERATOR $R > $H/window.nohup 2>&1 < /dev/null &'" < /dev/null
  echo "started $R from $3 ($FE) to $4 ($EE)"
  # v3: retain the release's reader image at declaration (54c9aac8's engine image was pruned before its read). HVH_SHA = full 40-hex source of the window.
  if [ -n "${HVH_SHA:-}" ]; then case "$HVH_SHA" in $R*) ;; *) echo "WARNING: HVH_SHA does not start with $R"; exit 4;; esac
    $SSH "sudo docker image inspect hvh-reader:${HVH_SHA:0:10} >/dev/null 2>&1 || sudo docker tag club-arena-engine:$HVH_SHA hvh-reader:${HVH_SHA:0:10}; sudo docker image inspect --format '{{.Id}} {{json .Config.Labels}}' hvh-reader:${HVH_SHA:0:10} | grep $HVH_SHA" < /dev/null || { echo "WARNING: reader image NOT retained for $HVH_SHA (engine image missing): reconstruct before reading"; exit 4; }
  else echo "WARNING: HVH_SHA not set: reader image not retained"; fi;;
close) F=$($SSH "sudo cat $H/FROM" < /dev/null); [ -n "$F" ] || { echo "refused: not started"; exit 2; }; owner
  read FE EE < <(python3 $T/window.py epochs "$(python3 $T/window.py iso $F)" "$3") || exit 2
  $SSH "echo $EE | sudo tee $H/END.new >/dev/null && sudo mv -f $H/END.new $H/END && echo 'closed END $3 at '\$(date -u +%FT%TZ) | sudo tee -a $H/WINDOW.iso >/dev/null && echo \"\$(date -u +%FT%TZ) CLOSE: END set to $3 ($EE)\" | sudo tee -a $H/window.log >/dev/null" < /dev/null && echo "closed $R at $3 ($EE)" || { echo "close FAILED: END not confirmed on the host"; exit 3; };;
stop) owner; $SSH "sudo touch $H/STOP" < /dev/null && echo "stop requested";;
status) $SSH "sudo cat $H/WINDOW.iso; sudo tail -4 $H/window.log; ls $H/DONE 2>/dev/null; pgrep -fa '^bash $H/preserve-window.sh' || echo 'not running'" < /dev/null;;
*) echo "unknown mode"; exit 2;;
esac
