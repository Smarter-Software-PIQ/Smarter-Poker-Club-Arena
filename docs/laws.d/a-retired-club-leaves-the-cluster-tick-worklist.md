# tests/a-retired-club-leaves-the-cluster-tick-worklist.law.test.ts

A retired club's gameplay records are read-only (`fn_guard_retired_club_mutation`), so the cash cluster tick worklist (`fn_cash_clusters_to_tick`) never admits a game whose club is retired; the pass ticks only what that worklist admits. Before 20261111055020, 36 disabled games of four retired certification fixtures were ticked every 5 s and refused every time (55000 CLUB_RETIRED), keeping ClusterPassErrors firing for days.
