# tests/every-main-table-feeds-upward.law.test.ts

Every live Main table in `fn_cash_cluster_tick_uncapped` draws upward from higher-numbered Mains (`c.main_index > t.main_index`), the Feeder and breaking tables, `fn_cash_main_chair_is_the_lists` reserves open Main chairs for the must-move list across all 6-max and 9-max feeder games, and `fn_cash_seat_change_plan` blocks upward open-chair seat changes into any Main; proved natively in PostgreSQL.
