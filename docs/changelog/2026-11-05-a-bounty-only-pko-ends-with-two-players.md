# A Bounty Only PKO Ends With Two Players

Dan, 2026-11-05: "The top two guys that are left should keep the bounties on both of their heads. Tournament is over with 2 players left."

A bounty only PKO (free entry, no guarantee, zero place pool) used to play heads up. The last knockout moved half of the loser's head to the winner's wallet and half onto the winner's head, and the terminal then paid the winner that head as his own: one player took both final heads.

Now, once the bust that leaves two players has settled, the engine parks every table after its hand and calls `fn_ca_bounty_only_pko_final_two` (migration 20261106010426). It orders the pair from the locked roster: more chips first, then the larger head, then the earlier registration. It pays the second player his own head to his wallet through `fn_settle_tournament_obligation` (kind `bounty_residual`) and records him in second place. The event then finishes through the unchanged terminal authority, which pays the first player the pool residual, exactly his own head. A replay returns the stored receipt and pays nothing twice. A refusal that waiting cannot fix lets the event play on heads up and is reported once.

The Rewards tab and the lobby state the rule for this format.

Proof: `scripts/ci/test-bounty-only-pko-final-two.py` (native PostgreSQL), `server/src/tournament/BountyOnlyFinalTwo.test.ts`, `tests/a-bounty-only-pko-ends-with-two-players.law.test.ts`.
