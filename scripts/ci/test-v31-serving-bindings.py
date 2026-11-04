#!/usr/bin/env python3
"""Native proof for 20261102180625_v31_serving_bindings_admit_only_verified_engines.

Builds on the evaluation-epoch proof (same byte-exact live preimages, then the
merged 20261102151428 migration), applies this migration to a throwaway
PostgreSQL 17 cluster and drives the real functions:

  * a promoted dataset admits no engine until one is bound
  * only the promoted epoch's engine commit can be bound, only while active
  * admission is per serving commit; a revoked binding admits nothing
  * re-binding is a new provenance row; bindings are immutable but for one revocation
  * a retired dataset's bindings admit nothing
  * grants: service role only

`--mutations` re-runs the scenario against weakened copies and requires each
to be detected.
"""
import importlib.util
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('v31_epochs_proof', HERE / 'test-v31-evaluation-epochs.py')
E = importlib.util.module_from_spec(spec)
spec.loader.exec_module(E)

MIGRATION = E.ROOT / 'supabase/migrations/20261102180625_v31_serving_bindings_admit_only_verified_engines.sql'
C1, SERVING, OTHER, DIGEST = E.C1, E.SERVING, 'e5' * 20, 'f' * 63 + '1'
BY = 'github-actions:test:run-1-1:dan'
WHY = 'Closure-identical serving engine verified for the promoted epoch'


def admitted(db, commit):
    return json.loads(db.sql(f"SELECT public.fn_gto_v31_serving_admission({E.q(commit)})"))


def bind(db, ds, engine, serving, digest=DIGEST, reason=WHY, refused=None):
    out = db.sql(f"SELECT public.fn_gto_v31_bind_serving('{ds}',{E.q(engine)},{E.q(serving)},{E.q(digest)},{E.q(BY)},{E.q(reason)})", refused)
    return None if refused else json.loads(out)


def revoke(db, ds, serving):
    return db.sql(f"SELECT public.fn_gto_v31_revoke_serving('{ds}',{E.q(serving)},{E.q(BY)},'Activation did not complete on all eight workers')")


def promoted_dataset(db, key, incumbent='legacy_v30'):
    ds, checksum = E.dataset(db, key, key)
    E.open_epoch(db, ds, C1)
    for kind in E.KINDS:
        for family in E.FAMILIES:
            E.record(db, ds, kind, family, E.result(db, checksum, kind, family, C1, 1, 0.0, incumbent=incumbent))
    db.sql(f"SELECT public.fn_gto_v31_mark_candidate('{ds}')")
    return ds, checksum


def scenario(cluster, epoch_text, text):
    db = cluster.fresh()
    E.install(db, epoch_text)
    path = Path(cluster.scratch) / f'{db.name}-bindings.sql'
    path.write_text(text)
    db.file(path)
    proof = re.search(r'^-- @live-proof: (.+)$', text, re.M).group(1)
    assert db.sql(f'SELECT {proof}') == 't', 'live proof must hold after install'
    for fn in ['fn_gto_v31_serving_admission(text)', 'fn_gto_v31_bind_serving(uuid,text,text,text,text,text)',
               'fn_gto_v31_revoke_serving(uuid,text,text,text)']:
        assert db.sql(f"SELECT has_function_privilege('service_role','public.{fn}','EXECUTE')") == 't', fn
        for role in ['anon', 'authenticated']:
            assert db.sql(f"SELECT has_function_privilege('{role}','public.{fn}','EXECUTE')") == 'f', (fn, role)

    assert admitted(db, SERVING) == {'active': None, 'admitted': False}
    ds, checksum = promoted_dataset(db, 'r7')
    bind(db, ds, C1, SERVING, refused='only the active dataset is bound')
    assert db.sql(f"SELECT public.fn_gto_v31_promote_dataset_epoch('{ds}',{E.q(C1)},{E.q(SERVING)})") == checksum

    # Promoted is not served: no engine is admitted until one is bound.
    a = admitted(db, SERVING)
    assert a['active']['dataset_id'] == ds and a['admitted'] is False, a
    bind(db, ds, E.C2, SERVING, refused='other than the promoted epoch')
    bind(db, ds, C1, SERVING, reason='short', refused='audited reason')
    bind(db, ds, C1, SERVING, digest='0' * 64, refused='proven closure digest')
    first = bind(db, ds, C1, SERVING)
    assert first['bound'] is True, first
    assert admitted(db, SERVING)['admitted'] is True
    assert admitted(db, OTHER)['admitted'] is False, 'admission is per serving commit'
    assert admitted(db, 'not-a-commit')['admitted'] is False
    assert bind(db, ds, C1, SERVING)['bound'] is False, 'the same open binding is idempotent'
    bind(db, ds, C1, SERVING, digest='a' * 64, refused='another closure identity')

    # Revocation closes admission; a re-bind is a new provenance row.
    assert revoke(db, ds, SERVING) == 't'
    assert admitted(db, SERVING)['admitted'] is False
    assert revoke(db, ds, SERVING) == 'f'
    assert bind(db, ds, C1, SERVING)['bound'] is True
    assert admitted(db, SERVING)['admitted'] is True
    assert db.sql(f"SELECT count(*)||'/'||count(revoked_at) FROM gto_v31_serving_bindings WHERE serving_commit={E.q(SERVING)}") == '2/1'
    bind(db, ds, C1, OTHER)
    assert admitted(db, OTHER)['admitted'] is True

    # Immutable but for one revocation; never deleted while the dataset exists.
    db.sql(f"UPDATE gto_v31_serving_bindings SET closure_digest=repeat('a',64) WHERE serving_commit={E.q(OTHER)}", refused='permanent provenance')
    db.sql(f"UPDATE gto_v31_serving_bindings SET serving_commit={E.q(E.C3)} WHERE serving_commit={E.q(OTHER)}", refused='permanent provenance')
    db.sql(f"UPDATE gto_v31_serving_bindings SET revoked_at=NULL, revoked_by=NULL, revoke_reason=NULL WHERE revoked_at IS NOT NULL",
           refused='permanent provenance')
    db.sql("DELETE FROM gto_v31_serving_bindings", refused='permanent provenance')

    # A newly promoted dataset retires this one: its bindings admit nothing.
    ds2, checksum2 = promoted_dataset(db, 'r8', incumbent=checksum)
    out = db.sql(f"SELECT public.fn_gto_v31_promote_dataset_epoch('{ds2}',{E.q(C1)},{E.q(SERVING)})")
    assert out == checksum2, out
    a = admitted(db, SERVING)
    assert a['active']['dataset_id'] == ds2 and a['admitted'] is False, a
    bind(db, ds, C1, SERVING, refused='only the active dataset is bound')
    return 'ok'


