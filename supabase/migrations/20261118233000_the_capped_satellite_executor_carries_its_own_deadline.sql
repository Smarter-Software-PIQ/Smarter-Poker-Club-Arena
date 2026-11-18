-- @live-proof: (SELECT proconfig @> ARRAY['statement_timeout=45s','lock_timeout=8s','search_path=public, pg_temp'] FROM pg_proc WHERE oid='public.fn_execute_capped_satellite_terminal_request(uuid,uuid)'::regprocedure)
-- Incidents 12edc9a0 / 5968b285 / 46b78962 / 65660ecc (2026-11-18).
-- Set the correct statement_timeout, lock_timeout, and ensure search_path is preserved.
BEGIN;
ALTER FUNCTION public.fn_execute_capped_satellite_terminal_request(uuid,uuid)
  SET statement_timeout = '45s';
ALTER FUNCTION public.fn_execute_capped_satellite_terminal_request(uuid,uuid)
  SET lock_timeout = '8s';
ALTER FUNCTION public.fn_execute_capped_satellite_terminal_request(uuid,uuid)
  SET search_path = 'public', 'pg_temp';
COMMIT;
