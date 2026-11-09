-- Preserve the collusion scan's intended 120-second function budget. The
-- never-installed predecessor transaction was refused before any effects.
-- Its obsolete engine compatibility, manual payouts and status cleanup are
-- removed: the compatible BFF already owns canonical satellite settlement.
-- @live-proof: (SELECT proconfig @> ARRAY['statement_timeout=120s']::text[] FROM pg_proc WHERE oid='public.fn_ca_collusion_scan(integer)'::regprocedure)
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '15s';
ALTER FUNCTION public.fn_ca_collusion_scan(integer) SET statement_timeout TO '120s';
COMMIT;
