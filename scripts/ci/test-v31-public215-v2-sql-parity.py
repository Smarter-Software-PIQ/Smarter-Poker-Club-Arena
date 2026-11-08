#!/usr/bin/env python3
"""Native proof for the v2 SQL encoding chain (feature contract holdem-public-hist215-v2).

Throwaway PostgreSQL 17 cluster, never production. The frozen v1 encoder closure
(f64, ratio, graph, board_relative_key_v2, base181, features, compiled_raw) is
installed from byte-exact copies of its live definitions (md5-pinned), then the
migration's pure v2 section (between `-- @v2-pure-begin` and `-- @v2-pure-end`) is
executed unchanged. The proof:

  * TS/SQL parity: fn_gto_v31_public215_features_v2 equals Club Arena's own v2
    encoder (encodePublic215Features with the v2 template) bit for bit on a fixed
    R8 state set: 120 seeded states over 20 contexts plus the 200 build-receipt
    cases of the R8 public feature index (all 100 contexts); exact WTL masses are
    the production fn_gto_v31_public215_prepare_math rows for the same boards
  * v1 unchanged: on live R7 audited combos, features_v2[1:215] equals the stored
    v1 audit features and the v2 block is all zero; the v1 closure's md5s stay the
    production ones after the v2 section runs
  * width: compiled_raw_v2 reads feature 245 of a 246 vector; v1 compiled_raw still
    refuses a 246 vector and v2 refuses a 215 vector

`--mutations` re-runs the proof on deliberately broken copies of the pure section
and requires every one to be detected.
"""
import json, os, re, shutil, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = next((ROOT / 'supabase/migrations').glob('*_v31_public215_v2_sql_encoding_chain.sql'))
FIX = ROOT / 'scripts/ci/fixtures/v31-public215-v2-sql'
LIVE_MD5 = {
    'fn_gto_v31_public215_f64(text)': '05a44b6d1b99634e2f7a88f9551a8eb8',
    'fn_gto_v31_public215_ratio(numeric,numeric)': '3a345f00d3b196e94f4260ebc84dabf6',
    'fn_gto_v31_public215_graph(integer[],integer[])': '5d0fc2d2e7b0dbc4976ad5d8f4a7ba36',
    'fn_gto_v31_board_relative_key_v2(integer,text)': 'e09ec067e9b3f206da85e7e478eea5f6',
    'fn_gto_v31_public215_base181(integer,text,jsonb)': '36a6865e43055d1763bf5f0f139f8e63',
    'fn_gto_v31_public215_features(integer,text,jsonb,numeric[])': 'cbd07899e6fe45d20b81514890614f64',
    'fn_gto_v31_public215_compiled_raw(gto_v31_public215_head[],double precision[])': '3b315a9b55c3ec250a48ebde952e3cd1',
}


def pg_bin(name):
    for c in (os.environ.get('PG_BIN'), '/usr/lib/postgresql/17/bin', '/opt/homebrew/opt/postgresql@17/bin'):
        if c and Path(c, name).exists():
            return str(Path(c, name))
    found = shutil.which(name)
    if not found:
        raise SystemExit(f'{name} (PostgreSQL 17) is required')
    return found


