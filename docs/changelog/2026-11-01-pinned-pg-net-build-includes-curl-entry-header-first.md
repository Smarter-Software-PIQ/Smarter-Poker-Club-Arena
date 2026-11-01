# Pinned pg_net qualification includes curl entry header first

R7 PR #9025 reached a real required accounting build failure after its unrelated date fixtures were corrected. Job124706849226 failed while compiling pinned pg_net0.19.5: its event header includes curl/multi.h first, recursively defining curl_multi_setopt typechecking before multi.h declares that function.

The existing private-build harness now verifies the exact pinned event-header preimage and inserts curl/curl.h before multi.h, then verifies the exact prepared hash and records it. Source archives, extension version/member identity, migration bytes, native assertions and compiler typechecking remain unchanged. No production extension or R7 scientific input is modified.

Actual clang17 with curl8.20 headers reproduces the original compile error and accepts the corrected sequence. Drift in the pinned header is refused. The existing complete private PostgreSQL17.6/pg_net native qualification and required hosted accounting gate remain the acceptance checks; a header-only pass is not full extension qualification.

Local full native qualification passed at 2026-11-01T01:04:30Z: fresh pinned PostgreSQL17.6/pg_net0.19.5 build, actual KQUEUE worker, exact28-member identity and all18behavior cases including atomic refusal, rollback and replay. The initial deep scratch directory exceeded the Mac socket limit before startup; unchanged source passed from a shorter owned SSD path. Existing source/route contract tests:18passed. Full Linux accounting CI remains required.
