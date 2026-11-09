# CHECKPOINT - tournament lobby, satellite names and heads-up rematch (2026-11-08/09)

Lane: tournament-lobby (session_01BbZPDhrfyf3rn1wmuxqmwe). This is the only checkpoint for this task.

## Scope (owner requests of 2026-11-08, and their acceptance follow-up)

Deliverables owned by this chat, with their acceptance criteria and status:

| # | Deliverable | Acceptance criterion | Status |
| --- | --- | --- | --- |
| 1 | WATCH wears the register plate | lobby shows WATCH on the register plate, phone and desktop, signed in | done, live |
| 2 | No event says "0 GTD" | no open event name or description says a zero guarantee | done; 0 found |
| 3 | Agents see their players on every tab | Details, Ranking, Rewards, Tables all show the card | done, live |
| 4 | Rewards pins the hero | hero stays pinned on Rewards | done, live |
| 5 | Satellites are named "Satellite Into <target>" | every open satellite, and every new one including weekly-schedule spawns, carries the target-derived name; no duplicate | done for open and unscheduled spawns; weekly spawn: see A3 |
| 6 | Heads-up Play Again | both accept before a charge; one charge each through the normal buy-in; same fresh table; decline, timeout, short wallet, repeat tap and simultaneous accepts leave no partial charge or duplicate game | done, live |

Acceptance follow-up (owner, 2026-11-08 23:03 Chicago):

| # | Item | Evidence or exact blocker | Needs a new engine? |
| --- | --- | --- | --- |
| A1 | Two independent sessions accepting at once produce one rematch and one charge per player, including an interrupted request and its retry | PASSED. Native proof on the production definitions (md5-checked), run green at main by `heads-up-rematch-concurrency.yml` (run 42569886982). Details below | No (database only) |
| A2 | A committed signed-in rematch reaches its first hand with the correct opponent, stacks and rake | PASSED in production. Run 42584396854: browser Play Again, same two players, 300-chip stacks, 0.95 + 0.05 rake each, one transaction for both charges, browser moved to the new table, engine start and first hand; finish and chip conservation read afterwards. Details below | No. Proven on the serving engine 391f7bc0, which predates this work |
| A3 | The next weekly-schedule satellite is created with the target-derived name and no duplicate | NOT YET OBSERVED (natural event). No schedule spawn of a satellite has happened since the fix was installed at 03:12Z. Details under "Weekly satellite" below | No (database trigger; the existing engine spawns it) |
| A4 | The frozen-satellite recovery has an acknowledged owner and a tracked outcome | HANDED OFF, not a gate of this lane. Verifier ACK: release-blockers lane, 06:56Z (COORDINATION-INBOX.md). Recovery: the release owner's ASAP owner-window operation (PR #10063 comment 6741660924), which must carry 66cfdde743. Who acts if either stays dark after a sealed release: asked at PR #10063 comment 6742262566, answer pending. This lane makes no mutation and reuses the verifier's receipt | Yes: the recovery needs an engine carrying 66cfdde743 |

