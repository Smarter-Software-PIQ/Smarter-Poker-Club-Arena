#!/usr/bin/env python3
"""Native proof for the V31 strict re-check migration.

Runs the exact migration file against a throwaway PostgreSQL 17 cluster (never
production), on top of the contract v3 proof's byte-exact live fixtures, the
contract v3 migration and the serving-bindings migration. The four functions
it patches must arrive byte-identical to production (md5 preimages read
2026-11-06); fn_gto_v31_evaluation_cells is installed from its live copy in
scripts/ci/fixtures/v31-strict-recheck. Then:

  * a v3 candidate cannot be promoted without the execution anchor of its
    evaluated epoch, nor onto a serving engine that has not passed a round;
    v2 datasets promote and bind exactly as before (no anchor, no digests)
  * the anchor records once (idempotent), refuses a different second anchor,
    non-gzip or oversized corpora, bad digests and state, and is immutable
  * a round opens only on identical execution and replay digests, never for
    the certifying engine, and is reused while open
  * results must be the certification tables, named for the re-checked
    engine, produced by it, measured against the certification incumbent and
    never reused; all wins/ties pass the round, which then admits promotion
    and binding of that engine; bindings record the round and both digests
  * STRICT: one loss closes the round 'retired', retires an active dataset
    (rejects a candidate), revokes every open binding, and no round can open
    again; a closed round and its results are immutable; abandoning closes
    an open round without a verdict
  * the evaluator can read an active dataset's cells; grants are exact

`--mutations` re-runs the scenario against deliberately weakened copies of
the migration and requires every one of them to be detected.
"""
import base64
import gzip
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('v3proof', ROOT / 'scripts/ci/test-v31-evaluation-contract-v3.py')
v3 = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(v3)

FIXTURES = ROOT / 'scripts/ci/fixtures/v31-strict-recheck'
LIVE_MD5 = {
    'fn_gto_v31_bind_serving(uuid,text,text,text,text,text)': 'a98d39889754ed58c511feab8ec3e8d4',
    'fn_gto_v31_serving_binding_guard()': 'f34cd74f73ddcd8920af1232727499f4',
    'fn_gto_v31_evaluation_cells(uuid,integer,integer)': 'e18f71f77659e807226fe8a00fdcab03',
    'fn_gto_v31_promote_dataset_epoch(uuid,text,text)': '6f8a2eda90c5d9698a99a41e0abf40d4',
}
PATCHED = list(LIVE_MD5)
C1, S1, S2, S3 = v3.C1, v3.SERVING, 'e5' * 20, 'f6' * 20
CLOSURE = '9' * 64
EXEC, REPLAY, CORPUS = 'a' * 64, 'b' * 64, 'c' * 64
REASON = 'Strict re-check native proof: an audited reason for this step'
q = v3.q


def migration_path():
    found = sorted((ROOT / 'supabase/migrations').glob('*_v31_strict_recheck_binds_a_new_engine_only_after_it_replays_.sql'))
    if len(found) != 1:
        raise SystemExit(f'expected exactly one strict re-check migration, found {found}')
    return found[0]


def one(pattern):
    found = sorted((ROOT / 'supabase/migrations').glob(pattern))
    assert len(found) == 1, (pattern, found)
    return found[0]


def install(db):
    """Production as of the re-check migration, with one pre-v3 (v2) dataset."""
    v3.install_fixtures(db)
    legacy = v3.dataset(db, 'r7', [dict(c, street=s) for c in v3.CASH_CELLS[:1] for s in ('flop', 'turn', 'river')],
                        list(v3.V2_FAMILIES))
    db.file(one('*_v31_evaluation_contract_v3_tests_the_playbooks_own_tables.sql'))
    db.file(one('*_v31_serving_bindings_admit_only_verified_engines.sql'))
    for path in sorted(FIXTURES.glob('*.sql')):
        db.file(path)
    for sig, md5 in LIVE_MD5.items():
        got = db.sql(f"SELECT md5(pg_get_functiondef('public.{sig}'::regprocedure))")
        assert got == md5, f'preimage of {sig} is not byte-identical to production ({got})'
    return legacy


def corpus(seed='x', size=None):
    raw = json.dumps({'protocol': 'smarter-poker.v31-replay-digest.v1', 'seed': seed}).encode()
    if size:
        raw = raw + b' ' * size
    return base64.b64encode(gzip.compress(raw, mtime=0)).decode()


