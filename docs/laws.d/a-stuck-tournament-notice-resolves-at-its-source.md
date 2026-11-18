# tests/a-stuck-tournament-notice-resolves-at-its-source.law.test.ts

A stuck_tournament notice from the Smarter.Poker critical pager or daily digest resolves at its source: fn_sp_critical_scan, the 5-minute evaluator of the stuck predicate, moves both sp notices of a tournament that is no longer RUNNING to 'resolved' in place, and no later migration may rewrite the function without that step.
