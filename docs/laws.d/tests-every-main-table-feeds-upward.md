# tests/every-main-table-feeds-upward.law.test.ts

Every live Main table in `fn_cash_cluster_tick_uncapped` draws upward from higher-numbered Mains (`main_index > t.main_index`), the Feeder and breaking tables, never downward, across all must-move feeder games on the platform.
