#!/usr/bin/env python3
"""Native proof for 20261108191909_a_stalled_solver_round_is_paged.

Runs the exact migration file against a throwaway PostgreSQL 17 cluster (never
production) with the minimal production shapes it reads and writes, then
drives fn_gto_v31_round_stall_check through every outcome.
"""
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261108191909_a_stalled_solver_round_is_paged.sql'


def pg_bin(name):
    for candidate in (os.environ.get('PG_BIN'), '/usr/lib/postgresql/17/bin', '/opt/homebrew/opt/postgresql@17/bin'):
        if candidate and Path(candidate, name).exists():
            return str(Path(candidate, name))
    found = shutil.which(name)
    if not found:
        raise SystemExit(f'{name} (PostgreSQL 17) is required')
    return found


# Column types match production (financial_alerts.id is uuid; the 2026-11-02
# stall check shipped a bigint fixture and hid a production bug for 3 days).
SCHEMA = """
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE TABLE public.gto_v31_program_state (id boolean PRIMARY KEY DEFAULT true, state text NOT NULL,
  decided_at timestamptz NOT NULL);
CREATE TABLE public.gto_v31_datasets (dataset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dataset_key text,
  state text, created_at timestamptz NOT NULL DEFAULT now(), sealed_at timestamptz, candidate_at timestamptz,
  audited_at timestamptz, promoted_at timestamptz, retired_at timestamptz);
CREATE TABLE public.gto_v31_source_artifacts (id bigserial PRIMARY KEY, dataset_id uuid, machine_id text,
  solved_at timestamptz, ingested_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.gto_v31_model_preparations (dataset_id uuid, prepared_at timestamptz);
CREATE TABLE public.gto_v31_model_freezes (dataset_id uuid, frozen_at timestamptz);
CREATE TABLE public.gto_v31_runtime_cells (dataset_id uuid, built_at timestamptz);
CREATE TABLE public.gto_v31_evaluation_epochs (dataset_id uuid, opened_at timestamptz);
CREATE TABLE public.gto_v31_release_evaluations (dataset_id uuid, evaluated_at timestamptz);
CREATE TABLE public.solver_worker_heartbeats (machine_id text, received_at timestamptz);
CREATE TABLE public.solver_compact_heartbeats (received_at timestamptz);
CREATE TABLE public.engine_leader (id boolean PRIMARY KEY DEFAULT true, instance_id text, engine_version text,
  acquired_at timestamptz, heartbeat_at timestamptz);
CREATE TABLE public.gto_v31_serving_bindings (binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dataset_id uuid,
  serving_commit text, bound_at timestamptz DEFAULT now(), revoked_at timestamptz);
CREATE TABLE public.financial_alerts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text CHECK (severity = ANY (ARRAY['critical','warning','info'])), source text, message text,
  context jsonb, resolved boolean NOT NULL DEFAULT false, resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), resolved_by text, resolution text);
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.job(jobname, schedule, command) VALUES (n, s, c) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS
  $$ DELETE FROM cron.job WHERE jobname = n RETURNING true $$;
"""


