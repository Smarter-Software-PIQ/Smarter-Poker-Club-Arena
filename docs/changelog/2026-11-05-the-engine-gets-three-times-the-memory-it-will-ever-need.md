# 2026-11-05 - the engine gets three times the memory it will ever need

## Owner order

Dan, 2026-11-05 18:25 Chicago: "give the engine like 2-3x more memory
available than it will ever need so we don't ever have this issue again."

## The unit

The worst case measured today on engine 71087373 was 12.3 GB of process RSS
at 5.5 hours (main isolate 2.1 GB, eight Horse decision workers 583 to 937 MB
each, 14 equity workers 10 MB each, journal writers 40 MB each, plus native
arenas). With the observer bank bounded (changelog
2026-11-05-observer-memory-is-bounded-by-use) the steady state is expected
under 8 GB. Three times the worst case is 36 GB; the host has 64 GB and had
47 GB free at that worst case.

## What changed

| Ceiling                                                                | Before                                  | After                                          |
| ---------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------- |
| Main isolate V8 heap (`server/Dockerfile` NODE_OPTIONS)                | 6,144 MB                                | 12,288 MB                                      |
| Horse decision worker V8 heap (`client.ts` resourceLimits)             | process default, unwritten (about 4 GB) | 3,072 MB old generation, 64 MB young, explicit |
| Memory governor fallback hard line (`memoryGovernor.ts`)               | 12,288 MB                               | 36,864 MB                                      |
| Memory governor fallback soft line                                     | 9,830 MB                                | 29,491 MB (80%)                                |
| EngineProcessMemoryHigh alert (`infra/monitoring/alert-rules.yml`)     | RSS above 12 GiB for 15 min             | RSS above 36 GiB for 15 min                    |
| Release certification RSS ceiling (`verify-engine-release-bundle.mjs`) | 12,288 MB                               | 36,864 MB                                      |
| Release certification main heap ceiling                                | 2,048 MB                                | 6,144 MB                                       |

No host change is needed: 12 GB main plus eight 3 GB workers is 36 GB of V8
inside the 47 GB free. The engine container keeps no cgroup memory limit, so
the kernel never kills it; the governor and the alert name a climb long
before the host is short.

Tests updated: `memoryGovernor.test.ts`, `verify-engine-release-bundle.test.ts`,
`lightning-abandoned-and-engine-memory.test.yml` (promtool unit test).
