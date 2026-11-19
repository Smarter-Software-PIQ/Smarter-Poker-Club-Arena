-- @live-proof: (SELECT proconfig @> ARRAY['statement_timeout=45s','lock_timeout=8s'] FROM pg_proc WHERE oid='public.fn_execute_capped_satellite_terminal_request(uuid,uuid)'::regprocedure)
-- Incidents 12edc9a0 / 5968b285 / 46b78962 / 65660ecc (2026-11-18).
-- Every satellite qualifier settlement is sent by the engine through PostgREST to
-- fn_execute_capped_satellite_terminal_request. PostgREST applies the
-- statement_timeout of the function it calls; this wrapper declared none, so the
-- whole settlement ran under service_role's 8s, not the 45s its inner
-- fn_execute_tournament_terminal_request declares (pg_stat_statements max 7,937 ms;
-- 204 "canceling statement due to statement timeout" refusals in 12 h). The
-- refusal held the qualifier boundary, darkened the event and stopped MTT play.
-- The entrypoint now carries the same deadline and lock limit as the request it runs.
BEGIN;
ALTER FUNCTION public.fn_execute_capped_satellite_terminal_request(uuid,uuid)
  SET statement_timeout = '45s';
ALTER FUNCTION public.fn_execute_capped_satellite_terminal_request(uuid,uuid)
  SET lock_timeout = '8s';
COMMIT;
