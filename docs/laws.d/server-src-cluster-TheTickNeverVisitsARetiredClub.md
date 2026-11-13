# server/src/cluster/TheTickNeverVisitsARetiredClub.law.test.ts

The latest fn_cash_clusters_to_tick leaves out every game of a club whose lifecycle_status is retired (read-only by fn_guard_retired_club_mutation), and both tick passes (fn_cash_clusters_tick_all and its \_uncapped twin) read that one list (20261113124849).