def svc(db, text, refused=None):
    return db.sql(f"SET request.jwt.claim.role='service_role'; {text}", refused)


def anchor(db, epoch, refused=None, execution=EXEC, replay=REPLAY, states=600, body=None, checksum=CORPUS):
    return svc(db, f"SELECT public.fn_gto_v31_record_execution_anchor('{epoch}',{q(execution)},{q(checksum)},"
                   f"{q(replay)},{states},{q(body if body is not None else corpus())},'github-actions:test')", refused)


def open_round(db, ds, serving, refused=None, execution=EXEC, replay=REPLAY):
    out = svc(db, f"SELECT public.fn_gto_v31_open_recheck_round('{ds}',{q(serving)},{q(execution)},{q(replay)},"
                  f"'github-actions:test',{q(REASON)})", refused)
    return out if refused else json.loads(out.splitlines()[-1])


def record(db, round_id, kind, family, rid, refused=None):
    out = svc(db, f"SELECT public.fn_gto_v31_record_recheck_result('{round_id}','{kind}','{family}',{rid})", refused)
    return out if refused else json.loads(out.splitlines()[-1])


def recheck_result(db, ds, csum, kind, tables, cells, serving, bb100=0.0, matchup=None, day_offset=0):
    name = matchup or f'gto_v31_{kind}_cash_{csum}_recheck_{serving}'
    return v3.v3_result(db, ds, csum, kind, 'cash', tables, cells, commit=serving, bb100=bb100,
                        mutate=(lambda cs, x: x.__setitem__('matchup', name)), day_offset=day_offset)


def bind(db, ds, serving, refused=None):
    return svc(db, f"SELECT public.fn_gto_v31_bind_serving('{ds}',{q(C1)},{q(serving)},{q(CLOSURE)},"
                   f"'github-actions:test',{q(REASON)})", refused)


def admitted(db, serving):
    return json.loads(svc(db, f"SELECT public.fn_gto_v31_serving_admission({q(serving)})").splitlines()[-1])['admitted']


def epoch_of(db, ds):
    return db.sql(f"SELECT epoch_id FROM gto_v31_evaluation_epochs WHERE dataset_id='{ds}' AND superseded_at IS NULL")


def certified_candidate(db, key):
    """A v3 cash dataset with both certification receipts, marked candidate."""
    ds, csum = v3.dataset(db, key, v3.CASH_CELLS, ['cash'])
    v3.open_epoch(db, ds)
    tables = v3.v3_tables_py(v3.CASH_CELLS, 'cash')
    cells = v3.cells_of(db, ds, 'cash')
    for kind in v3.KINDS:
        v3.record(db, ds, kind, 'cash', v3.v3_result(db, ds, csum, kind, 'cash', tables, cells, day_offset=1))
    db.sql(f"SELECT public.fn_gto_v31_mark_candidate('{ds}')")
    assert v3.state(db, ds) == 'candidate'
    return ds, csum, tables, cells


