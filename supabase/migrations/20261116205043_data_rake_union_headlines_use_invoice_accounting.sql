-- Rake on Data must answer the same accounting question as its Data page.
-- Union-backed windows use the existing Pacific invoice projection. Legacy
-- standalone/pre-union windows and agent cash production keep their contracts.
-- @live-proof: to_regprocedure('public.fn_ca_rake_invoice_windows_v3(uuid[],date,date,boolean)') IS NOT NULL AND to_regprocedure('public.fn_ca_rake_invoice_series_v2(uuid[],date,date,text)') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.ca_rake_snapshot_pacific_v2(text,uuid,uuid,date,date,uuid,integer,integer,text,text)') AND position('union_invoice_accounting' IN prosrc)>0 AND position('fn_ca_rake_invoice_windows_v3' IN prosrc)>0)
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='60s';
DO $helpers$ DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.fn_ca_rake_windows_pacific_v3(uuid[],date,date,boolean)'::regprocedure);
 IF md5(d)<>'38315e98a64a84a4bd2e580399293636' THEN RAISE EXCEPTION 'RAKE_INVOICE_WINDOW_PREIMAGE_CHANGED'; END IF;
 d:=replace(d,'FUNCTION public.fn_ca_rake_windows_pacific_v3(','FUNCTION public.fn_ca_rake_invoice_windows_v3(');
 d:=replace(d,'public.ca_club_data_pacific_game_ct','public.ca_club_acct_fact_ct');
 d:=replace(d,'public.ca_club_data_pacific_hands_ct','public.ca_club_acct_hands_ct');
 -- Invoice hand results already include chips on the felt. A seat without
 -- accounting activity cannot add a cashflow-only game or duplicate winnings.
 d:=replace(d,'SELECT * FROM public.fn_ca_rake_felt_pacific_v2($1, $2, $3)',
 'SELECT NULL::uuid table_id,NULL::uuid club_id,NULL::date stat_date,0::numeric felt WHERE false');
 EXECUTE d;
 d:=pg_get_functiondef('public.fn_ca_rake_series_pacific_v2(uuid[],date,date,text)'::regprocedure);
 IF md5(d)<>'7f19f7f22dc3d413f19ad651bbcac9cb' THEN RAISE EXCEPTION 'RAKE_INVOICE_SERIES_PREIMAGE_CHANGED'; END IF;
 d:=replace(d,'FUNCTION public.fn_ca_rake_series_pacific_v2(','FUNCTION public.fn_ca_rake_invoice_series_v2(');
 d:=replace(d,'public.ca_club_data_pacific_game_ct','public.ca_club_acct_fact_ct');
 d:=replace(d,' UNION ALL SELECT stat_date,0,felt FROM public.fn_ca_rake_felt_pacific_v2(p_clubs,p_start,p_end)','');
 EXECUTE d;
