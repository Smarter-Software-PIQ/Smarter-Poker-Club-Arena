# 2026-11-24: the exact opponent profile keeps how an opener answers a 3-bet of his own open (measurement and reader)

This PR adds no decision change. No decision reads the record until a default-OFF option that reads it is switched on.
That option is the planned-fold scaling of the out-of-position 3-bet range rule from #11917. It lands after #11917.

The profile kept how often an opener folds to a 3-bet (`foldTo3Bet`). It kept nothing about how his other answers split
between a call and a 4-bet, and nothing about his position against the 3-bettor. The out-of-position 3-bet rule needs
exactly that, because a 3-bet the Horse would fold to a 4-bet costs only as often as this opener 4-bets. The rule's
league probes (#11917) priced every opener with the population's split. Heads-up NLH they lost about 25 bb/100 against
an opener who never 4-bets light.

- `HorseOpenerAnswersThreeBet.ts`: one node, `openFacesThreeBet`, kept in two cells, `inPosition` and `outOfPosition`.
  Each cell is `{opp, fold, call, raise}`, and the cell is the opener's position against the 3-bettor after the flop.
  - The node: he made the first raise, the very next raise was another player's, and he acted before any further
    raise. One opportunity per player per hand.
  - Position comes from the public log only. The blinds are the players who posted them (not dead blinds). With no
    posts, they are the first voluntary preflop actors: heads-up the first is the small blind, otherwise the last two
    are the blinds. Heads-up the big blind acts first after the flop.
  - Admission, the definition of a raise and the ageing are those of the opportunity-gated preflop counters
    (half-life 30). Public actions only.
- The reader is `openerFourBetRead` and `plannedFoldGuardWeight`. It follows the Prior anchor law:
  - Baseline: a 0.10 4-bet share, equilibrium-scale.
  - Population weight: 0.
  - Own record: shrunk with a mass of 6.
  - No unshown cards.
  - With no record the guard weight is 1, so the rule behaves exactly as without the reader.
- Storage: a nullable column `horse_exact_profiles.opener_response` (jsonb). Migration
  `20261124195144_exact_profile_keeps_how_an_opener_answers_a_3_bet.sql`, @install-window: daily-maintenance, NOT
  installed by this change. It adds:
  - the column;
  - the SQL twins `fn_horse_opener_response_increments` and `fn_horse_opener_response_add`;
  - a patch to `fn_horse_exact_accept_hand` by exact fragments, learning for nlh, plo4 and plo5 hands only.
- Forward only, no back-fill: the re-raise response record, the closest existing counter, was installed without one too. The
  engine reads a null, absent or malformed record as absent, so the engine may ship before the column exists.
- Transport, the re-raise response record's path:
  - the pooled exact row carries it;
  - the observer reads bring a detached copy into the decision's own state;
  - read frame v21 (`openerResponse`) journals it. A frame without a record keeps its exact v1-v20 bytes.
  - `HorseMind.openerResponseOf(userId)` answers it for the decision in flight.
  - `HorseMind.setLearnsOpenerResponseInSandbox` (benchmark only, default off) lets a league sandbox learn it from its
    own hands, as the accepted-hand learner does for a live table.

Proof:

- `HorseOpenerAnswersThreeBet.test.ts`.
- `anOpenerResponseThroughTheWorker.test.ts`: FAST, DEEP and the exact replay; the column full, null and absent; a
  malformed record dropped; decision bytes identical.
- Engine / SQL parity in `scripts/ci/test-horse-exact-public-memory.py` on
  `scripts/ci/fixtures/horse-opener-response-vectors.json`: 9 named hands, 260 random logs with blind posts and dead
  blinds, a 120-hand chain, and learning through the accepted-hand receipt by game, format and tournament.
