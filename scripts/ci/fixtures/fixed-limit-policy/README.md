# Fixed-limit policy qualification baseline

The six function definitions and tables/cash_games column types were read from the serving public schema on November 3, 2026. They contain no credentials or player data. The native fixture executes the migration against these original owners, including both table projection paths and the real fn_cash_game_ensure catalogue creator. Unrelated union context is isolated; no money is moved and no production write is performed.

Run `python3 -B scripts/ci/test-fixed-limit-policy-postgres.py --pg-bin <PostgreSQL17bin> --scratch <external-task-scratch>`. The existing CI accounting shard 3 executes the same command.