MUTATIONS = [
    ('admission ignores revocation', "b.serving_commit=p_engine_commit AND b.revoked_at IS NULL));", "b.serving_commit=p_engine_commit));"),
    ('admission ignores the serving commit', "WHERE b.dataset_id=v_active.dataset_id AND b.serving_commit=p_engine_commit AND b.revoked_at IS NULL));",
     "WHERE b.dataset_id=v_active.dataset_id AND b.revoked_at IS NULL));"),
    ('bind ignores the promoted epoch commit', "  IF NOT FOUND OR v_epoch.engine_commit IS DISTINCT FROM p_engine_commit THEN", "  IF NOT FOUND THEN"),
    ('bind admits a non-active dataset', "   WHERE dataset_id=p_dataset_id AND state='active' FOR UPDATE;\n  IF NOT FOUND THEN RAISE EXCEPTION 'only the active",
     "   WHERE dataset_id=p_dataset_id FOR UPDATE;\n  IF NOT FOUND THEN RAISE EXCEPTION 'only the active"),
    ('a binding identity can change', "     OR (OLD.revoked_at IS NOT NULL AND (NEW.revoked_at", "     AND (OLD.revoked_at IS NOT NULL AND (NEW.revoked_at"),
    ('revoke does nothing', "   WHERE dataset_id=p_dataset_id AND serving_commit=p_serving_commit AND revoked_at IS NULL\n  RETURNING",
     "   WHERE false\n  RETURNING"),
    ('open binding digest conflict ignored', "    IF v_binding.closure_digest IS DISTINCT FROM p_closure_digest OR", "    IF false AND"),
    ('admission reads a retired dataset', "  SELECT * INTO v_active FROM public.gto_v31_datasets WHERE state='active';",
     "  SELECT * INTO v_active FROM public.gto_v31_datasets WHERE state IN ('active','retired') ORDER BY promoted_at LIMIT 1;"),
]


def main():
    epoch_text = E.MIGRATION.read_text()
    text = MIGRATION.read_text()
    cluster = E.Cluster()
    try:
        scenario(cluster, epoch_text, text)
        print('v31 serving bindings: native proof passed')
        if '--mutations' in sys.argv:
            survived = []
            for label, old, new in MUTATIONS:
                assert text.count(old) == 1, f'mutation anchor not unique: {label}'
                try:
                    scenario(cluster, epoch_text, text.replace(old, new))
                except AssertionError as error:
                    print(f'  killed: {label} ({(str(error).splitlines() or [repr(error)])[0][:120]})')
                else:
                    survived.append(label)
                    print(f'  SURVIVED: {label}')
            assert not survived, f'mutations survived: {survived}'
            print(f'v31 serving bindings: {len(MUTATIONS)}/{len(MUTATIONS)} mutations killed')
    finally:
        cluster.stop()


if __name__ == '__main__':
    main()
