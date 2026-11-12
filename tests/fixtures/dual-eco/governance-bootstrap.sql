-- Only unrelated detector inputs are synthetic. The risk detector, sweep,
-- original ECO proof, component records and invoice validators are real owners.
CREATE TABLE union_club_terms(union_id uuid,club_id uuid,stop_loss_limit numeric,status text,stakes_cap_bb numeric);
CREATE TABLE tables(club_id uuid,big_blind numeric,is_deleted boolean,status text);
CREATE TABLE accounting_close_gates(scope_kind text,scope_id uuid,period_start timestamptz,period_end timestamptz,gate_until timestamptz);
CREATE FUNCTION fn_union_club_exposure(uuid) RETURNS TABLE(club_name text,exposure numeric,stop_loss_limit numeric,breached boolean,status text) LANGUAGE sql AS $$ SELECT NULL::text,NULL::numeric,NULL::numeric,false,NULL::text WHERE false $$;
CREATE FUNCTION fn_anon_exposure_check() RETURNS TABLE(invariant text,severity text,offenders bigint,detail text) LANGUAGE sql AS $$ SELECT NULL::text,NULL::text,0::bigint,NULL::text WHERE false $$;
CREATE FUNCTION fn_ca_launch_accounting_waived(text,uuid,timestamptz) RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.launch_waived',true)='yes' IS TRUE $$;
CREATE FUNCTION fn_union_accounting_run_at(timestamptz) RETURNS timestamptz LANGUAGE sql AS $$ SELECT CASE WHEN current_setting('test.not_due',true)='yes' THEN now()+interval '1 hour' ELSE $1+interval '2 hours' END $$;
CREATE FUNCTION fn_union_prev_week_start() RETURNS timestamptz LANGUAGE sql AS $$ SELECT fn_union_week_start(fn_union_week_start()-interval '1 day') $$;
CREATE TABLE ca_drift_incidents(id uuid DEFAULT gen_random_uuid(),source text,status text,metadata jsonb);
CREATE TABLE ca_detector_runs(detector text,ran_at timestamptz DEFAULT now(),detail jsonb);
CREATE TABLE fixture_raised(n bigserial,source text,metadata jsonb);
CREATE FUNCTION fn_ca_ledger_audit_checkpoint_advance() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
CREATE FUNCTION fn_ca_raise_drift_incident(text,text,text,text,numeric,numeric,numeric,text,text,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid[],uuid[],text,boolean,jsonb)
RETURNS uuid LANGUAGE plpgsql AS $$ BEGIN INSERT INTO fixture_raised(source,metadata) VALUES($1,$21); RETURN NULL; END $$;
CREATE FUNCTION fn_union_governance_check() RETURNS TABLE(invariant text,severity text,offenders bigint,detail text) LANGUAGE sql AS $$ SELECT * FROM fn_union_credit_risk_check() $$;
