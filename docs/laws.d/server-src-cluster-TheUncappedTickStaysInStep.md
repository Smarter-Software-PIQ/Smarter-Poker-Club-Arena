# server/src/cluster/TheUncappedTickStaysInStep.law.test.ts

The uncapped cluster tick (`fn_cash_cluster_tick_uncapped` and `fn_cash_clusters_tick_all_uncapped`) is the sole cluster tick: migration 20261123083628 repoints `fn_lightning_rollout_readiness` to `fn_cash_clusters_tick_all_uncapped(jsonb)` and drops the retired capped originals, no later migration may resurrect either original, and `ClusterController` calls only the two uncapped doors with no fallback.
