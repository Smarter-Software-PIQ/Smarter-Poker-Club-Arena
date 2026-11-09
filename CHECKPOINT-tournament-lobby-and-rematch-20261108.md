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

## Open, with owner

- Natural events still to observe: the first real rematch row in `ca_heads_up_rematches` and that the engine starts
  its game; the first Midway weekly satellite spawned after #10124 (unscheduled spawns since are all named
  correctly).
- Simultaneous accepts: serialized by the row lock; not executable inside one rolled-back transaction.
- Frozen satellites 6cb6f619 (last hand 2026-11-08 04:53:56Z) and 7a41f0a1 (last hand 23:48:49Z): handed to the
  tournament-monitor owner in COORDINATION-INBOX.md at 02:07Z; no ACK yet. The release-blockers lane says 6cb6f619
  resumes only on an engine carrying #10059; tonight's 04:00 Chicago release is theirs to verify.
- Same-AI-opponent rematch needs no engine change (the horse is seated by its own door in the same transaction);
  release owner told in the inbox.