def scenario(cluster, text, behavioural=False):
    db = cluster.fresh()
    legacy, legacy_sum = install(db)
    acl_before = v3.acls(db, PATCHED)
    v3.apply_migration(db, text)
    proof = re.search(r'^-- @live-proof: (.+)$', text, re.M).group(1)
    if behavioural:
        # A mutation run proves BEHAVIOUR breaks, not merely that the md5 pins notice.
        proof = re.sub(r" AND md5\(pg_get_functiondef\('[^']+'::regprocedure\)\)='[0-9a-f]{32}'", '', proof)
    assert db.sql(f'SELECT {proof}') == 't', 'live proof must hold after install'
    assert v3.acls(db, PATCHED) == acl_before, 'patched functions must keep byte-identical grants'
    rpcs = ['fn_gto_v31_record_execution_anchor(uuid,text,text,text,integer,text,text)',
            'fn_gto_v31_open_recheck_round(uuid,text,text,text,text,text)',
            'fn_gto_v31_record_recheck_result(uuid,text,text,bigint)',
            'fn_gto_v31_abandon_recheck_round(uuid,text,text)', 'fn_gto_v31_recheck_status(uuid)',
            'fn_gto_v31_replay_corpus(uuid)']
    for fn in rpcs:
        assert db.sql(f"SELECT has_function_privilege('service_role','public.{fn}','EXECUTE')") == 't', fn
        for role in ['anon', 'authenticated']:
            assert db.sql(f"SELECT has_function_privilege('{role}','public.{fn}','EXECUTE')") == 'f', (fn, role)
    for fn in ['fn_gto_v31_execution_anchor_guard()', 'fn_gto_v31_recheck_round_guard()',
               'fn_gto_v31_recheck_epoch(gto_v31_datasets)']:
        for role in ['anon', 'authenticated', 'service_role']:
            assert db.sql(f"SELECT has_function_privilege('{role}','public.{fn}','EXECUTE')") == 'f', (fn, role)
    for table in ['gto_v31_execution_anchors', 'gto_v31_recheck_rounds']:
        for role in ['anon', 'authenticated']:
            assert db.sql(f"SELECT has_table_privilege('{role}','public.{table}','SELECT')") == 'f', (table, role)

    # ── v2 datasets: promotion and binding exactly as before ──
    assert db.sql(f"SELECT evaluation_contract FROM gto_v31_datasets WHERE dataset_id='{legacy}'") == 'gto_v31_candidate.v2'
    v3.open_epoch(db, legacy)
    for kind in v3.KINDS:
        for family in v3.V2_FAMILIES:
            v3.record(db, legacy, kind, family, v3.v2_result(db, legacy_sum, kind, family))
    db.sql(f"SELECT public.fn_gto_v31_mark_candidate('{legacy}')")
    assert db.sql(f"SELECT public.fn_gto_v31_promote_dataset_epoch('{legacy}',{q(C1)},{q(S1)})") == legacy_sum
    assert json.loads(bind(db, legacy, S1).splitlines()[-1])['bound'] is True
    assert db.sql(f"SELECT coalesce(recheck_round_id::text,'-')||coalesce(execution_digest,'-')||coalesce(replay_digest,'-') "
                  f"FROM gto_v31_serving_bindings WHERE dataset_id='{legacy}'") == '---'
    anchor(db, epoch_of(db, legacy), refused='an execution anchor is recorded for the open, unpromoted evaluation epoch')
    open_round(db, legacy, S2, refused='only a candidate or active contract v3 dataset is re-checked')
    db.sql(f"UPDATE gto_v31_datasets SET state='retired', retired_at=now() WHERE dataset_id='{legacy}'")

    # ── v3 candidate: the anchor ──
    ds, csum, tables, cells = certified_candidate(db, 'r8')
    epoch = epoch_of(db, ds)
    db.sql(f"SELECT public.fn_gto_v31_promote_dataset_epoch('{ds}',{q(C1)},{q(C1)})",
           refused='needs the execution anchor of its evaluated epoch')
    anchor(db, epoch, states=299, refused='300 to 6000 replay states')
    anchor(db, epoch, execution='0' * 64, refused='names both digests')
    anchor(db, epoch, replay='B' * 64, refused='names both digests')
    anchor(db, epoch, body=base64.b64encode(b'not gzip at all').decode(), refused='must be gzip')
    anchor(db, epoch, body='@@not base64@@', refused='not base64')
    db.sql(f"SET ROLE authenticated; SELECT public.fn_gto_v31_record_execution_anchor('{epoch}',{q(EXEC)},{q(CORPUS)},"
           f"{q(REPLAY)},600,{q(corpus())},'x')", refused='permission denied')
    first = json.loads(anchor(db, epoch).splitlines()[-1])
    assert first == {'epoch_id': epoch, 'recorded': True}, first
    assert json.loads(anchor(db, epoch).splitlines()[-1])['recorded'] is False, 'identical anchor is idempotent'
    anchor(db, epoch, replay='d' * 64, refused='already records another execution anchor')
    anchor(db, epoch, body=corpus('other'), refused='already records another execution anchor')
    db.sql(f"UPDATE gto_v31_execution_anchors SET replay_digest=repeat('e',64) WHERE epoch_id='{epoch}'",
           refused='permanent provenance')
    db.sql(f"DELETE FROM gto_v31_execution_anchors WHERE epoch_id='{epoch}'", refused='permanent provenance')
    stored = json.loads(svc(db, f"SELECT public.fn_gto_v31_replay_corpus('{epoch}')").splitlines()[-1])
    assert stored['corpus_gzip_base64'].replace('\n', '') == corpus(), 'the stored corpus is the recorded bytes'
    assert stored['corpus_sha256'] == hashlib.sha256(base64.b64decode(corpus())).hexdigest()

    # ── promotion onto a different serving engine needs a passed round ──
    db.sql(f"SELECT public.fn_gto_v31_promote_dataset_epoch('{ds}',{q(C1)},{q(S1)})",
           refused='has not passed a re-check of this candidate')

    # ── opening a round ──
    open_round(db, ds, S1, execution='d' * 64, refused='execution fingerprint differs')
    open_round(db, ds, S1, replay='d' * 64, refused='replay digest differs')
    open_round(db, ds, C1, refused='certifying engine itself needs no re-check')
    rnd = open_round(db, ds, S1)
    assert rnd['opened'] is True and rnd['outcome'] is None, rnd
    again = open_round(db, ds, S1)
    assert again['round_id'] == rnd['round_id'] and again['opened'] is False, 'an open round is reused'
    rid = rnd['round_id']

    # ── recording results ──
    wrong_engine = recheck_result(db, ds, csum, 'league', tables, cells, S1, matchup=None)
    db.sql(f"UPDATE horse_league_results SET config_a=jsonb_set(config_a,'{{evaluation_engine_commit}}',to_jsonb({q(S2)}::text)) WHERE id={wrong_engine}")
    record(db, rid, 'league', 'cash', wrong_engine, refused='different engine commit than the round re-checks')
    db.sql(f'DELETE FROM horse_league_results WHERE id={wrong_engine}')
    misnamed = recheck_result(db, ds, csum, 'league', tables, cells, S1, matchup=f'gto_v31_league_cash_{csum}')
    record(db, rid, 'league', 'cash', misnamed, refused='named for its certification table and the re-checked engine')
    db.sql(f'DELETE FROM horse_league_results WHERE id={misnamed}')
    cert_rid = db.sql(f"SELECT source_result_id FROM gto_v31_release_evaluations WHERE dataset_id='{ds}' AND evaluation_kind='league'")
    record(db, rid, 'league', 'cash', cert_rid, refused='named for its certification table')
    bad_tables = v3.v3_result(db, ds, csum, 'league', 'cash', tables, cells, commit=S1,
                              mutate=lambda cs, x: (cs.pop(), x.__setitem__('matchup', f'gto_v31_league_cash_{csum}_recheck_{S1}')))
    record(db, rid, 'league', 'cash', bad_tables, refused='not the contract v3 tables')
    db.sql(f'DELETE FROM horse_league_results WHERE id={bad_tables}')
    record(db, rid, 'league', 'spin', bad_tables, refused='no cells in family spin')
    league = recheck_result(db, ds, csum, 'league', tables, cells, S1)
    out = record(db, rid, 'league', 'cash', league)
    assert out['verdict'] == 'tie' and out['outcome'] is None and out['remaining'] == 1, out
    record(db, rid, 'league', 'cash', league, refused='already records league / cash')
    db.sql(f"UPDATE gto_v31_recheck_rounds SET results='[]' WHERE round_id='{rid}'", refused='only appends results')
    db.sql(f"UPDATE gto_v31_recheck_rounds SET serving_commit={q(S2)} WHERE round_id='{rid}'", refused='only appends results')
    db.sql(f"SELECT public.fn_gto_v31_promote_dataset_epoch('{ds}',{q(C1)},{q(S1)})",
           refused='has not passed a re-check of this candidate')
    paired = recheck_result(db, ds, csum, 'paired_replay', tables, cells, S1, bb100=3.0)
    out = record(db, rid, 'paired_replay', 'cash', paired)
    assert out['verdict'] == 'win' and out['outcome'] == 'passed', out
    db.sql(f"UPDATE gto_v31_recheck_rounds SET close_reason={q(REASON + ' edited')} WHERE round_id='{rid}'",
           refused='only appends results')
    assert open_round(db, ds, S1)['outcome'] == 'passed', 'a passed engine is not re-checked again'

    # ── a passed round admits promotion and binding of exactly that engine ──
    assert db.sql(f"SELECT public.fn_gto_v31_promote_dataset_epoch('{ds}',{q(C1)},{q(S1)})") == csum
    assert v3.state(db, ds) == 'active'
    assert json.loads(bind(db, ds, S1).splitlines()[-1])['bound'] is True
    row = db.sql(f"SELECT recheck_round_id||'|'||execution_digest||'|'||replay_digest FROM gto_v31_serving_bindings "
                 f"WHERE dataset_id='{ds}' AND serving_commit={q(S1)}")
    assert row == f'{rid}|{EXEC}|{REPLAY}', row
    assert json.loads(bind(db, ds, C1).splitlines()[-1])['bound'] is True, 'the certifying engine needs no round'
    assert db.sql(f"SELECT coalesce(recheck_round_id::text,'-')||'|'||execution_digest FROM gto_v31_serving_bindings "
                  f"WHERE dataset_id='{ds}' AND serving_commit={q(C1)}") == f'-|{EXEC}'
    bind(db, ds, S2, refused='has not passed a re-check of this playbook')
    db.sql(f"UPDATE gto_v31_serving_bindings SET replay_digest=repeat('f',64) WHERE dataset_id='{ds}' AND serving_commit={q(S1)}",
           refused='permanent provenance')
    assert admitted(db, S1) is True and admitted(db, S2) is False
    n = db.sql(f"SELECT count(*) FROM public.fn_gto_v31_evaluation_cells('{ds}',0,500)")
    assert n == str(len(v3.CASH_CELLS)), f'the re-check evaluator reads an active dataset: {n}'

    # ── abandon: closes an open round without a verdict ──
    r2 = open_round(db, ds, S2)['round_id']
    tie2 = recheck_result(db, ds, csum, 'league', tables, cells, S2)
    assert record(db, r2, 'league', 'cash', tie2)['verdict'] == 'tie'
    assert svc(db, f"SELECT public.fn_gto_v31_abandon_recheck_round('{r2}','github-actions:test',{q(REASON)})").splitlines()[-1] == 't'
    assert svc(db, f"SELECT public.fn_gto_v31_abandon_recheck_round('{r2}','github-actions:test',{q(REASON)})").splitlines()[-1] == 'f'
    status = json.loads(svc(db, f"SELECT public.fn_gto_v31_recheck_status('{ds}')").splitlines()[-1])
    assert [r['outcome'] for r in status['rounds']] == ['passed', 'abandoned'], status['rounds']
    assert status['anchors'][0]['replay_digest'] == REPLAY and 'corpus_gzip_base64' not in status['anchors'][0]

    # ── STRICT: one loss retires the playbook for good ──
    r3 = open_round(db, ds, S2)
    assert r3['opened'] is True and r3['round_id'] != r2
    record(db, r3['round_id'], 'league', 'cash', tie2, refused='evidence for one verdict only')
    lost = recheck_result(db, ds, csum, 'league', tables, cells, S2, bb100=-5.0, day_offset=1)
    out = record(db, r3['round_id'], 'league', 'cash', lost)
    assert out == {'round_id': r3['round_id'], 'verdict': 'loss', 'outcome': 'retired', 'recorded': True}, out
    assert v3.state(db, ds) == 'retired'
    assert db.sql(f"SELECT count(*) FROM gto_v31_serving_bindings WHERE dataset_id='{ds}' AND revoked_at IS NULL") == '0', \
        'a strict loss revokes every open binding'
    assert admitted(db, S1) is False and admitted(db, C1) is False
    open_round(db, ds, S3, refused='only a candidate or active contract v3 dataset is re-checked')
    late = recheck_result(db, ds, csum, 'paired_replay', tables, cells, S2, bb100=3.0)
    assert record(db, r3['round_id'], 'paired_replay', 'cash', late)['recorded'] is False, 'a closed round takes nothing'

    # ── STRICT on a candidate: a loss rejects it, and it never re-opens ──
    cand, ccsum, ctables, ccells = certified_candidate(db, 'r9')
    anchor(db, epoch_of(db, cand))
    rc = open_round(db, cand, S3)['round_id']
    out = record(db, rc, 'paired_replay', 'cash', recheck_result(db, cand, ccsum, 'paired_replay', ctables, ccells, S3, bb100=-4.0))
    assert out['outcome'] == 'retired' and v3.state(db, cand) == 'rejected', out
    db.sql(f"UPDATE gto_v31_datasets SET state='candidate' WHERE dataset_id='{cand}'")
    open_round(db, cand, S2, refused='lost a re-check and is retired for good')
    return 'ok'


