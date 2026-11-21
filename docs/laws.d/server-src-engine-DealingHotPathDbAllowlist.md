# server/src/engine/DealingHotPathDbAllowlist.law.test.ts

Enforces an explicit allowlist over every direct `supabase.from(...)` and `supabase.rpc(...)` call inside `server/src/engine/ServerTableEngineDealing.ts`, preventing future PRs from silently dropping blocking database reads or writes onto the inter-hand dealing hot path (as happened in the `tournament all_in_showdown` bust-path incident).
