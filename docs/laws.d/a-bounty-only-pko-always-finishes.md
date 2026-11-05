# tests/a-bounty-only-pko-always-finishes.law.test.ts

A tournament whose finalized ordinary prize pool is 0 (bounty-only PKO, any format) must still settle and finish: the cash authority returns a zero-dollar place-1 winner line, no money moves for it, and no later migration may rewrite fn_settle_tournament_places or fn_complete_tournament_terminal_pre_seat_guard without the zero-pool branch.