MUTATIONS = {
    'loss does not retire': ("  IF v_verdict = 'loss' THEN\n", "  IF false THEN\n"),
    'no execution digest check': ("  IF p_execution_digest IS DISTINCT FROM v_anchor.execution_digest THEN",
                                  "  IF false THEN"),
    'no replay digest check': ("  IF p_replay_digest IS DISTINCT FROM v_anchor.replay_digest THEN", "  IF false THEN"),
    'retired can reopen': ("  IF EXISTS (SELECT 1 FROM public.gto_v31_recheck_rounds WHERE dataset_id=p_dataset_id AND outcome='retired') THEN",
                           "  IF false THEN"),
    'promotion skips the anchor': ("    IF NOT EXISTS (SELECT 1 FROM public.gto_v31_execution_anchors a WHERE a.epoch_id=v_epoch.epoch_id) THEN",
                                   "    IF false THEN"),
    'binding skips the round': ("      IF NOT FOUND THEN RAISE EXCEPTION 'the serving engine has not passed a re-check of this playbook'; END IF;",
                                "      NULL;"),
    'results rewritable': ("     OR jsonb_array_length(NEW.results) < jsonb_array_length(OLD.results)\n     OR (SELECT",
                           "     OR false AND (SELECT"),
    'no engine check on results': ("  IF v_result.config_a->>'evaluation_engine_commit' IS DISTINCT FROM v_round.serving_commit THEN",
                                   "  IF false THEN"),
    'no result reuse check': ("  IF EXISTS (SELECT 1 FROM public.gto_v31_recheck_rounds r, jsonb_array_elements(r.results) x(v)\n              WHERE (x.v->>'source_result_id')::bigint = p_source_result_id)\n     OR EXISTS",
                              "  IF EXISTS"),
    'loss leaves bindings open': ("    UPDATE public.gto_v31_serving_bindings\n       SET revoked_at=now(), revoked_by=v_round.opened_by, revoke_reason=v_reason\n     WHERE dataset_id=v_dataset.dataset_id AND revoked_at IS NULL;\n", ''),
    'anchor mutable': ("  RAISE EXCEPTION 'an execution anchor is permanent provenance';\nEND;", "  RETURN NEW;\nEND;"),
    'cells exclude active': ("$b$d.state IN ('evaluating','candidate','active')$b$", "$b$d.state IN ('evaluating','candidate')$b$"),
    'binding digests mutable': ("      NEW.bound_at, NEW.bound_by, NEW.reason, NEW.recheck_round_id, NEW.execution_digest, NEW.replay_digest)",
                                "      NEW.bound_at, NEW.bound_by, NEW.reason, OLD.recheck_round_id, OLD.execution_digest, OLD.replay_digest)"),
    'promotion skips the round': ("    IF p_serving_commit IS DISTINCT FROM v_epoch.engine_commit AND NOT EXISTS (",
                                  "    IF false AND NOT EXISTS ("),
}


POSTIMAGE_CHECK = '  IF md5(pg_get_functiondef(p_fn)) IS DISTINCT FROM p_post THEN'


def main():
    path = migration_path()
    text = path.read_text()
    cluster = v3.Cluster()
    try:
        print('scenario:', scenario(cluster, text))
        if '--mutations' in sys.argv:
            assert text.count(POSTIMAGE_CHECK) == 1
            for name, (old, new) in MUTATIONS.items():
                assert text.count(old) == 1, f'mutation anchor for "{name}" must occur exactly once'
                weakened = text.replace(old, new).replace(POSTIMAGE_CHECK, '  IF false THEN')
                try:
                    scenario(cluster, weakened, behavioural=True)
                except (AssertionError, v3.Refused) as error:
                    detail = (str(error) or repr(error)).splitlines()[0][:120]
                    if 'postimage' in detail:
                        raise SystemExit(f'mutation "{name}" was caught only by an md5 pin, not by behaviour')
                    print(f'mutation detected: {name} ({detail})')
                    continue
                raise SystemExit(f'mutation NOT detected: {name}')
    finally:
        cluster.stop()
    print('v31 strict re-check: native proof passed')


if __name__ == '__main__':
    main()
