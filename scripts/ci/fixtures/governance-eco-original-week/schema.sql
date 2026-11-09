CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE fixture_clock(at timestamptz);
INSERT INTO fixture_clock VALUES('2026-11-09 15:00Z');
CREATE FUNCTION fn_union_week_start(p_at timestamptz DEFAULT NULL)
RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT date_trunc('week',COALESCE(p_at,(SELECT at FROM fixture_clock)) AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles'
$$;
CREATE FUNCTION fn_union_prev_week_start() RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT fn_union_week_start(fn_union_week_start()-interval '1 day')
$$;
CREATE FUNCTION fn_union_accounting_run_at(timestamptz) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$SELECT $1+interval '2 hours'$$;
CREATE FUNCTION fn_ca_launch_accounting_waived(text,uuid,timestamptz) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$SELECT false$$;
CREATE TABLE unions(id uuid,settings jsonb);
INSERT INTO unions VALUES('fade0000-0000-0000-0000-000000000001','{"eco_enabled":true}');
CREATE TABLE union_clubs(union_id uuid,club_id uuid);
INSERT INTO union_clubs VALUES('fade0000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
CREATE TABLE accounting_close_gates(scope_kind text,scope_id uuid,period_start timestamptz,period_end timestamptz,gate_until timestamptz);
CREATE TABLE union_accounting_runs(scope_kind text,scope_id uuid,period_start timestamptz,period_end timestamptz,status text,result jsonb);
CREATE TABLE union_eco_ledger(union_id uuid,club_id uuid,period_start timestamptz,period_end timestamptz);
CREATE TABLE ca_drift_incidents(id uuid PRIMARY KEY,source text,dedupe_key text,status text,
  closure_basis text,detected_at timestamptz,resolved_at timestamptz,resolved_by uuid,
  resolution text,root_cause text,correction_ref text,metadata jsonb,created_at timestamptz,last_seen_at timestamptz);
CREATE TABLE ca_incident_events(incident_id uuid,kind text,actor_label text,detail jsonb);
CREATE TABLE ca_detector_runs(detector text,ran_at timestamptz DEFAULT now(),detail jsonb);
CREATE TABLE fixture_rows(rows jsonb);
INSERT INTO fixture_rows VALUES('[{"invariant":"union_eco_not_recorded"}]');
CREATE FUNCTION fn_union_governance_check() RETURNS TABLE(invariant text)
LANGUAGE sql STABLE AS $$SELECT value->>'invariant' FROM fixture_rows,jsonb_array_elements(rows)$$;
CREATE TABLE fixture_raised(n bigserial,source text,metadata jsonb);
CREATE FUNCTION fn_ca_ledger_audit_checkpoint_advance() RETURNS void LANGUAGE plpgsql AS $$BEGIN END$$;
CREATE FUNCTION fn_ca_raise_drift_incident(text,text,text,text,numeric,numeric,numeric,text,text,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid[],uuid[],text,boolean,jsonb)
RETURNS uuid LANGUAGE plpgsql AS $$BEGIN
  INSERT INTO fixture_raised(source,metadata) VALUES($1,$21);
  RETURN NULL;
END$$;
