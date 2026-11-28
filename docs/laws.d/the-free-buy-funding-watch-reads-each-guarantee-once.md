# tests/the-free-buy-funding-watch-reads-each-guarantee-once.law.test.ts

The Free Buy funding watch timed out at 60 s on 2026-11-20 because an inlined CTE re-evaluated `fn_ca_guarantee_funding` at every reference (20261122155311, first written as 20261120055128). The law pins that the newest definition of `fn_ca_free_buy_funding_watch` computes each event's funding once (`WITH gtd AS MATERIALIZED`), keeps every finding kind, moves no chips, keeps the lock and statement limits 20261121154220 gave every watch, and that no later migration buys headroom by widening the job's timeout.
