#!/usr/bin/env python3
"""Real isolated PostgreSQL proof of Backup sequence ownership and dependencies."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin', type=Path, required=True)
    parser.add_argument('--scratch-root', type=Path, required=True)
    parser.add_argument('--owners-sql', type=Path, default=ROOT / 'server/standby/standby-owners.sql')
    args = parser.parse_args()
    source = args.owners_sql.read_text()
    scratch = Path(tempfile.mkdtemp(prefix='seq-', dir=args.scratch_root))
    socket = scratch / 's'
    socket.mkdir()
    data = scratch / 'd'
    env = {key: os.environ[key] for key in ('PATH', 'LANG', 'LC_ALL', 'TZ') if key in os.environ}
    started = False

    def run(command, **kwargs):
        return subprocess.run([str(x) for x in command], env=env, text=True,
                              capture_output=True, timeout=45, **kwargs)

    def sql(query, user='supabase_admin', expected=True):
        result = run([args.pg_bin / 'psql', '-X', '-qAt', '-h', socket, '-p', '55481',
                      '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], input=query)
        if expected and result.returncode:
            raise RuntimeError(result.stderr)
        return result

    def check(query, label):
        assert sql(query).stdout.strip() == 't', label

    try:
        result = run([args.pg_bin / 'initdb', '-D', data, '-U', 'supabase_admin', '--auth=trust', '--no-locale'])
        assert result.returncode == 0, result.stderr
        result = run([args.pg_bin / 'pg_ctl', '-D', data, '-l', scratch / 'server.log',
                      '-o', f"-k {socket} -p 55481 -c listen_addresses=''", '-w', 'start'])
        assert result.returncode == 0, result.stderr
        started = True
        sql("""
CREATE ROLE postgres LOGIN NOSUPERUSER;
CREATE ROLE service_role LOGIN NOSUPERUSER;
CREATE SCHEMA smarter_private;
CREATE SCHEMA unrelated;
CREATE SEQUENCE public.global_hand_number_seq;
CREATE SEQUENCE smarter_private.f06_lifecycle_seq;
GRANT SELECT ON public.global_hand_number_seq TO service_role;
CREATE TABLE public.serial_fixture(id bigserial PRIMARY KEY);
CREATE TABLE public.identity_fixture(id bigint GENERATED ALWAYS AS IDENTITY);
CREATE SEQUENCE public.extension_fixture;
ALTER EXTENSION plpgsql ADD SEQUENCE public.extension_fixture;
CREATE SEQUENCE unrelated.untouched;
CREATE TABLE public.untouched_table(id bigint);
ALTER EXTENSION plpgsql ADD TABLE public.untouched_table;
CREATE SEQUENCE public.external_owned;
ALTER SEQUENCE public.external_owned OWNED BY public.untouched_table.id;
CREATE FUNCTION public.allocate_hand() RETURNS bigint LANGUAGE sql SECURITY DEFINER
 SET search_path=pg_catalog AS $$SELECT nextval('public.global_hand_number_seq')$$;
CREATE FUNCTION smarter_private.allocate_lifecycle() RETURNS bigint LANGUAGE sql SECURITY DEFINER
 SET search_path=pg_catalog AS $$SELECT nextval('smarter_private.f06_lifecycle_seq')$$;
ALTER FUNCTION public.allocate_hand() OWNER TO postgres;
ALTER FUNCTION smarter_private.allocate_lifecycle() OWNER TO postgres;
GRANT USAGE ON SCHEMA smarter_private TO postgres,service_role;
""")
        for call in ('public.allocate_hand()', 'smarter_private.allocate_lifecycle()'):
            denied = sql('SELECT ' + call, user='service_role', expected=False)
            assert denied.returncode != 0 and 'permission denied for sequence' in denied.stderr, denied
        dependencies = """SELECT c.relname,d.deptype,d.refobjid,d.refobjsubid FROM pg_depend d
JOIN pg_class c ON c.oid=d.objid WHERE d.classid='pg_class'::regclass
AND d.refclassid='pg_class'::regclass AND d.deptype IN ('a','i') AND c.relkind='S' ORDER BY c.relname"""
        before = sql(dependencies).stdout
        sql(source)
        assert sql('SELECT public.allocate_hand(),smarter_private.allocate_lifecycle()', user='service_role').stdout.strip() == '1|1'
        check("SELECT NOT rolsuper FROM pg_roles WHERE rolname='postgres'", 'definer is not superuser')
        check("SELECT bool_and(relowner='postgres'::regrole) FROM pg_class WHERE oid IN ('public.global_hand_number_seq'::regclass,'smarter_private.f06_lifecycle_seq'::regclass,'public.serial_fixture_id_seq'::regclass,'public.identity_fixture_id_seq'::regclass)", 'standalone and table-owned counters follow postgres')
        check("SELECT bool_and(relowner='supabase_admin'::regrole) FROM pg_class WHERE oid IN ('public.extension_fixture'::regclass,'unrelated.untouched'::regclass,'public.external_owned'::regclass)", 'extension and unrelated owners preserved')
        assert sql(dependencies).stdout == before, 'serial, identity and external ownership dependencies changed'
        denied = sql("SELECT nextval('public.global_hand_number_seq')", user='service_role', expected=False)
        assert denied.returncode != 0 and 'permission denied' in denied.stderr, 'direct service-role privilege broadened'
        sql("INSERT INTO public.serial_fixture DEFAULT VALUES; INSERT INTO public.identity_fixture DEFAULT VALUES;", user='postgres')
        sql(source)
        assert sql('SELECT public.allocate_hand(),smarter_private.allocate_lifecycle()', user='service_role').stdout.strip() == '2|2'
        assert sql(dependencies).stdout == before, 'repeat alignment changed dependencies'
        print(json.dumps({'qualified': True, 'source_sha256': hashlib.sha256(source.encode()).hexdigest(),
                          'regression': 'NOSUPER definer nextval denied before alignment and succeeds after',
                          'preserved': ['serial', 'identity', 'extension', 'external-owned', 'unrelated-schema', 'direct-role ACL'],
                          'repeat_alignment': True, 'production_actions': False}))
    finally:
        if started:
            result = run([args.pg_bin / 'pg_ctl', '-D', data, '-m', 'fast', '-w', 'stop'])
            assert result.returncode == 0, result.stderr
        shutil.rmtree(scratch)


if __name__ == '__main__':
    main()
