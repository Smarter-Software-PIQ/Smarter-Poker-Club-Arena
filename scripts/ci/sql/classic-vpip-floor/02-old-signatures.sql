-- The OLD production signatures, so a changed return type is caught here.
CREATE OR REPLACE FUNCTION public.fn_nit_status(p_table_id uuid)
 RETURNS TABLE(user_id uuid, hands integer, vpip numeric, required integer,
               window_hands integer, evict boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $f$ BEGIN RETURN; END $f$;
REVOKE ALL ON FUNCTION public.fn_nit_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_nit_status(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_nit_evictions(p_table_id uuid)
 RETURNS TABLE(user_id uuid, vpip numeric, required integer, hands integer)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $f$ BEGIN RETURN; END $f$;
REVOKE ALL ON FUNCTION public.fn_nit_evictions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_nit_evictions(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_nit_check(p_table_id uuid, p_user_id uuid,
  p_since timestamptz DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $f$ BEGIN RETURN '{}'::jsonb; END $f$;
GRANT EXECUTE ON FUNCTION public.fn_nit_check(uuid,uuid,timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_cash_vpip_status(p_table_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $f$ BEGIN RETURN '{}'::jsonb; END $f$;
GRANT EXECUTE ON FUNCTION public.fn_cash_vpip_status(uuid) TO authenticated, service_role;
