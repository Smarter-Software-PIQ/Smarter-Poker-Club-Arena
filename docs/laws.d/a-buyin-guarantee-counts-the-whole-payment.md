# tests/a-buyin-guarantee-counts-the-whole-payment.law.test.ts

Dan, 2026-11-05: the full player payment (places + bounty + rake) counts toward a buy-in guarantee; the house funds only max(0, guarantee - gross) once, reconciled against what it already posted (migration 20261105222502), and screens never stack the guarantee on collected money.
