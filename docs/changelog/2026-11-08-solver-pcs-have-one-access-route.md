# The solver PCs have one access route

2026-11-08. The agent terminal on the Ops Mac has no macOS Local Network
permission, so every plain ping, nc or ssh to M1 (192.168.0.51) and M2
(192.168.0.155) failed with "No route to host" while both PCs were up. The R8
solver round sat idle for about 11 hours after M1 finished, and a session asked
Dan to wake PCs that had been running since October.

`operations/ops-mac/solver-host.sh` (installed by `setup.sh` into
`~/.smarter-poker/ops/`) connects through `sudo -n ssh` with the dedicated
controller key and pinned host keys. `check` reports each host's name, last
boot and PioSOLVER process count, or UNREACHABLE with exit 3. CLAUDE.md and
AGENTS.md make its `check` the only valid reachability reading.

Verified on the Ops Mac: `check` returned both hosts up (M1 booted
2026-10-14, M2 2026-10-26); a missing key exits 4; bad usage exits 2.
