#!/bin/zsh
# Every 5 minutes under launchd (com.smarter-poker.ops-heartbeat): reports this
# Mac's health to smarter_private.record_host_heartbeat('ops-mac-studio', ...).
# A silence over 15 minutes raises a critical Production Alert.
#
# EVERY INSTALL-QUEUE ALERT CLEARS ON ITS OWN CONDITION (2026-11-24): the queue
# raised InstallQueueServiceDown and InstallQueueJobFailed and nothing ever
# resolved them. This heartbeat now measures both conditions each run and
# resolves through public.fn_resolve_operational_alerts:
#   - queue-down:ops-mac-studio:*  when the install-queue process is running;
#   - failed:<job>                 when the job's migration version is recorded in
#                                  supabase_migrations.schema_migrations (installed
#                                  since), or the job ended because its PR closed
#                                  without merge (nothing left to install).
Q=~/.smarter-poker/install-queue; O=~/.smarter-poker/ops
J=$(python3 - <<'PY'
import json, os, subprocess, time, glob
import importlib.util
def disks():
    # A missing or broken disk_report.py must never silence the heartbeat.
    try:
        s=importlib.util.spec_from_file_location('disk_report',os.path.expanduser('~/.smarter-poker/ops/disk_report.py'))
        m=importlib.util.module_from_spec(s); s.loader.exec_module(m); return m.report()
    except Exception as e: return {"error": ("disk_report.py: "+str(e))[:120]}
boot=subprocess.run(['sysctl','-n','kern.boottime'],capture_output=True,text=True).stdout
try: up=int(time.time())-int(boot.split('sec =')[1].split(',')[0])
except Exception: up=None
q=os.path.expanduser('~/.smarter-poker/install-queue')
alive=subprocess.run(['pgrep','-f','install-queue.sh'],capture_output=True).returncode==0
claude=subprocess.run(['pgrep','-x','Claude'],capture_output=True).returncode==0
print(json.dumps({"uptime_s":up,"load":os.getloadavg()[0],
 "disks":disks(),
 "install_queue":{"service_alive":alive,"pending":len(glob.glob(q+'/pending/*.job')),"running":len(glob.glob(q+'/running/*.job'))},
 "claude_app_running":claude}))
PY
)
L=~/.smarter-poker/logs/heartbeat.log
[ -f $L ] && [ $(stat -f %z $L) -gt 5242880 ] && mv -f $L $L.1
echo "SELECT smarter_private.record_host_heartbeat('ops-mac-studio', :'d'::jsonb);" | $O/db.sh -v "d=$J" -f - >> $L 2>&1
rc=$?
echo "$(date -u +%FT%TZ) rc=$rc $J" >> $L
# A drive that is not mounted has no free_pct (disk_report.py), so the
# database's under-5% check cannot see it; say so here, once a day per volume.
for V in $(print -r -- "$J" | python3 -c 'import json,sys; d=json.load(sys.stdin)["disks"]; print(" ".join(k for k,v in d.items() if isinstance(v,dict) and v.get("mounted") is False))'); do
  K="volume-not-mounted:ops-mac-studio:$V:$(TZ=America/Chicago date +%Y%m%d)"
  echo "SELECT public.fn_record_operational_alert('host-heartbeat', :'k', 'HostVolumeNotMounted', 'firing', 'warning', jsonb_build_object('target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca','host','ops-mac-studio','volume',:'v'));" | $O/db.sh -v "k=$K" -v "v=$V" -f - >> $L 2>&1
done
# The install queue must always be running; launchd restarts it, and if it is
# down at a heartbeat anyway, restart it and raise one alert per hour.
if ! pgrep -f 'ops/install-queue.sh' >/dev/null; then
  launchctl print gui/$(id -u)/com.smarter-poker.install-queue >/dev/null 2>&1 || launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.smarter-poker.install-queue.plist >> $L 2>&1
  launchctl kickstart gui/$(id -u)/com.smarter-poker.install-queue >> $L 2>&1
  K="queue-down:ops-mac-studio:$(date -u +%Y%m%dT%H)"
  echo "SELECT public.fn_record_operational_alert('install-queue', :'k', 'InstallQueueServiceDown', 'firing', 'critical', jsonb_build_object('target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca','host','ops-mac-studio','action','kickstarted by heartbeat'));" | $O/db.sh -v "k=$K" -f - >> $L 2>&1
fi
if pgrep -f 'ops/install-queue.sh' >/dev/null; then
  echo "SELECT public.fn_resolve_operational_alerts('install-queue', 'queue-down:ops-mac-studio:', 'install queue process running at heartbeat');" | $O/db.sh -f - >> $L 2>&1
fi
F=$(python3 - "$Q/failed" <<'PY'
import glob, json, os, sys
out=[]
for p in sorted(glob.glob(os.path.join(sys.argv[1], '*.job')))[-200:]:
    f={}
    for line in open(p, errors='replace'):
        k, _, v = line.rstrip('\n').partition('=')
        f.setdefault(k, v)
    out.append({"key": "failed:" + os.path.basename(p), "version": f.get("FILE", "")[:14],
                "closed": f.get("RESULT", "").startswith("PR closed without merge")})
print(json.dumps(out))
PY
)
echo "SELECT count(public.fn_resolve_operational_alerts('install-queue', j->>'key',
  CASE WHEN (j->>'closed')::boolean THEN 'PR closed without merge; nothing left to install'
       ELSE 'migration '||(j->>'version')||' is recorded as installed' END))
  FROM jsonb_array_elements(:'f'::jsonb) j
 WHERE (j->>'closed')::boolean
    OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version = j->>'version');" | $O/db.sh -v "f=$F" -f - >> $L 2>&1
