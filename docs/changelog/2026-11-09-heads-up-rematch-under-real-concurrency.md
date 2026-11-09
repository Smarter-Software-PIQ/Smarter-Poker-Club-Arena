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

It runs in `ci.yml` (shard 4, PostgreSQL 17). `classify-ci-changes.mjs` runs
it whenever its harness or fixture changes, and also on any migration change.
