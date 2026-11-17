# tests/a-finished-tournaments-table-resolves-its-stall.law.test.ts

The stall watch resolves a TableStoppedDealing episode when the table's tournament is COMPLETED or CANCELLED, in its own ingest pass, because that table will never deal again; no later migration may drop that step.