END $helpers$;
REVOKE ALL ON FUNCTION public.fn_ca_rake_invoice_windows_v3(uuid[],date,date,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_ca_rake_invoice_series_v2(uuid[],date,date,text) FROM PUBLIC,anon,authenticated,service_role;
DO $snapshot$ DECLARE d text;v_gate text;
BEGIN
 d:=pg_get_functiondef('public.ca_rake_snapshot_pacific_v2(text,uuid,uuid,date,date,uuid,integer,integer,text,text)'::regprocedure);
 IF md5(d)<>'14fedc62d12f4fb9009a1e8aeb69cfc2' THEN RAISE EXCEPTION 'RAKE_INVOICE_SNAPSHOT_PREIMAGE_CHANGED'; END IF;
 d:=replace(d,'  v_pacific_final jsonb; v_pacific_previous jsonb;',
 '  v_pacific_final jsonb; v_pacific_previous jsonb; v_invoice boolean; v_prev_invoice boolean; v_context uuid; v_coverage jsonb;');
 d:=replace(d,E'  IF v_scope <> ''agent'' THEN\n    PERFORM public.fn_ca_club_data_pacific_require(coalesce(p_union_id,p_club_id),v_start,v_end,731);\n  END IF;\n','');
 v_gate:=$gate$ v_invoice:=public.fn_ca_club_data_reads_union_basis(v_context,v_start,v_end);
 v_coverage:=CASE WHEN v_invoice THEN public.fn_ca_club_acct_coverage(v_context,v_start,v_end)
 ELSE public.fn_ca_club_data_pacific_coverage(v_context,v_start,v_end,731) END;
 IF NOT coalesce((v_coverage->>'complete')::boolean,false) THEN
 RAISE EXCEPTION 'CLUB_DATA_PACIFIC_WINDOW_INCOMPLETE: selected report source is not qualified' USING ERRCODE='P0001'; END IF;
$gate$;
 d:=replace(d,'    v_w := public.fn_ca_rake_windows_pacific_v3(v_clubs, v_start, v_end, true);',
 '    v_context:=v_union;'||v_gate||'    v_w:=CASE WHEN v_invoice THEN public.fn_ca_rake_invoice_windows_v3(v_clubs,v_start,v_end,true) ELSE public.fn_ca_rake_windows_pacific_v3(v_clubs,v_start,v_end,true) END;');
 d:=replace(d,'    v_clubs := ARRAY[p_club_id];','    v_context:=p_club_id;'||v_gate||'    v_clubs := ARRAY[p_club_id];');
 d:=replace(d,'  IF v_cur IS NULL THEN v_cur := public.fn_ca_rake_window_pacific_v2(v_clubs, v_start, v_end); END IF;',
 '  IF v_cur IS NULL THEN v_cur:=CASE WHEN v_invoice THEN public.fn_ca_rake_invoice_windows_v3(v_clubs,v_start,v_end,false)->''all'' ELSE public.fn_ca_rake_window_pacific_v2(v_clubs,v_start,v_end) END; END IF;');
 d:=replace(d,'  v_prev := public.fn_ca_rake_window_pacific_v2(v_clubs, v_pstart, v_pend);', $previous$
 v_prev_invoice:=public.fn_ca_club_data_reads_union_basis(v_context,v_pstart,v_pend);
 v_pacific_previous:=CASE WHEN v_prev_invoice THEN public.fn_ca_club_acct_coverage(v_context,v_pstart,v_pend)
 ELSE public.fn_ca_club_data_pacific_coverage(v_context,v_pstart,v_pend,731) END;
 IF v_prev_invoice IS DISTINCT FROM v_invoice THEN v_pacific_previous:=v_pacific_previous||jsonb_build_object('complete',false,'basis_mismatch',true); END IF;
 v_prev:=CASE WHEN NOT coalesce((v_pacific_previous->>'complete')::boolean,false) THEN '{}'::jsonb
 WHEN v_prev_invoice THEN public.fn_ca_rake_invoice_windows_v3(v_clubs,v_pstart,v_pend,false)->'all'
 ELSE public.fn_ca_rake_window_pacific_v2(v_clubs,v_pstart,v_pend) END;
$previous$);
 d:=replace(d,'  v_series := public.fn_ca_rake_series_pacific_v2(v_clubs, v_start, v_end, v_bucket);',
 '  v_series:=CASE WHEN v_invoice THEN public.fn_ca_rake_invoice_series_v2(v_clubs,v_start,v_end,v_bucket) ELSE public.fn_ca_rake_series_pacific_v2(v_clubs,v_start,v_end,v_bucket) END;');
 d:=replace(d,E'    ''accounting_basis'',''pacific_net_money_flow'',''day_basis'',''America/Los_Angeles 00:00'',''generated_at'',now());\n  v_pacific_previous:=public.fn_ca_club_data_pacific_coverage(coalesce(p_union_id,p_club_id),v_pstart,v_pend,731);',
 E'    ''accounting_basis'',CASE WHEN v_invoice THEN ''union_invoice_accounting'' ELSE ''pacific_net_money_flow'' END,''day_basis'',''America/Los_Angeles 00:00'',''generated_at'',now());');
 d:=replace(d,'''accounting_coverage'',jsonb_build_object(''complete'',true)','''accounting_coverage'',v_coverage');
 d:=replace(d,'ELSE (SELECT max(g.last_at) FROM public.ca_club_data_pacific_game_ct g',
 'ELSE CASE WHEN v_invoice THEN (SELECT max(g.last_at) FROM public.ca_club_acct_fact_ct g WHERE g.club_id=ANY(v_clubs) AND g.stat_date BETWEEN v_start AND v_end) ELSE (SELECT max(g.last_at) FROM public.ca_club_data_pacific_game_ct g');
 d:=replace(d,E'WHERE g.club_id = ANY(v_clubs) AND g.stat_date BETWEEN v_start AND v_end) END,',E'WHERE g.club_id = ANY(v_clubs) AND g.stat_date BETWEEN v_start AND v_end) END END,');
 EXECUTE d;
END $snapshot$;
REVOKE ALL ON FUNCTION public.ca_rake_snapshot_pacific_v2(text,uuid,uuid,date,date,uuid,integer,integer,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ca_rake_snapshot_pacific_v2(text,uuid,uuid,date,date,uuid,integer,integer,text,text) TO authenticated,service_role;
DO $export$ DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.ca_rake_export_start_pacific_v2(text,uuid,date,date,uuid,text,text,uuid)'::regprocedure);
 IF md5(d)<>'1c213eafbb1874dd925590a7bab41f0b' THEN RAISE EXCEPTION 'RAKE_INVOICE_EXPORT_PREIMAGE_CHANGED'; END IF;
 d:=replace(d,'  v_request uuid :=','  v_report_basis text; v_invoice boolean; v_request uuid :=');
 d:=replace(d,'  -- One start per user at a time, refused immediately rather than queued.', $identity$
 v_invoice:=v_scope IN('club','union') AND public.fn_ca_club_data_reads_union_basis(v_scope_id,v_start,v_end);
 v_report_basis:=CASE WHEN v_invoice THEN 'union_invoice_accounting' ELSE 'pacific_net_money_flow' END;
 IF v_invoice THEN v_request:=md5('ca-data-pacific-invoice:'||v_request::text)::uuid; END IF;
 -- One start per user at a time, refused immediately rather than queued.$identity$);
 d:=replace(d,'IF v_existing.metadata->>''day_basis'' IS DISTINCT FROM ''America/Los_Angeles 00:00'' OR',
 'IF (v_invoice AND v_existing.metadata->>''accounting_basis'' IS DISTINCT FROM v_report_basis) OR v_existing.metadata->>''day_basis'' IS DISTINCT FROM ''America/Los_Angeles 00:00'' OR');
 d:=replace(d,'''day_basis'', ''America/Los_Angeles 00:00'', ''generated_at'', snapshot_shape.document -> ''generated_at'',',
 '''accounting_basis'', snapshot_shape.document -> ''accounting_basis'', ''day_basis'', ''America/Los_Angeles 00:00'', ''generated_at'', snapshot_shape.document -> ''generated_at'',');
 EXECUTE d;
END $export$;
REVOKE ALL ON FUNCTION public.ca_rake_export_start_pacific_v2(text,uuid,date,date,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ca_rake_export_start_pacific_v2(text,uuid,date,date,uuid,text,text,uuid) TO authenticated,service_role;
COMMIT;