Other items closed in this task:
- The old draft branch `claude/heads-up-rematch-1108` (closed PR #10093) was deleted at about 05:28Z through the Mac's GitHub login. The cloud proxy refuses ref deletes.
- The deployed identities are recorded below.

## Handed to other owners (not gates of this lane)

- Frozen satellites 6cb6f619 and 7a41f0a1: see A4. Read at 10:12Z: both RUNNING at level 12, last hands 2026-11-08 04:53:56Z and 23:48:49Z. The Nov 9 04:00 Chicago selection was blocked by a sparse-checkout defect, fixed in #10154/#10155.
- Certification leftovers, handed to issue #9830 (comment 6742913924):
  - four active `Cert HU` clubs;
  - four zero-balance reserved players in two retired clubs;
  - the finding that no current door retires a club after a Sit & Go has been played in it. Changing that rule is an owner decision.
  The `Heads-Up Rematch Certification` workflow now ends UNKNOWN before creating anything until such a path exists (PR #10175).
  Run 42638767037: the workflow execution SUCCEEDED, but the certification result is UNKNOWN. It created nothing, and its
  stated reason is that no door retires a certification club after a Sit & Go is played. The evidence for that blocker
  is on #9830 (comment 6742913924). The #9830 owner had not acknowledged as of 15:55Z.
- "Friday Feature Satellite 5" (schedule b997f1e3) has not spawned since 2026-11-04. It is not this lane's; noted only.

## Weekly satellite (A3), and the corrected spawn rule

- A weekly satellite is created together with its TARGET, when the target reaches the 72-hour horizon. It is not
  created on its own start time. The spawns of schedule d84a104f (daily 09:45 Chicago) were each created about
  2 d 21 h 44 m before their own start, at the target's spawn minute. Example: start 2026-11-11 15:45Z, target
  "40 Chip Freezeout - 1.5K GTD (NLH)" at 18:00Z, created 2026-11-08 18:00:41Z.
- An earlier note expected the next one at 15:45Z; that expectation was wrong. Read at 15:47Z: nothing missing.
- Next expected spawn: about 2026-11-09 18:00:40Z (12:00 Chicago), for start 2026-11-12 15:45Z, alongside its target
  at 18:00Z.
- To accept it, all three must hold:
  - its name is "Satellite Into 40 Chip Freezeout (NLH)" (the "0 GTD" schedule name must not appear);
  - `satellite_target_id` names that 18:00Z target;
  - exactly one non-cancelled row exists for (schedule_id, start_time).
- Since the fix: 0 events created with a "0 GTD" name. Every satellite created since 03:12Z (all unscheduled) carries a
  target-derived name.

## Engine dependency

- Database only, verified on the serving engine 391f7bc0 (which predates this work): deliverables 1-6 and items A1-A3.
- Only A4, the frozen-satellite recovery, needs an engine carrying 66cfdde743. That recovery belongs to the release
  owner's ASAP operation, not to this lane.

## What this lane leaves open

- A3: one natural observation of the next weekly satellite spawn, due about 18:00:40Z.
- Owner acknowledgments not yet received:
  - #9830 (certification leftovers, and the retirement rule for played clubs);
  - PR #10063 comment 6742262566 point 3 (who acts if a satellite stays dark after a sealed release).
- Nothing is in flight from this lane: no open PR, no running workflow, no worktree, no timer.

## Deployed identities (read 2026-11-09 08:30Z)

- Client at both origins (`ca-static.smarter.poker/build-info.json`, `smarter.poker/hub/club-arena/build-info.json`):
  `fc2bfba558718b6b4b8803d789cb36c599888ff6` (publish run 42566837968, built 05:26:37Z). It contains every merge below.
- Serving engine: `391f7bc0d57c71637bd4af5181f70520661e3593`, maintenance phase idle. The rematch needs no engine change.
- Rematch: #10121 (`045886dd3`) + #10133 (`3e638ec679e79ccc79138dd6c3db0418636efbb7`). Migration `20261109021122` was
  installed at 04:34Z by run 42562604673. The first send, run 42559723349, was refused and committed nothing.
- Satellite names follow the weekly terms: #10124 (`96ae83a01523df58490b78e326679e9dd5712b0f`), migration `20261109023856`.
- Production definitions (md5 of `pg_get_functiondef`):
  - `fn_ca_heads_up_rematch_core`: `2df60372fbf4d0fff788be4d4e2f3530`
  - `ca_heads_up_rematch_respond`: `79ae417a9bff7aaa90a39175d9723571`
  - `ca_heads_up_rematch_state`: `a1fdac1b84d68aca5b488843302d585c`
- Acceptance tooling:
  - #10141 (`f052964513eaa56a245173dfa99f62451dc22d8a`): concurrency proof and live certification.
  - #10143, #10147, #10149, #10152, #10170 and #10175 (`69321e3b0c4a4c26c6da8bb9caed2eba881f6aa5`): fixes found by the live runs, and the hold.

## Shipped and verified live

| Change | PR / merge | Installed / published | Live evidence |
| --- | --- | --- | --- |
| WATCH wears the register plate; no event says "0 GTD" | #10082 | migration 20261108201826; client live | phone + desktop lobby checked signed in; 0 open names say a zero guarantee (re-measured 2026-11-09 03:12Z) |
| Agents see their players on every tab; Rewards pins the hero | #10088 | client live | Details, Ranking, Rewards, Tables checked signed in, phone + desktop |
| Satellites named for the event they feed | #10096 (38085ff15) | migration 20261108213926 | 109 open satellites renamed; twins "#2"; registration, qualification, tickets, navigation checked |
| A satellite's name follows the weekly terms (defect found live) | #10124 (96ae83a01) | migration 20261109023856, 03:12Z | trigger `tournaments_d_copy_follows_the_weekly_terms` live; 7ada69f5 and f7f3b7dd corrected; 0 open misnamed, 0 zero-GTD |
| Heads-up rematch buys both seats or neither | #10121 (045886dd3) + #10133 (3e638ec67) | migration 20261109021122 installed 04:34Z (first send 04:04Z refused by `fn_ca_money_rpc_registry_guard`, nothing committed, fixed in place); client 045886dd3 at both build-info origins | see below |

## Satellite seat tickets after the rename (natural event)

`ba57f0d9` "Satellite Into 40 Chip Bounty Freezeout (NLH)" completed 01:15:55Z: 43 entries x 4.50 = pool 193.50; four
seats of 40.00 (36 + 4 fee) delivered as direct registrations into the target 4cc11151 "40 Chip Bounty Freezeout -
2.5K GTD (NLH)" (all four `playing`, one registration each, one award key each); remainder 33.50 to the bubble
(place 5) through `credit_and_log`, one payout row, one credit receipt (ledger 4c528499, wallet a617518b); escrow
closed "exact zero" (prize_out 193.50, fee_out 21.50, balances 0).

## Heads-up rematch - live results (production, every probe rolled back)

- Installed objects: 8 named-payer copies exist, none reads auth.uid(), none executable by anon / authenticated /
  service_role; core not browser-executable; both doors authenticated-only; 0 source drift;
  `fn_take_seat_and_buy_in` md5 unchanged (a965493d...).
- Installed core, real horse heads-up that ended 7 s earlier (e82b5cde): matched; fresh sng-v1 game; -2.00 each;
  one tournament_buyin ledger row each; 2 seats; pool 3.80 + fee 0.20; repeat tap: no change.
- Installed person copy, two humans (fee275cf's players, wallets +100 in the probe): -20.00 each, one ledger row
  each, both playing, pool 38.00 + fee 2.00; repeat call "already_seated", no charge; empty wallet ->
  insufficient_balance, no ledger row, no seat, no registration.
- Pre-merge pg_temp probes of the full flow: human short (refused to that human only, nobody charged, no game);
  human + horse matched (-50.00 each); two humans matched; one short; timeout; decline.

## Simultaneous, repeated and interrupted requests (independent sessions)

`scripts/ci/test-heads-up-rematch-concurrency-postgres.py` installs the merged core and doors on an isolated PostgreSQL
cluster. It requires their md5s to equal production's above, then drives them from separate psql sessions released at
the same instant. Workflow `heads-up-rematch-concurrency.yml` ran it green on PostgreSQL 17 at main (run 42569886982).
- 12 rounds of 8 simultaneous Yes requests (4 per player) plus repeats: one rematch, one game, two seats, exactly one
  charge per player, both charges committed by one transaction, repeats inert.
- A Yes cancelled inside the second purchase, after the first player was already charged in that transaction: no
  charge, no game, no seat, and the accept list unchanged. The retry matched once. The same holds for a terminated
  connection.
- A client killed before reading its answer: the server committed, and the retry and repeat read the same match with no
  extra charge.
- Short wallet, horse opponent, Yes/No race from one player, dead session and changed buy-in layer: each whole.
- Mutation check: with the `FOR UPDATE` row locks removed, the first round creates three stray games.

## Signed-in Play Again, committed and dealt by the engine (production)

Workflow `Heads-Up Rematch Certification`, run 42584396854. Route: reserved certification accounts, chips from a
`Cert HU` club's own opening grant, real NLH Heads-Up 1 Turbo terms (0.95 + 0.05 fee, 300 chips).
- Both players bought their seats through the browser's seat door. The engine started the game, which finished at
  08:15:30.9Z: prize 1.90 to the winner, 0.10 rake kept.
- Player A tapped Play Again in a real signed-in browser at 08:15:52.7Z (the respond call answered 200). Player B's Yes
  at 08:15:55.2Z matched the rematch.
- Committed: rematch row `matched`; new game `19dabd1c` in the same club; the same two players (winner in seat 1); both
  1.00 buy-ins written at the same instant 08:15:55.18915Z; prize pool 1.90 and rake 0.10, as in the first game.
- The browser moved itself to `/table/9e28ffee...`. The engine started the rematch at 08:15:58.2Z and dealt its first
  hand at 08:16:49.3Z.
- Run 42581709358 matched an earlier live rematch the same way (`2ca5c5af`; engine start 3 s after the match).
- The rematch finished at 09:01:46Z (on the turn timer; the test player had stopped acting at the second table): 1.90
  prize to the winner, 0.10 rake. Both wallets end at 7.90, which totals 15.80: the 16.00 funded less four fees of 0.05
  across the two games, so chips are conserved.
