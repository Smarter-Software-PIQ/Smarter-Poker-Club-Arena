-- TIER: 1 hardening. Incident 758cd269 (TournamentFinishRefusalsPersisting, rake_attribution). AUTHOR: Claude.
-- APPLIED: production 2026-11-18 07:23:56 UTC (recorded version 20261118072356).
-- WHY IT BROKE: 2026-11-18 06:16 and 06:19 UTC a session re-ran the August file
-- 20260826_tournament_rake_settlement_integrity.sql (applied 2026-08-27 as 20260827011455,
-- recorded with comments stripped). Nothing in the database noticed it was writing bodies
-- superseded dozens of times since, so five money functions went back 2.5 months and every
-- tournament finish was refused. At 06:24 a hand-assembled statement did the same to
-- fn_club_share_figures and resurrected a dropped function.
-- THE LAW: every body a public/smarter_private function has ever had is fingerprinted
-- (comments and whitespace removed, so cosmetic variants match) in
-- smarter_private.function_body_lineage. A CREATE FUNCTION whose fingerprint is a SUPERSEDED
-- body of that function is refused at the statement, whatever tool or person runs it.
-- A dropped function's last body becomes superseded, so resurrection is refused too.
-- Deliberate rollback stays possible and explicit:
--   SET LOCAL ca.allow_function_rollback = 'public.fn_name';
-- VERIFIED LIVE 07:24 UTC (rolled-back probe): new body allowed; old body with different
-- comments/spacing refused (55000); idempotent re-apply allowed; deliberate rollback with the
-- GUC allowed; re-creating a dropped function's old body refused (55000).
SET LOCAL statement_timeout = '300s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION smarter_private.fn_ca_body_fingerprint(p_src text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $fp$
  SELECT md5(lower(regexp_replace(regexp_replace(regexp_replace(
           COALESCE(p_src,''), '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g'), '\s+', '', 'g')))
$fp$;
REVOKE ALL ON FUNCTION smarter_private.fn_ca_body_fingerprint(text) FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS smarter_private.function_body_lineage (
  fn_key        text        NOT NULL,                 -- schema.name (overloads share a lineage)
  body_fp       text        NOT NULL,                 -- smarter_private.fn_ca_body_fingerprint(prosrc)
  state         text        NOT NULL CHECK (state IN ('live','superseded')),
  first_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  superseded_at timestamptz,
  source        text        NOT NULL,                 -- seed:<migration version> | seed:live | ddl
  PRIMARY KEY (fn_key, body_fp)
);
COMMENT ON TABLE smarter_private.function_body_lineage IS
  'Fingerprint of every body each public/smarter_private function has had. A superseded body may never be re-created without SET LOCAL ca.allow_function_rollback. Incident 758cd269.';
REVOKE ALL ON smarter_private.function_body_lineage FROM PUBLIC, anon, authenticated, service_role;

-- Seed 1: every body ever applied by a recorded migration.
DO $seed$
DECLARE r record; p int; nm text[]; frag text; tag text; body text; tp int;
BEGIN
  FOR r IN SELECT m.version, st.stmt FROM supabase_migrations.schema_migrations m, unnest(m.statements) st(stmt)
            WHERE st.stmt ~* 'CREATE\s+(OR\s+REPLACE\s+)?FUNCTION' ORDER BY m.version LOOP
    p := 1;
    LOOP
      p := regexp_instr(r.stmt, 'CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+', p, 1, 0, 'i');
      EXIT WHEN p = 0;
      frag := substr(r.stmt, p, 400000);
      nm  := regexp_match(frag, '^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?([A-Za-z0-9_]+)"?\.)?"?([A-Za-z0-9_]+)"?\s*\(', 'i');
      tag := (regexp_match(frag, '\mAS\s+(\$[A-Za-z0-9_]*\$)', 'i'))[1];
      tp  := CASE WHEN tag IS NULL THEN 0 ELSE strpos(frag, tag) END;
      -- A ';' before the dollar tag means a quoted body: skip it rather than misattribute.
      IF nm IS NULL OR tp = 0 OR strpos(substr(frag, 1, tp), ';') > 0 THEN p := p + 10; CONTINUE; END IF;
      body := split_part(substr(frag, tp + length(tag)), tag, 1);
      IF lower(COALESCE(nm[1],'public')) IN ('public','smarter_private') THEN
        INSERT INTO smarter_private.function_body_lineage(fn_key, body_fp, state, superseded_at, source)
        VALUES (lower(COALESCE(nm[1],'public'))||'.'||lower(nm[2]), smarter_private.fn_ca_body_fingerprint(body),
                'superseded', clock_timestamp(), 'seed:'||r.version)
        ON CONFLICT (fn_key, body_fp) DO NOTHING;
      END IF;
      p := p + tp + 2*length(tag) + length(body);
    END LOOP;
  END LOOP;
END $seed$;

-- Seed 2: what is live now is live (wins over history for the same fingerprint).
INSERT INTO smarter_private.function_body_lineage(fn_key, body_fp, state, superseded_at, source)
SELECT DISTINCT n.nspname||'.'||p.proname, smarter_private.fn_ca_body_fingerprint(p.prosrc), 'live', NULL::timestamptz, 'seed:live'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname IN ('public','smarter_private') AND p.prokind IN ('f','p')
ON CONFLICT (fn_key, body_fp) DO UPDATE SET state='live', superseded_at=NULL;

CREATE OR REPLACE FUNCTION smarter_private.fn_ca_function_lineage_on_create()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'smarter_private'
AS $guard$
DECLARE c record; v_key text; v_fp text; v_old record; v_allow text;
BEGIN
  FOR c IN SELECT * FROM pg_event_trigger_ddl_commands()
            WHERE object_type IN ('function','procedure') AND schema_name IN ('public','smarter_private') LOOP
    SELECT n.nspname||'.'||p.proname, smarter_private.fn_ca_body_fingerprint(p.prosrc) INTO v_key, v_fp
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid = c.objid;
    CONTINUE WHEN v_key IS NULL;

    SELECT * INTO v_old FROM smarter_private.function_body_lineage
     WHERE fn_key = v_key AND body_fp = v_fp AND state = 'superseded';
    IF FOUND THEN
      v_allow := COALESCE(current_setting('ca.allow_function_rollback', true), '');
      IF v_key <> ALL (string_to_array(replace(v_allow,' ',''), ',')) THEN
        RAISE EXCEPTION 'SUPERSEDED_FUNCTION_BODY_REFUSED: % is being set back to a body that was superseded at % (first recorded by %). This is a replay of an old definition; apply the current migration instead. If the rollback is deliberate, run SET LOCAL ca.allow_function_rollback = ''%'' in the same transaction.',
          c.object_identity, v_old.superseded_at, v_old.source, v_key
          USING ERRCODE = '55000';
      END IF;
    END IF;

    BEGIN
      UPDATE smarter_private.function_body_lineage l
         SET state='superseded', superseded_at=clock_timestamp()
       WHERE l.fn_key = v_key AND l.state='live'
         AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                          WHERE n.nspname||'.'||p.proname = v_key
                            AND smarter_private.fn_ca_body_fingerprint(p.prosrc) = l.body_fp);
      INSERT INTO smarter_private.function_body_lineage(fn_key, body_fp, state, source)
      VALUES (v_key, v_fp, 'live', 'ddl')
      ON CONFLICT (fn_key, body_fp) DO UPDATE SET state='live', superseded_at=NULL;
    EXCEPTION WHEN OTHERS THEN
      -- Bookkeeping must never block unrelated DDL; the refusal above is the law.
      RAISE WARNING 'function_body_lineage bookkeeping failed for %: %', v_key, SQLERRM;
    END;
  END LOOP;
