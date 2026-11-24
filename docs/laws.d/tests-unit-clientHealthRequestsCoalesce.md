# tests/unit/clientHealthRequestsCoalesce.law.test.ts

Guards that every browser client `/health` probe (`privateGameInvite`, `cashRakePolicyVersion`, `GameServerAPI`, and all `src/` callers) coalesces concurrent in-flight requests so lobby mounts never trigger a TCP connection storm on the engine (incidents b87d2b52, 7bf7a01f).
