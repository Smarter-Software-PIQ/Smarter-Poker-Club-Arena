-- Fixture ordinary migration whose DO $probe$ fails against production's schema
-- (reproduces PR #12325 / 20261128074415 / incident 37a45c05 alert 450013).
BEGIN;
DO $probe$
BEGIN
  RAISE EXCEPTION 'probe failed: simulated trigger double-ingest returned NULL';
END $probe$;
COMMIT;