class Cluster:
    def __init__(self):
        os.environ.setdefault('LC_ALL', 'C')
        self.scratch = Path(tempfile.mkdtemp(prefix='v31-v2sql-', dir=os.environ.get('TMPDIR') or os.environ.get('RUNNER_TEMP')))
        self.sock = Path(tempfile.mkdtemp(prefix='pgv', dir='/tmp'))
        self.data = self.scratch / 'data'
        subprocess.run([pg_bin('initdb'), '-D', str(self.data), '-A', 'trust', '-U', 'postgres', '--no-sync', '-E', 'UTF8'], check=True, capture_output=True)
        subprocess.run([pg_bin('pg_ctl'), '-D', str(self.data), '-l', str(self.scratch / 'pg.log'), '-w', '-o', f'-k {self.sock} -c listen_addresses= -c fsync=off', 'start'], check=True, capture_output=True)

    def psql(self, sql, db='postgres', check=True):
        r = subprocess.run([pg_bin('psql'), '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-h', str(self.sock), '-U', 'postgres', '-d', db],
                           input=sql, capture_output=True, text=True)
        if check and r.returncode:
            raise AssertionError(r.stderr.strip()[-2000:])
        return r

    def fresh(self, name):
        self.psql(f'DROP DATABASE IF EXISTS {name}; CREATE DATABASE {name};')
        return name

    def stop(self):
        subprocess.run([pg_bin('pg_ctl'), '-D', str(self.data), '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(self.scratch, ignore_errors=True); shutil.rmtree(self.sock, ignore_errors=True)


q = lambda s: "'" + s.replace("'", "''") + "'"


def pure_section(text):
    a, b = text.index('-- @v2-pure-begin'), text.index('-- @v2-pure-end')
    return text[a:b]


def md5s(pg, db):
    out = {}
    for sig in LIVE_MD5:
        out[sig] = pg.psql(f"SELECT md5(pg_get_functiondef('public.{sig}'::regprocedure));", db).stdout.strip()
    return out


def vec_sql(v, fn):
    mass = 'ARRAY[' + ','.join(q(str(x)) + '::numeric' for x in v['mass']) + ']'
    return (f"SELECT string_agg(encode(float8send(x),'hex'),',' ORDER BY o) FROM unnest(public.{fn}({v['combo']},{q(v['board'])},"
            f"{q(json.dumps(v['template']))}::jsonb,{mass})) WITH ORDINALITY u(x,o);")


def prove(pg, pure):
    db = pg.fresh('proof')
    pg.psql((FIX / '01-v1-encoder-closure.sql').read_text(), db)
    before = md5s(pg, db)
    assert before == LIVE_MD5, ('fixture is not the production v1 closure', before)
    pg.psql('BEGIN;\n' + pure + '\nCOMMIT;', db)
    assert md5s(pg, db) == LIVE_MD5, 'v1 closure changed'
    par = json.loads((FIX / '02-r8-ts-vectors.json').read_text())
    assert len(par) == 320 and len({p['template']['context']['texture_class'] + json.dumps(p['template'], sort_keys=True) for p in par}) == 100
    script = ''.join(vec_sql(v, 'fn_gto_v31_public215_features_v2') for v in par)
    got = pg.psql(script, db).stdout.strip().split('\n')
    assert len(got) == len(par)
    bad = [i for i, (v, g) in enumerate(zip(par, got)) if g.split(',') != v['ts_words']]
    assert not bad, f'TS/SQL v2 parity differs on {len(bad)} of {len(par)} states (first {bad[:5]})'
    r7 = [json.loads(l) for l in (FIX / '03-r7-v1-audited.jsonl').read_text().splitlines() if l.strip()]
    assert len(r7) == 12
    got = pg.psql(''.join(vec_sql(v, 'fn_gto_v31_public215_features_v2') for v in r7), db).stdout.strip().split('\n')
    for v, g in zip(r7, got):
        w = g.split(',')
        assert len(w) == 246 and w[:215] == v['v1_words'], 'v1 prefix differs from the stored R7 audit'
        assert w[215:] == ['0000000000000000'] * 31, 'v2 block of an R7 template is not zero'
    tree = "ROW(ARRAY[%d,-1,-1]::smallint[],ARRAY[0.5,0,0]::float8[],ARRAY[1,0,0]::smallint[],ARRAY[2,0,0]::smallint[],ARRAY[0,1,2]::float8[])::public.gto_v31_public215_tree"
    head = lambda f: f"ARRAY[ROW(10::float8,ARRAY[{tree % f}])::public.gto_v31_public215_head]"
    x = lambda n, hot: 'ARRAY[' + ','.join('1' if i == hot else '0' for i in range(n)) + ']::float8[]'
    assert pg.psql(f"SELECT public.fn_gto_v31_public215_compiled_raw_v2({head(245)},{x(246,245)});", db).stdout.strip() == '{12}'
    assert pg.psql(f"SELECT public.fn_gto_v31_public215_compiled_raw_v2({head(245)},{x(246,0)});", db).stdout.strip() == '{11}'
    assert pg.psql(f"SELECT public.fn_gto_v31_public215_compiled_raw({head(3)},{x(246,0)});", db, check=False).returncode != 0
    assert pg.psql(f"SELECT public.fn_gto_v31_public215_compiled_raw_v2({head(3)},{x(215,0)});", db, check=False).returncode != 0
    return len(par), len(r7)


MUTATIONS = {
    'appended order swapped': lambda s: s.replace("'hero_position=CO','hero_position=HJ'", "'hero_position=HJ','hero_position=CO'", 1),
    'v2 block dropped': lambda s: s.replace("||public.fn_gto_v31_public215_v2_appended(p_template)", "||array_fill(0::double precision,ARRAY[31])", 1),
    'range key ignored': lambda s: s.replace("'iprange='||", "'iprange_='||", 1),
    'v2 width left at 215': lambda s: s.replace('cardinality(p_x)<>246', 'cardinality(p_x)<>215', 1),
}


def main():
    pure = pure_section(MIGRATION.read_text())
    pg = Cluster()
    try:
        n, m = prove(pg, pure)
        print(f'v2 SQL chain: {n} TS/SQL parity vectors equal bit for bit; {m} R7 v1 audited vectors unchanged; width checks pass')
        if '--mutations' in sys.argv:
            for name, mutate in MUTATIONS.items():
                mutated = mutate(pure)
                assert mutated != pure, f'mutation {name} did not apply'
                try:
                    prove(pg, mutated)
                except AssertionError:
                    print(f'mutation detected: {name}')
                    continue
                raise SystemExit(f'mutation NOT detected: {name}')
    finally:
        pg.stop()


if __name__ == '__main__':
    main()
