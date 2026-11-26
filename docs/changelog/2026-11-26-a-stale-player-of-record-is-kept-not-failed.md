# 2026-11-26: A stale player of record is kept, not failed

Club Create Certification failed on every run from 2026-11-25 03:38 UTC. The stale-account sweep it
embeds could keep an identity only when the identity owned a retired fixture club. A heads-up rematch
certification that died left two reserved player identities (`7ab530c9`, `819bd2ec`) whose only residue is
one finished entry each in the retired club `8791a0ab`. The account door refuses them, correctly, because a
`tournament_players` row is immutable history, so the sweep reported them as unrecovered on every run.

The sweep now reads the identity's residue when the door refuses. It keeps the identity as a player of
record only when every entry is in a finished event of a retired club, every membership is a zero-balance
player row, and no seat is open. Live or unreadable residue still fails the run.
Tests: `tests/unit/productionE2EAccount.test.ts`, block "a stale player of record of a retired
certification club is kept, not failed". Evidence:
`docs/production-alerts/evidence/club-create-cert-stale-player-of-record/`.