END $guard$;

CREATE OR REPLACE FUNCTION smarter_private.fn_ca_function_lineage_on_drop()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'smarter_private'
AS $drop$
DECLARE d record; v_key text;
BEGIN
  FOR d IN SELECT * FROM pg_event_trigger_dropped_objects()
            WHERE object_type IN ('function','procedure') AND schema_name IN ('public','smarter_private') LOOP
    v_key := d.schema_name||'.'||split_part(split_part(d.object_identity, '(', 1), '.', 2);
    BEGIN
      UPDATE smarter_private.function_body_lineage l
         SET state='superseded', superseded_at=clock_timestamp()
       WHERE l.fn_key = v_key AND l.state='live'
         AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                          WHERE n.nspname||'.'||p.proname = v_key
                            AND smarter_private.fn_ca_body_fingerprint(p.prosrc) = l.body_fp);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'function_body_lineage drop bookkeeping failed for %: %', v_key, SQLERRM;
    END;
  END LOOP;
END $drop$;

REVOKE ALL ON FUNCTION smarter_private.fn_ca_function_lineage_on_create() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION smarter_private.fn_ca_function_lineage_on_drop()   FROM PUBLIC, anon, authenticated, service_role;

DROP EVENT TRIGGER IF EXISTS ca_superseded_function_body_is_refused;
CREATE EVENT TRIGGER ca_superseded_function_body_is_refused ON ddl_command_end
  WHEN TAG IN ('CREATE FUNCTION','CREATE PROCEDURE')
  EXECUTE FUNCTION smarter_private.fn_ca_function_lineage_on_create();

