# Heads-up rematch under real concurrency (2026-11-09)

The rematch core (`fn_ca_heads_up_rematch_core`, migration
`20261109021122`) promised to serialize on its agreement row: two
simultaneous Yes taps, repeated taps or an interrupted request could never
create two games or charge anyone twice. The rolled-back production probes
showed the single-session behaviour. They could not show what happens when
independent sessions arrive at the same moment, so this adds a native proof.

## What it runs

`scripts/ci/test-heads-up-rematch-concurrency-postgres.py` builds an isolated
PostgreSQL cluster. It installs the core and both browser doors cut from the
merged migration, then checks that `md5(pg_get_functiondef(...))` for each
equals the definition installed in production (read 2026-11-09 05:12Z). The
buy-in layers and the creation door are fixture stand-ins
(`scripts/ci/fixtures/heads-up-rematch-concurrency/bootstrap.sql`) that keep
the contract the core relies on: lock the payer's wallet, charge once, refuse
an empty wallet, and answer `already_seated` on a repeat.

Each request below runs in its own psql session. A shared advisory lock
releases them all at the same instant.

| Scenario | Result required |
| --- | --- |
| 12 rounds, 8 simultaneous Yes sessions (4 per player) on a fresh offer, then 4 repeat taps | one `matched` row, one game, two seats, exactly one charge per player, both charges committed by one transaction, repeats inert |
| The second Yes is cancelled (`pg_cancel_backend`) inside the second purchase, after the first payer was charged | no charge, no game, no seat; the accept list still holds only the first player; the retry matches once |
| The same, but the connection is terminated (`pg_terminate_backend`) | same |
| The client is killed before it reads the answer | either outcome is whole; the retry and a repeat both read `matched`, with no extra charge |
| One wallet short by 0.01, 6 simultaneous Yes | `buy_in_refused` naming that player; nobody charged, no game; repeats stay refused |
| A person against a horse, simultaneous Yes and reads | one rematch; the person and the horse each charged once |
| Yes, No, Yes racing from one player, 6 rounds | every round is either matched with two charges or declined with none |
| A signed-out session, then a changed buy-in layer | `SESSION_REVOKED`; then `unavailable` with nobody charged |

A mutation run with the `FOR UPDATE` row locks removed fails the first round:
three stray games were created. The proof therefore detects the race it guards
against.

It runs in its own workflow, `heads-up-rematch-concurrency.yml`, on PostgreSQL 17. The workflow runs on any pull request or main push that touches the rematch migration, the harness or the fixture, and it can also be started by hand. It sits outside `ci.yml` because the accounting job's inputs are pinned by the financial qualifications.

## The live, signed-in check

`scripts/ci/certify-heads-up-rematch.mjs` (workflow `Heads-Up Rematch
Certification`, started by hand only) runs the whole flow against production
and the serving engine. It uses only the supported certification route: the
reserved `ca-customization-cert-postdeploy-*` accounts, chips from a
`Cert HU` certification club's own opening grant, and the rabbit-hunt
certification's settle path (claim back, retire with records).

The run does the following:

1. Two reserved players buy both seats of a fresh heads-up game through the
   browser's seat door. The game is created by the engine board's own
   creation door, copying a live board game's terms with only the club
   changed.
2. The engine starts that game, and the players play it out.
3. Player A taps Play Again on the ranking card in a real signed-in browser
   sitting at the table. Player B says Yes through the door the card calls.
4. The run checks:
   - one committed rematch;
   - the same two players in the new game;
   - one buy-in plus fee charged to each;
   - the finished game's buy-in, fee, stack and payout;
   - the browser moved to the new table;
   - the engine started the rematch and dealt its first hand.
5. The rematch is played out. The two players together must end up exactly
   four fees down across the two games.

Outside the Sit & Go window (03:00-06:00 Chicago), during a freeze or while
the engine is not idle, the run ends UNKNOWN and creates nothing.

## Why the live check is now held (2026-11-09 14:45Z)

Runs 42581709358 and 42584396854 proved the product in production:
- a signed-in Play Again;
- one committed rematch;
- one buy-in plus fee from each player in one transaction;
- the same opponent and the same terms;
- the browser moving to the new table;
- the engine starting the rematch and dealing its first hand;
- chips conserved after both games.

What no run has been able to do is retire its club afterwards:
- `fn_retire_settled_club` always runs `fn_unwind_unused_first_club_welcome_package`, which refuses any club in which a Sit & Go was played. The Cert Residue Sweep (run 42602987778) was refused on three such clubs.
- Removing the untouched welcome games first, through `fn_remove_first_club_welcome_games`, deactivates the club's Spin pool. After that, the tournament creation fence refuses every Sit & Go in that club (`WELCOME_PACKAGE_SPIN_BOARD_RETIRED`, run 42635543669).

Until a retirement path for a played certification club exists, the script ends UNKNOWN before creating anything (`CERTIFICATION_CLUB_CAN_RETIRE = false`). Without that hold, each run would only add a club no door can retire. The same retirement rule applies to every real club that has run a Sit & Go, so changing it is an owner decision.
