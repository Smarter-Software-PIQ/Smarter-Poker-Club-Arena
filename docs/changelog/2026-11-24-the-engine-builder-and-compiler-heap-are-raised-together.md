# The bounded engine builder and the compiler heap are raised together (4096 / 2048 MiB)

On 2026-11-24 the engine image emit (`tsc --project tsconfig.emit.json` in `server/Dockerfile`) needed about
1001 MiB of its 1024 MiB compiler heap on main (bisected on the exact command), and about 100 KB of new engine
source (#11913) took it past the bound: "Compile the engine and contain a real build OOM" failed on every engine
pull request that added code.

The release-custody lane asked for the bound itself to be raised, whatever the compile's own need becomes. The
builder and the heap move together, as `tests/engine-release-seal.law.test.ts` requires:

- `server/Dockerfile`: the compiler RUN heap is 2048 MiB (was 1024).
- `server/scripts/build-engine-image.sh`: a new immutable builder, `club-arena-engine-bounded-v5`, with a
  4096 MiB no-swap cgroup (`BUILD_MEMORY_BYTES=4294967296`, was v4 at 2048 MiB). v4 is never resized; a host
  that still has v4 creates v5 on its next build. The start gate is now 4456448 KiB available (4096 MiB builder
  plus the unchanged 256 MiB reserve, 4352 MiB).
- The heap stays at half the cgroup (the law allows up to two thirds), and the builder stays at least 40% above
  the measured 830 MiB RSS and 1322455040-byte kernel peak.
- `tests/operations/engine-build-resource-proof.py` builds and faults v5 at 4096 MiB; the deliberate OOM fault
  allocates off-heap buffers under an 8192 MiB heap flag, so it still overflows the 4096 MiB cgroup and proves a
  real out-of-memory in the build is contained without touching the neighbouring process.
- `EngineBuildHeadroomLost` (`infra/monitoring/alert-rules.yml`), the engine dashboard line and
  `docs/runbooks/engine-memory.md` follow the new 4352 MiB start gate.

Engine host: the release-custody lane reports 51 GB and 26 GB free on the engine hosts; the serving engine's own
ceiling (12 GiB main isolate plus 8 x 3 GiB decision workers, `NODE_OPTIONS` in the Dockerfile) is unchanged. A
Backup build now reserves up to 4 GiB beside the serving engine instead of 2 GiB.
