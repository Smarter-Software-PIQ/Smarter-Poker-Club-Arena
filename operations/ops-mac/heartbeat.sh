#!/bin/zsh
# Every 5 minutes under launchd (com.smarter-poker.ops-heartbeat): reports this
# Mac's health to smarter_private.record_host_heartbeat('ops-mac-studio', ...).
# A silence over 15 minutes raises a critical Production Alert.
Q=~/.smarter-poker/install-queue; O=~/.smarter-poker/ops
J=$(python3 - <<'PY'
import json, os, subprocess, time, glob
def disk(p):
    try:
        s=os.statvfs(p); tot=s.f_blocks*s.f_frsize; free=s.f_bavail*s.f_frsize
        return {"free_pct": round(100*free/tot,2), "free_gb": round(free/2**30,1)}
    except Exception as e: return {"error": str(e)[:80]}
boot=subprocess.run(['sysctl','-n','kern.boottime'],capture_output=True,text=True).stdout
try: up=int(time.time())-int(boot.split('sec =')[1].split(',')[0])
except Exception: up=None
q=os.path.expanduser('~/.smarter-poker/install-queue')
alive=subprocess.run(['pgrep','-f','install-queue.sh'],capture_output=True).returncode==0
claude=subprocess.run(['pgrep','-x','Claude'],capture_output=True).returncode==0
print(json.dumps({"uptime_s":up,"load":os.getloadavg()[0],
 "disks":{"root":disk('/'),"work":disk('/Volumes/SmarterWork'),"archives":disk('/Volumes/SmarterArchives')},
 "install_queue":{"service_alive":alive,"pending":len(glob.glob(q+'/pending/*.job')),"running":len(glob.glob(q+'/running/*.job'))},
 "claude_app_running":claude}))
PY
)
L=~/.smarter-poker/logs/heartbeat.log
[ -f $L ] && [ $(stat -f %z $L) -gt 5242880 ] && mv -f $L $L.1
echo "SELECT smarter_private.record_host_heartbeat('ops-mac-studio', :'d'::jsonb);" | $O/db.sh -v "d=$J" -f - >> $L 2>&1
rc=$?
echo "$(date -u +%FT%TZ) rc=$rc $J" >> $L
# The install queue must always be running; launchd restarts it, and if it is
# down at a heartbeat anyway, restart it and raise one alert per hour.
if ! pgrep -f 'ops/install-queue.sh' >/dev/null; then
  launchctl print gui/$(id -u)/com.smarter-poker.install-queue >/dev/null 2>&1 || launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.smarter-poker.install-queue.plist >> $L 2>&1
  launchctl kickstart gui/$(id -u)/com.smarter-poker.install-queue >> $L 2>&1
  K="queue-down:ops-mac-studio:$(date -u +%Y%m%dT%H)"
  echo "SELECT public.fn_record_operational_alert('install-queue', :'k', 'InstallQueueServiceDown', 'firing', 'critical', jsonb_build_object('target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca','host','ops-mac-studio','action','kickstarted by heartbeat'));" | $O/db.sh -v "k=$K" -f - >> $L 2>&1
fi
