#!/bin/bash
# Tests for scripts/ops/agent-disk-preflight.sh with a fake df on PATH (no real disk is read).
#   bash scripts/ops/tests/test-agent-disk-preflight.sh
# Prints one line per case; exits 1 if any case misbehaves.
set -u
S=$(cd "$(dirname "$0")/.." && pwd)/agent-disk-preflight.sh
T=$(mktemp -d "${TMPDIR:-/tmp}/agent-disk-preflight-test.XXXXXX"); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/vol/big" "$T/vol/small" "$T/vol/empty" "$T/vol/big/worktree" "$T/vol/gone" "$T/vol/spaced"
# Fake df: answers from $T/df.map lines "<path>|<avail KiB>|<mount>"; "<path>|ERR|<message>" fails like a lost disk.
cat > "$T/bin/df" <<'DF'
#!/bin/bash
p="${@: -1}"
while IFS='|' read -r k a m; do
  if [ "$k" = "$p" ]; then
    if [ "$a" = ERR ]; then echo "df: $p: $m" >&2; exit 1; fi
    echo "Filesystem 1024-blocks Used Available Capacity Mounted on"
    echo "/dev/fake1 999999999 1 $a 50% $m"; exit 0
  fi
done < "$(dirname "$0")/../df.map"
echo "df: $p: no map entry" >&2; exit 1
DF
chmod +x "$T/bin/df"
G=1048576   # KiB per GiB
cat > "$T/df.map" <<MAP
$T/vol/big|$((490 * G))|/Volumes/Big
$T/vol/big/worktree|$((490 * G))|/Volumes/Big
$T/vol/small|$((1 * G + G / 10))|/Volumes/Small
$T/vol/empty|$((200 * G))|/System/Volumes/Data
$T/vol/gone|ERR|Device not configured
$T/vol/spaced|$((30 * G))|/Volumes/SSD2 Archives
MAP
f=0
run() { PATH="$T/bin:$PATH" AGENT_DISK_FLOOR_GIB="${FLOOR:-}" bash "$S" "$@" > "$T/out" 2>&1; echo $?; }
check() { # name expected_rc grep_pattern actual_rc
  if [ "$4" = "$2" ] && grep -q -- "$3" "$T/out"; then echo "PASS $1 (rc=$4)"; else echo "FAIL $1 (rc=$4, want $2): $(tr '\n' ' ' < "$T/out")"; f=1; fi
}
unset AGENT_DISK_ROOT_MOUNTS
FLOOR= ; r=$(run "$T/vol/big");                     check "A mounted volume above default 25 GiB floor" 0 "^OK .*490.0 GiB free on '/Volumes/Big' (floor 25 GiB)" "$r"
r=$(run "$T/vol/big/worktree");                     check "B path below a volume uses that volume" 0 "^OK .*/Volumes/Big" "$r"
r=$(run "$T/vol/small");                            check "C 1.1 GiB free is below the floor" 1 "^FAIL .*1.1 GiB free on '/Volumes/Small', below the 25 GiB floor" "$r"
r=$(run "$T/vol/empty");                            check "D empty mount point on the system disk (SSD1 absent)" 1 "^FAIL .*not on its own volume.*System/Volumes/Data" "$r"
r=$(run "$T/vol/gone");                             check "E unreadable volume (Device not configured)" 1 "^FAIL .*df could not read it.*Device not configured" "$r"
r=$(run "$T/vol/nonexistent");                      check "F missing path" 1 "^FAIL .*path does not exist" "$r"
r=$(run "$T/vol/big" "$T/vol/small");               check "G one bad path fails the run, the good one still reports OK" 1 "^OK .*/Volumes/Big" "$r"
grep -q "^FAIL .*Small" "$T/out" || { echo "FAIL G2 second path not reported"; f=1; }
r=$(run --floor-gib 500 "$T/vol/big");              check "H --floor-gib raises the floor" 1 "below the 500 GiB floor" "$r"
FLOOR=1; r=$(run "$T/vol/small");                   check "I AGENT_DISK_FLOOR_GIB=1 lets 1.1 GiB pass" 0 "^OK .*(floor 1 GiB)" "$r"; FLOOR=
r=$(run "$T/vol/spaced");                           check "J mount point with a space is read whole" 0 "^OK .*on '/Volumes/SSD2 Archives'" "$r"
r=$(run --floor-gib abc "$T/vol/big");              check "K non-numeric floor is a usage error" 2 "whole number of GiB" "$r"
r=$(run --bogus);                                   check "L unknown option is a usage error" 2 "unknown option" "$r"
r=$(PATH="$T/bin:$PATH" AGENT_DISK_ROOT_MOUNTS=/Volumes/Big bash "$S" "$T/vol/big" > "$T/out" 2>&1; echo $?)
                                                    check "M AGENT_DISK_ROOT_MOUNTS override marks a mount as system disk" 1 "not on its own volume" "$r"
# N: read-only: the script never writes into the paths it checks.
before=$(find "$T/vol" | sort | shasum | cut -c1-40); run "$T/vol/big" "$T/vol/small" >/dev/null; after=$(find "$T/vol" | sort | shasum | cut -c1-40)
[ "$before" = "$after" ] && echo "PASS N read-only: no file created under the checked paths" || { echo "FAIL N the script wrote under a checked path"; f=1; }
[ $f = 0 ] && echo "ALL PASS" || echo "SOME FAILED"; exit $f
