# tests/non-release-server-scripts-are-unreferenced-by-release-surfaces.law.test.ts

`scripts/ci/read-engine-prequalification.py` keeps `server/scripts` in `CONTROL_INPUTS` (fail-closed default for new or unknown scripts), preserves AST-parseable literal constants, excludes only verified offline non-release scripts under `NON_RELEASE_SERVER_SCRIPT_PREFIXES` and `NON_RELEASE_SERVER_SCRIPT_EXACT`, and zero excluded scripts are referenced by any engine release workflow, `server/Dockerfile`, `server/standby/**`, release CI helper, or release script.
