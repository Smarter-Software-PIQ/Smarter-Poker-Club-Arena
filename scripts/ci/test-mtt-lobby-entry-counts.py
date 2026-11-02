#!/usr/bin/env python3
"""Real PG17 aggregate/ACL/RLS proof; no production money or seats."""
import os, subprocess, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
BASE = Path(os.environ.get('TMPDIR') or os.environ.get('RUNNER_TEMP') or tempfile.gettempdir())
if __import__('sys').platform == 'darwin' and not str(BASE).startswith('/Volumes/SmarterWork/agent-work/'):
    raise RuntimeError('Use task-owned external SSD scratch')
ENV = {k:v for k,v in os.environ.items() if not k.startswith('PG')}
def main():
    with tempfile.TemporaryDirectory(prefix='mtt-entry-counts-', dir=BASE) as folder:
        d=Path(folder); sock=d/'s'; sock.mkdir()
        def cmd(args): return subprocess.run([str(v) for v in args], env=ENV, text=True, capture_output=True, check=True).stdout
        cmd([PG/'initdb','-D',d/'db','-U','postgres','-A','trust','--no-locale','--encoding=UTF8'])
        cmd([PG/'pg_ctl','-D',d/'db','-l',d/'log','-o',f"-k {sock} -p 55489 -c listen_addresses='' -c shared_buffers=16MB",'-w','start'])
        def sql(text, fail=False):
            r=subprocess.run([str(PG/'psql'),'-X','-At','-v','ON_ERROR_STOP=1','-h',str(sock),'-p','55489','-U','postgres','-d','postgres','-c',text],env=ENV,text=True,capture_output=True)
            if r.returncode and not fail: raise AssertionError(r.stderr)
            return r.stderr if fail else r.stdout.strip()
        passed=[]
        def check(name, actual, expected):
            if actual != expected: raise AssertionError(f'{name}: {actual!r} != {expected!r}')
            passed.append(name)
        a='00000000-0000-4000-8000-000000000001'; b='00000000-0000-4000-8000-000000000002'; c='00000000-0000-4000-8000-000000000003'
        try:
            sql('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE tournaments(id uuid PRIMARY KEY, visible boolean);
CREATE TABLE tournament_players(tournament_id uuid, status text, rebuys integer, add_on boolean);
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
CREATE POLICY visible ON tournaments FOR SELECT TO authenticated USING(visible);
GRANT SELECT ON tournaments,tournament_players TO authenticated, service_role;''')
            migration=next((ROOT/'supabase/migrations').glob('*_mtt_lobby_counts_registrations_and_rebuys_as_entries.sql'))
            sql(migration.read_text())
            sql(f"INSERT INTO tournaments VALUES('{a}',true),('{b}',true),('{c}',false); INSERT INTO tournament_players VALUES('{a}','playing',2,true),('{a}','eliminated',3,false),('{a}','registered',NULL,false),('{c}','playing',100,true);")
            call=f"SELECT tournament_id||':'||entries FROM fn_mtt_lobby_entry_counts(ARRAY['{a}','{b}','{a}']::uuid[]) ORDER BY tournament_id;"
            check('initial entries plus every rebuy, eliminated retained, addons excluded, duplicate IDs once',sql('SET ROLE authenticated;'+call).splitlines()[-2:],[a+':8',b+':0'])
            check('private event not exposed',sql(f"SET ROLE authenticated; SELECT count(*) FROM fn_mtt_lobby_entry_counts(ARRAY['{c}']::uuid[]);").splitlines()[-1],'0')
            check('anonymous denied', 'permission denied' in sql('SET ROLE anon;'+call,True),True)
            check('empty list empty',sql("SELECT count(*) FROM fn_mtt_lobby_entry_counts('{}');"),'0')
            check('null list refused','entry_count_ids_required' in sql('SELECT * FROM fn_mtt_lobby_entry_counts(NULL);',True),True)
            check('oversized list refused','entry_count_ids_limit' in sql(f"SELECT * FROM fn_mtt_lobby_entry_counts(array_fill('{a}'::uuid,ARRAY[201]));",True),True)
            sql(f"UPDATE tournament_players SET status='eliminated' WHERE tournament_id='{a}';")
            check('eliminations do not lower entries',sql(call).splitlines()[0],a+':8')
            sql(f"UPDATE tournament_players SET rebuys=coalesce(rebuys,0)+1 WHERE tournament_id='{a}' AND rebuys=2;")
            check('one additional rebuy adds exactly one',sql(call).splitlines()[0],a+':9')
            print('\n'.join('PASS '+name for name in passed))
        finally:
            cmd([PG/'pg_ctl','-D',d/'db','-m','immediate','-w','stop'])
if __name__ == '__main__': main()