DROP EVENT TRIGGER IF EXISTS ca_dropped_function_body_is_superseded;
CREATE EVENT TRIGGER ca_dropped_function_body_is_superseded ON sql_drop
  EXECUTE FUNCTION smarter_private.fn_ca_function_lineage_on_drop();

DO $assert$ BEGIN
  -- The exact August bodies that were replayed (fingerprints of the repo file) are superseded.
  IF (SELECT count(*) FROM smarter_private.function_body_lineage
       WHERE state='superseded' AND (fn_key, body_fp) IN (
         ('public.fn_settle_tournament_rake','609246f4ae4968e176e4ec6f5f52def7'),
         ('public.fn_sweep_unsettled_tournament_rake','2e5d36c59451af9a6f7014df5f930a05'),
         ('public.process_tournament_rebuy','98ec995647b8cffb7a1b414a8050386e'),
         ('public.fn_unregister_from_tournament','802dd75ef33bfa4f8a5fc198a2aded61'),
         ('public.atomic_cancel_tournament','a1f6bf56d9e7c1e0ac65ac0173c60de9'))) <> 5 THEN
    RAISE EXCEPTION 'ASSERT FAILED: not all five replayed August bodies are recorded as superseded'; END IF;
  IF NOT EXISTS (SELECT 1 FROM smarter_private.function_body_lineage l
                   JOIN pg_proc p ON p.oid = to_regprocedure('public.fn_settle_tournament_rake(uuid,text)')
                  WHERE l.fn_key='public.fn_settle_tournament_rake' AND l.state='live'
                    AND l.body_fp = smarter_private.fn_ca_body_fingerprint(p.prosrc)) THEN
    RAISE EXCEPTION 'ASSERT FAILED: the current settle body is not live'; END IF;
  -- No live function may be marked superseded (the guard would refuse a harmless re-apply).
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              JOIN smarter_private.function_body_lineage l
                ON l.fn_key = n.nspname||'.'||p.proname AND l.body_fp = smarter_private.fn_ca_body_fingerprint(p.prosrc)
             WHERE n.nspname IN ('public','smarter_private') AND l.state <> 'live') THEN
    RAISE EXCEPTION 'ASSERT FAILED: a live body is marked superseded'; END IF;
END $assert$;
