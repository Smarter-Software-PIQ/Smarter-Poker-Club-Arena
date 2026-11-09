CREATE SCHEMA smarter_private;
CREATE TABLE smarter_private.weekly_payout_phase_configuration(singleton boolean PRIMARY KEY DEFAULT true, cutover_period_end timestamptz NOT NULL);
CREATE TABLE smarter_private.weekly_payout_financial_receipts(scope_kind text, scope_id uuid, period_start timestamptz, period_end timestamptz);
CREATE TABLE public.union_accounting_runs(scope_kind text, scope_id uuid, period_start timestamptz, period_end timestamptz, status text, result jsonb);
-- Union weeks close Mondays 08:00 UTC; floor to the boundary, idempotent.
CREATE FUNCTION public.fn_union_week_start(timestamptz) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS
$$SELECT (date_trunc('week', ($1 - interval '8 hours') AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') + interval '8 hours'$$;
CREATE FUNCTION public.fn_union_prev_week_start(timestamptz) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS
$$SELECT public.fn_union_week_start($1) - interval '7 days'$$;
CREATE TABLE smarter_private.eligible_scopes_stub(kind text, id uuid, first_week timestamptz);
CREATE FUNCTION smarter_private.weekly_payout_eligible_scopes(p_end timestamptz, p_now timestamptz)
RETURNS TABLE(kind text, id uuid, first_week timestamptz) LANGUAGE sql AS
$$SELECT kind, id, first_week FROM smarter_private.eligible_scopes_stub$$;
CREATE FUNCTION sr_assert(b boolean, msg text) RETURNS void LANGUAGE plpgsql AS
$$BEGIN IF b IS DISTINCT FROM true THEN RAISE EXCEPTION '%', msg; END IF; END$$;
INSERT INTO smarter_private.weekly_payout_phase_configuration(singleton, cutover_period_end) VALUES(true, '2026-10-26 08:00Z');
