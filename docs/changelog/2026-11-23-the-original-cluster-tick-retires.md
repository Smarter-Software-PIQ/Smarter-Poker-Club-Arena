# The original cluster tick retires and readiness reads the uncapped tick (2026-11-23)

## Cause

Migration `20261112154904` created `fn_cash_cluster_tick_uncapped(uuid, integer)` and `fn_cash_clusters_tick_all_uncapped(jsonb)` while leaving the older capped originals (`fn_cash_cluster_tick(uuid, integer)` and `fn_cash_clusters_tick_all(jsonb)`) in `public` during engine rollout. Keeping two near-identical copies of the cluster tick created two defects:

- Editing only the original copy silently missed the live `_uncapped` copy that `ClusterController` actually calls (seen on PR #11790's first revision).
- `public.fn_lightning_rollout_readiness(uuid)` still referenced `'public.fn_cash_clusters_tick_all(jsonb)'::regprocedure` in its `v_anti` anti-manipulation check, auditing the dead copy instead of the live uncapped pass and creating a hidden dependency that would break the Lightning operator page if the originals were dropped without repointing readiness first.

## Fix

- Migration `20261123083628_the_original_cluster_tick_retires_and_readiness_reads_the_un.sql` repoints `fn_lightning_rollout_readiness(uuid)` to `'public.fn_cash_clusters_tick_all_uncapped(jsonb)'::regprocedure`, fails closed if any other function in `public` or `smarter_private` still calls the retired originals, drops `fn_cash_clusters_tick_all(jsonb)` and `fn_cash_cluster_tick(uuid, integer)`, and probes `fn_lightning_rollout_readiness(uuid)` after the drop.
- `server/src/cluster/ClusterController.ts` calls `uncappedTickRpcName` and `uncappedTickAllRpcName` directly and removes the `PGRST202` fallback to the retired originals.

## Verification & Hardening

- Native PostgreSQL proof: `scripts/dev/prove-the-original-cluster-tick-retires.sh` (proves dropping without repointing breaks readiness, straggler detection rolls back, and post-migration readiness audits `fn_cash_clusters_tick_all_uncapped`).
- Permanent law: `server/src/cluster/TheUncappedTickStaysInStep.law.test.ts` forbids any later migration from resurrecting the retired originals and pins `ClusterController` to the two uncapped doors alone.
