# A retired club leaves the cluster tick worklist (2026-11-11)

`ClusterPassErrors` (alert row 376546) has fired and resolved 48 times since 2026-10-17. Each firing was closed as informational when its resolved twin arrived, so nobody read the cause. The cause was the same in every case checked: `fn_cash_clusters_to_tick()` admitted disabled games of **retired** clubs. A retired club's rows are read-only, so every tick of those games was refused with `55000 CLUB_RETIRED`.

At 2026-11-11 05:48Z, 36 games in four retired `Crest Cert Template` certification fixtures produced:
- ~5 `controller_tick_error` rows a second;
- ~620k `cash_cluster_events` rows a day;
- pass budget spent on games that can never change.

Migration `20261111055020` excludes a retired club's games from the worklist. Everything else in the worklist is byte-identical to the installed body (md5-gated). Read-only probe: the worklist goes from 83 to 47 games, and exactly those 36 games leave. No rows are written.

Pinned by `tests/a-retired-club-leaves-the-cluster-tick-worklist.law.test.ts`. A recurrence still raises `ClusterPassErrors` into the operational alert store.
