# tests/a-buyin-guarantee-counts-the-whole-payment.law.test.ts

Dan, 2026-11-05: the full player payment (places + bounty + rake) counts toward a buy-in guarantee; the house funds only max(0, guarantee - gross) once, reconciled against what it already posted (migration 20261105222502), screens never stack the guarantee on collected money, and every door that sizes an overlay before close (the readiness read and its publish/start guards, the affordability trigger, the bank-short notice, the satellite seat funding at lock and its return, the digest estimate) reads the same credit, never guarantee - prize_pool (migration 20261107183629).
Follow-up 20261107204028: a satellite's guaranteed seats are measured against places only and a Diamond event keeps its place-based guarantee; only the buy-in guarantee takes the whole-payment credit.

Owner November 7 supersedes gross coverage: guarantees cover places and bounties after rake. The historical migrations remain recorded; current arithmetic, final-ten-minute rescue and source installation are pinned by `tests/net-guarantee-and-overlay-rescue.law.test.ts`.
