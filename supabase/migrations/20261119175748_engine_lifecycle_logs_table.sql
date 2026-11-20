-- Incident 075013fd (Lane 1): persist bounded engine lifecycle logs (boot,
-- shutdown, leadership loss, FATAL / uncaughtException / unhandledRejection)
-- directly in the database so any crash or failed boot can be diagnosed
-- without SSHing to the Hetzner host.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

CREATE TABLE IF NOT EXISTS public.engine_lifecycle_logs (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  instance_id text NOT NULL CHECK (length(instance_id) >= 1 AND length(instance_id) <= 128),
  release_sha text CHECK (release_sha IS NULL OR length(release_sha) <= 64),
  level text NOT NULL CHECK (level IN ('info', 'warn', 'error', 'fatal')),
  event text NOT NULL CHECK (length(event) >= 1 AND length(event) <= 128),
  message text NOT NULL CHECK (length(message) <= 4000),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(detail) = 'object' AND octet_length(detail::text) <= 16384)
);

CREATE INDEX IF NOT EXISTS ix_engine_lifecycle_logs_created_at
  ON public.engine_lifecycle_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS ix_engine_lifecycle_logs_level_created_at
  ON public.engine_lifecycle_logs (level, created_at DESC);

ALTER TABLE public.engine_lifecycle_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.engine_lifecycle_logs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.engine_lifecycle_logs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.engine_lifecycle_logs_id_seq TO service_role;

COMMENT ON TABLE public.engine_lifecycle_logs IS
  'Bounded append-only engine boot, shutdown, and FATAL/crash logs so engine crashes can be read from the database without SSHing to the host.';

COMMIT;
