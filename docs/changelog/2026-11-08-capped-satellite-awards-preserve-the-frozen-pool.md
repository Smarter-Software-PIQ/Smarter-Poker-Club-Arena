# Capped satellite awards preserve the frozen pool

A satellite whose funded pool buys more tickets than its actual field retains
one ticket per frozen award slot and the residual value attached to the last
slot. Settlement previously recalculated an uncapped ticket count and refused
that valid frozen allocation. The canonical v3 receipt and prize cache now verify
the ticket and attached remainder additively, including an all-survivor cohort
whose final award recipient has no eliminated ranking.

The schema installs compatibly before engine activation. Only the successor
qualifier executor opts into capped settlement, carrying the existing original
request and generation. Ordinary and legacy receipts retain their contracts.
Isolated PostgreSQL cases exercise real entry funding and guarantee overlay,
immutable entitlements, conservation, original-cohort retry and foreign refusal.
Production verification follows protected installation and certified cutover.