def main():
    os.environ.setdefault('LC_ALL', 'C')
    os.environ.setdefault('LANG', 'C')
    scratch = Path(tempfile.mkdtemp(prefix='round-stall-', dir=os.environ.get('TMPDIR') or os.environ.get('RUNNER_TEMP')))
    data = scratch / 'data'
    sock = Path(tempfile.mkdtemp(prefix='pgs', dir=os.environ.get('PG_SOCKET_ROOT') or scratch))
    subprocess.run([pg_bin('initdb'), '-D', str(data), '-U', 'postgres', '-A', 'trust'], check=True, capture_output=True)
    port = str(55000 + os.getpid() % 5000)
    subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-o', f"-k {sock} -p {port} -c listen_addresses=''",
                    '-l', str(scratch / 'log'), '-w', 'start'], check=True, capture_output=True)
    try:
        def sql(text):
            r = subprocess.run([pg_bin('psql'), '-h', str(sock), '-p', port, '-U', 'postgres', '-d', 'postgres',
                                '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', text],
                               capture_output=True, text=True)
            assert r.returncode == 0, f'{text}\n{r.stderr}'
            return r.stdout.strip()

        sql(SCHEMA)
        r = subprocess.run([pg_bin('psql'), '-h', str(sock), '-p', port, '-U', 'postgres', '-d', 'postgres',
                            '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', str(MIGRATION)], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        proof = re.search(r'^-- @live-proof: (.+)$', MIGRATION.read_text(), re.M).group(1)
        assert sql(f'SELECT {proof}') == 't', 'live proof must hold after install'

        def check(field='state'):
            return sql(f"SELECT public.fn_gto_v31_round_stall_check(6)->>'{field}'")

        def open_alerts():
            return int(sql("SELECT count(*) FROM financial_alerts WHERE source='fn_gto_v31_round_stall_check' AND NOT resolved"))

        # 1. No round in flight (program parked): nothing raised even long after the decision.
        sql("INSERT INTO gto_v31_program_state VALUES (true, 'parked', now() - interval '5 days')")
        assert check() == 'no_round' and open_alerts() == 0

        # 2. Round decided, no dataset yet, 2 hours ago: moving.
        sql("UPDATE gto_v31_program_state SET state='rebuilding', decided_at=now() - interval '2 hours'")
        assert check() == 'moving' and open_alerts() == 0
        assert check('last_progress_kind') == 'program decision'

        # 3. An older dataset (the closed R7) does not count as the round's dataset.
        sql("INSERT INTO gto_v31_datasets(dataset_key, state, created_at, audited_at) "
            "VALUES ('r7', 'evaluating', now() - interval '9 days', now() - interval '8 days')")
        assert check('dataset_id') in ('', None)

        # 4. The R8 shape of 2026-11-08: dataset registered, M1 captured rows, last heartbeat 12 hours ago.
        sql("UPDATE gto_v31_program_state SET decided_at=now() - interval '30 hours'")
        sql("INSERT INTO gto_v31_datasets(dataset_key, state, created_at) VALUES ('r8', 'building', now() - interval '19 hours')")
        sql("INSERT INTO gto_v31_source_artifacts(dataset_id, machine_id, solved_at, ingested_at) "
            "SELECT dataset_id, 'M1', now() - interval '12 hours', now() - interval '12 hours' FROM gto_v31_datasets WHERE dataset_key='r8'")
        sql("INSERT INTO solver_worker_heartbeats VALUES ('M1', now() - interval '11 hours 59 minutes')")
        assert check() == 'stalled' and open_alerts() == 1
        row = sql("SELECT severity||'|'||(context->>'dataset_key')||'|'||(context->>'dataset_state')||'|'||"
                  "(context->>'last_progress_kind')||'|'||(context->'source_rows'->>'M1') "
                  "FROM financial_alerts WHERE source='fn_gto_v31_round_stall_check'")
        assert row == 'warning|r8|building|solver host heartbeat|1', row
        assert 'solver-host.sh check' in sql("SELECT message FROM financial_alerts WHERE source='fn_gto_v31_round_stall_check'")

        # 5. Still stalled: no duplicate page.
        assert check() == 'stalled' and open_alerts() == 1

        # 6. Any later stage counts as progress and resolves the page with the re-measurement.
        sql("INSERT INTO gto_v31_model_preparations SELECT dataset_id, now() FROM gto_v31_datasets WHERE dataset_key='r8'")
        assert check() == 'moving' and open_alerts() == 0
        assert 'model prepared' in sql("SELECT resolution FROM financial_alerts WHERE source='fn_gto_v31_round_stall_check'")

        # 7. Idle again past the window: one new page.
        sql("UPDATE gto_v31_model_preparations SET prepared_at = now() - interval '7 hours'")
        sql("UPDATE solver_worker_heartbeats SET received_at = now() - interval '13 hours'")
        assert check() == 'stalled' and open_alerts() == 1

        # 8. Each other progress source resolves it in turn.
        for stmt in [
            "INSERT INTO solver_compact_heartbeats VALUES (now())",
            "INSERT INTO gto_v31_evaluation_epochs SELECT dataset_id, now() FROM gto_v31_datasets WHERE dataset_key='r8'",
            "INSERT INTO gto_v31_release_evaluations SELECT dataset_id, now() FROM gto_v31_datasets WHERE dataset_key='r8'",
            "UPDATE gto_v31_datasets SET sealed_at = now() WHERE dataset_key='r8'",
        ]:
            sql("UPDATE solver_compact_heartbeats SET received_at = now() - interval '8 hours'")
            sql("UPDATE gto_v31_evaluation_epochs SET opened_at = now() - interval '8 hours'")
            sql("UPDATE gto_v31_release_evaluations SET evaluated_at = now() - interval '8 hours'")
            sql("UPDATE gto_v31_datasets SET sealed_at = now() - interval '8 hours' WHERE sealed_at IS NOT NULL")
            check()
            assert open_alerts() == 1, stmt
            sql(stmt)
            assert check() == 'moving' and open_alerts() == 0, stmt

        # 9. A promoted dataset is not a round in flight; the decision is the anchor again.
        sql("UPDATE gto_v31_datasets SET promoted_at = now() WHERE dataset_key='r8'")
        assert check('dataset_id') in ('', None)

        # 10. The program leaving 'rebuilding' resolves an open page.
        sql("UPDATE gto_v31_datasets SET promoted_at = NULL, sealed_at = now() - interval '9 hours' WHERE dataset_key='r8'")
        sql("UPDATE solver_compact_heartbeats SET received_at = now() - interval '9 hours'")
        sql("UPDATE gto_v31_evaluation_epochs SET opened_at = now() - interval '9 hours'")
        sql("UPDATE gto_v31_release_evaluations SET evaluated_at = now() - interval '9 hours'")
        assert check() == 'stalled' and open_alerts() == 1
        sql("UPDATE gto_v31_program_state SET state='certified'")
        assert check() == 'no_round' and open_alerts() == 0

        # 11. Re-running the migration's scheduling is idempotent; grants hold.
        assert sql("SELECT count(*) FROM cron.job WHERE jobname='gto-v31-round-stall-check-hourly'") == '1'
        assert sql("SELECT has_function_privilege('anon','public.fn_gto_v31_round_stall_check(integer)','EXECUTE')") == 'f'
        assert sql("SELECT has_function_privilege('authenticated','public.fn_gto_v31_round_stall_check(integer)','EXECUTE')") == 'f'
        assert sql("SELECT has_function_privilege('service_role','public.fn_gto_v31_round_stall_check(integer)','EXECUTE')") == 't'
        # --- fn_gto_v31_serving_binding_check ---
        def bcheck(field='state'):
            return sql(f"SELECT public.fn_gto_v31_serving_binding_check(8)->>'{field}'")

        def bopen():
            return int(sql("SELECT count(*) FROM financial_alerts WHERE source='fn_gto_v31_serving_binding_check' AND NOT resolved"))

        serving = '391f7bc0' + '1' * 32
        sql(f"INSERT INTO engine_leader VALUES (true, '1-abc', '{serving[:8]}', now() - interval '2 hours', now())")
        # 12. No playbook in service: nothing to bind.
        assert bcheck() == 'bound_or_none' and bopen() == 0
        # 13. Playbook promoted, engine led 2h without a binding: unbound, inside the re-check grace, no page.
        sql("UPDATE gto_v31_datasets SET promoted_at = now() - interval '3 days' WHERE dataset_key='r8'")
        assert bcheck() == 'unbound' and bopen() == 0
        # 14. Past the grace: one warning naming the playbook and the engine; no duplicate.
        sql("UPDATE engine_leader SET acquired_at = now() - interval '9 hours'")
        assert bcheck() == 'unbound' and bopen() == 1
        row = sql("SELECT severity||'|'||(context->>'dataset_key')||'|'||(context->>'serving_version') "
                  "FROM financial_alerts WHERE source='fn_gto_v31_serving_binding_check'")
        assert row == 'warning|r8|391f7bc0', row
        assert bcheck() == 'unbound' and bopen() == 1
        # 15. A stale leader is unknown: neither raises nor resolves.
        sql("UPDATE engine_leader SET heartbeat_at = now() - interval '10 minutes'")
        assert bcheck() == 'leader_unknown' and bopen() == 1
        sql("UPDATE engine_leader SET heartbeat_at = now()")
        # 16. A binding for another engine does not count; one for this engine resolves the page.
        sql("INSERT INTO gto_v31_serving_bindings(dataset_id, serving_commit) SELECT dataset_id, 'deadbeef' || repeat('0',32) FROM gto_v31_datasets WHERE dataset_key='r8'")
        assert bcheck() == 'unbound' and bopen() == 1
        sql(f"INSERT INTO gto_v31_serving_bindings(dataset_id, serving_commit) SELECT dataset_id, '{serving}' FROM gto_v31_datasets WHERE dataset_key='r8'")
        assert bcheck() == 'bound_or_none' and bopen() == 0
        # 17. A revoked binding is no binding: a new page after the grace.
        sql("UPDATE gto_v31_serving_bindings SET revoked_at = now()")
        assert bcheck() == 'unbound' and bopen() == 1
        # 18. A different engine leads: the old page closes; the new engine gets its own grace.
        sql("UPDATE engine_leader SET engine_version='5b6c7d8e', acquired_at=now() - interval '5 minutes', heartbeat_at=now()")
        assert bcheck() == 'unbound' and bopen() == 0
        # 19. A retired playbook is never paged.
        sql("UPDATE engine_leader SET acquired_at = now() - interval '9 hours'")
        sql("UPDATE gto_v31_datasets SET retired_at = now() WHERE dataset_key='r8'")
        assert bcheck() == 'bound_or_none' and bopen() == 0
        assert sql("SELECT count(*) FROM cron.job WHERE jobname='gto-v31-serving-binding-check-hourly' AND schedule='19 * * * *'") == '1'
        assert sql("SELECT has_function_privilege('anon','public.fn_gto_v31_serving_binding_check(integer)','EXECUTE')") == 'f'
        print('a stalled solver round and an unbound serving engine are paged: 19/19 behaviours proven')
    finally:
        subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(scratch, ignore_errors=True)


if __name__ == '__main__':
    main()
