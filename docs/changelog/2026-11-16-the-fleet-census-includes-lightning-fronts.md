# The fleet census includes Lightning fronts

Incident ea14ea51-587c-4cf0-bdb8-397f499ff7f6, original engine alert 3116.
At 13:17 UTC November 16 production reported two expected dealing tables and
72 consecutive below-floor checks. In the previous five minutes, hand_history
recorded committed hands at seven Lightning fronts and one Classic table.
GameServer passed only ordinary unpaused table loops to DealRateVerifier;
Lightning anchors are deliberately halted while their worker deals hands.

The supervisor now supplies the durable front-table ids of running, forming,
unheld pools with at least two connected input devices and a current locally
held lease. GameServer unions those ids with ordinary dealing tables. Each
pool counts once, independently of its transient hands. The verifier still
reads committed hand_history rows for these ids and still reports confirmed
silence; no threshold, maintenance guard or recovery action changes.

Regression: the new supervisor test fails before the source change and passes
after it. The connected verifier fixture checks all eight ids against the
actual database-query builder, then confirms that zero durable hands still
raises ClubArenaFleetSilent. The existing Lightning remediation and verifier
suites passed (53 tests, including the connected fixture).
Deployment and live alert resolution remain pending; this file is source
and local evidence only.
