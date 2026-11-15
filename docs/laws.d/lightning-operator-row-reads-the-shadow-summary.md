# tests/lightning-operator-row-reads-the-shadow-summary.law.test.ts

The Lightning operator row (fn_lightning_operator_cluster_row) reads its shadow summary itself instead of running the full fn_lightning_shadow_report per cluster (the 8 s timeout behind the Operator page HTTP 500): 20261115010232 patches the exact production image under its md5, never calls the report, keeps every output key and the report's binding, seated, both-scores, first-pair and verdict rules. The real-PostgreSQL proof is tests/unit/lightningOperatorRowShadowSummary.pg.test.ts.
