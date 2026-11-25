CREATE OR REPLACE FUNCTION public.fn_ca_undeclared_money_paths()
 RETURNS TABLE(proname text, tbl text, col text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH watched AS (
    SELECT c.relname::text AS tbl,
           (regexp_matches(pg_get_triggerdef(t.oid), '''([a-z_]+)=([a-z_]+)''', 'g'))[1] AS col
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_proc  p ON p.oid = t.tgfoid
     -- IN (...), not '=': a migration that reads pg_get_functiondef and holds
     -- an EXECUTE must not read as redefining the journal trigger it names
     -- (tests/a-declared-guard-change-is-recorded-not-raised.law.test.ts).
     WHERE NOT t.tgisinternal AND p.proname IN ('fn_ca_autoledger')
  ), fns AS (
    SELECT p.proname::text AS proname, p.prosrc,
           (p.prosrc ILIKE '%fn_ca_declare_ledger%'
            OR p.prosrc ILIKE '%app.ledger_counterparty%') AS declares,
           (p.prosrc ~* 'INSERT\s+INTO\s+(public\.)?chip_ledger\y') AS writes_own_leg
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
  )
  SELECT DISTINCT f.proname, w.tbl, w.col
    FROM fns f
    JOIN watched w
      -- statement-scoped: the column is ASSIGNED by an UPDATE of the table
      ON f.prosrc ~* ('UPDATE\s+(public\.)?' || w.tbl || '\y[^;]*?\ySET\y[^;]*?\y' || w.col || '\s*=')
   WHERE NOT f.declares
     -- the second contract: the table's journal stood down, the door's own leg written
     AND NOT (f.writes_own_leg AND f.prosrc ~* ('ledger_autoskip_' || w.tbl || '\y'))
     AND f.proname NOT IN ('fn_ca_autoledger', 'fn_ca_autoledger_delete',
                           'fn_ca_declare_ledger', 'fn_ca_undeclared_money_paths')
     -- 2026-09-12: a function AUDITED AS MOVING NO MONEY is not an undeclared
     -- money path. status='system' IS that audit, written into
     -- ca_money_rpc_registry by the ab_ca_money_rpc_registered event trigger
     -- before the function is allowed to exist.
     AND NOT EXISTS (SELECT 1 FROM public.ca_money_rpc_registry g
                      WHERE g.proname = f.proname AND g.status = 'system')
   ORDER BY 1, 2, 3
$function$

