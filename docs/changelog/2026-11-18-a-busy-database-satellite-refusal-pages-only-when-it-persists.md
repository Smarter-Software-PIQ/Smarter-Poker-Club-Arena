# A busy-database satellite refusal pages only when it persists (2026-11-18)

Incident a30d27f9 (`Tournament.satellite_qualifiers_refused_repeatedly`, satellite
3f9f1ff2 "Satellite Into Union Mystery Bounty (PLO5)", 20 qualifiers).

## What happened (production, read-only)

- 19:22:15Z and 19:22:26Z: two qualifier settlements were cancelled by PostgreSQL
  with `canceling statement due to statement timeout` (57014), inside the promo
  profit settle and ledger writer triggers. Both rolled back; nothing committed.
- The second identical refusal raised the CRITICAL alert at 19:22:27Z ("cannot
  finish until the refusal is fixed").
- 19:22:38Z: the next sweep settled every qualifier and the tournament completed.
  The alert closed at 19:24Z on its terminal receipt.
- Cause of the timeouts: the same database contention as incident 7c426a32
  (post-commit lag). The Midday Free Buy eb0c2d80 rebuy convoy queued up to 37
  rebuys on its exclusive tournament lane (each holding G shared while waiting),
  with ~1,800 lane waits a minute in the Postgres log between 19:15Z and 19:29Z.
  That convoy is owned by incident 075013fd lanes T (#11310, #11321) and R (#11322).

## The detector defect

The refusal counter was written for refusals that cannot change (2026-10-08:
missing obligation evidence, ~500 times). A busy-database refusal (statement or
lock timeout, deadlock victim, serialization failure) usually clears on the next
sweep, as the 2026-10-03 55P03 case and this one did. Two such refusals ten
seconds apart paged critical for a 21-second hold.

## The fix

`TournamentManagerEliminations.recordSatelliteSettlementRefusal`: a contention
refusal (`isContentionRefusal`) pages only once the same refusal has persisted for
`SATELLITE_CONTENTION_GRACE_MS` (5 minutes). Every other refusal still pages on its
first repeat. The retry, the held boundary and the alert key are unchanged.

Law: `server/src/tournament/aSettlementRefusedTheSameWayEverySweepIsAnIncident.law.test.ts`.

This is engine code: it activates with the next certified engine release in the
04:00-04:05 America/Chicago window.
