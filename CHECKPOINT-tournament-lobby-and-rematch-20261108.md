# CHECKPOINT - tournament lobby, satellite names and heads-up rematch (2026-11-08/09)

Lane: tournament-lobby (session_01BbZPDhrfyf3rn1wmuxqmwe). Owner requests of 2026-11-08: WATCH plate, no "0 GTD",
agents' players card on every tab, Rewards pins the hero, satellites named "Satellite Into <target>", heads-up Play Again.

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
  - #10143, #10147, #10149 and #10152 (`5714e647afb7298af01a71885d1739a908b84023`): fixes found by the live runs.

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
- Not yet seen: the end of the rematch (its test player stopped acting at the second table, so the turn timer is
  playing it out), and the chip total after both games.

## Open

- Weekly satellite: no weekly-schedule satellite has spawned since the name fix. Spawns land exactly 72 h ahead; the
  next is "40 Chip Freezeout (NLH) Satellite 5" for 2026-11-12 15:45Z, created about 2026-11-09 15:45Z. "Friday Feature
  Satellite 5" (schedule b997f1e3) has not spawned since 2026-11-04; that is not this lane's.
- Frozen satellites 6cb6f619 (last hand 2026-11-08 04:53:56Z) and 7a41f0a1 (last hand 23:48:49Z): both still RUNNING
  at level 12 at 08:30Z. An ACK was requested in COORDINATION-INBOX.md (05:10Z) and on PR #10063 from the cutover owner
  (01BbZPDjeNdeckeaEd3XTkrj), with the release-blockers lane copied; none had arrived by 08:30Z. Their recovery belongs
  to the Nov 9 04:00 Chicago release (66cfdde743 is in its candidate floor). This lane makes no mutation on either.
- Certification residue: the `Cert HU` clubs from runs 42572669237, 42577549337, 42581709358 and 42584396854, and their
  reserved players, are settled by the Cert Residue Sweep through `settleStrandedHeadsUpClub` (#10147/#10149) once
  their games end. Run 42569893917's two zero-balance players are in an already retired club and are recovered by the
  same sweep.
- The old draft branch `claude/heads-up-rematch-1108` (closed PR #10093) was deleted at about 05:28Z through the Mac's GitHub login (the cloud proxy refuses ref deletes).
