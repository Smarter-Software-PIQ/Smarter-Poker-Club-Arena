"""Exact concurrent prerequisite and atomic owner transition; private PG only."""
from pathlib import Path
import subprocess
import sys

pgbin, socket, migration = sys.argv[1:]
cmd = [str(Path(pgbin) / 'psql'), '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-p', '56436', '-U', 'postgres', '-d', 'posthand_temporal']
source = Path(migration).read_text()
cut = source.index('BEGIN;')
preamble, body = source[:cut], source[cut:]

def execute(sql, expected=None):
    r = subprocess.run(cmd, input=sql, text=True, capture_output=True, timeout=20)
    if expected:
        if r.returncode == 0 or expected not in r.stderr:
            raise SystemExit('wrong installer refusal: ' + r.stderr)
    elif r.returncode:
        raise SystemExit(r.stderr)
    return r.stdout

execute("""DROP FUNCTION smarter_private.original_cash_hand_predecessor(uuid,bigint,timestamptz,uuid);
REVOKE ALL ON FUNCTION public.fn_ca_process_hand_post_commit_obligations(uuid)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_process_hand_post_commit_obligations(uuid)TO service_role;
CREATE FUNCTION smarter_private.original_inventory_basis_generation()RETURNS text LANGUAGE sql STABLE AS $$SELECT 'native-unchanged-generation'::text$$;
""")
# The actual maintained preamble runs outside the atomic body.
execute(preamble)
rollback = body.replace('COMMIT;', 'ROLLBACK;')
for prefix, reason in [
    ('ALTER INDEX public.cash_hand_provenance_table_time_cover RENAME TO native_cover_missing;', 'POSTHAND_TEMPORAL_EXACT_VALID_COVER_REQUIRED'),
    ('REVOKE EXECUTE ON FUNCTION public.fn_union_pnl_prove_posthand_escrow(uuid,bigint)FROM service_role;', 'POSTHAND_TEMPORAL_PREIMAGE_OR_METADATA_CHANGED'),
    ("CREATE FUNCTION smarter_private.native_stale_pin()RETURNS text LANGUAGE sql AS $$SELECT 'ebe63c0e31d896db9c716d905b267f6a'::text$$;", 'POSTHAND_TEMPORAL_DEPENDENT_PIN_CHANGED'),
    ('CREATE OR REPLACE FUNCTION smarter_private.original_inventory_proof_sources_match()RETURNS boolean LANGUAGE sql AS $$SELECT false$$;', 'POSTHAND_TEMPORAL_OPERATOR_OR_SOURCE_REFUSED'),
]:
    execute(rollback.replace('BEGIN;', 'BEGIN;\n' + prefix, 1), reason)
    print('PASS exact installer refusal ' + reason)

fingerprint = """SELECT jsonb_build_object(
 'prover',md5(pg_get_functiondef('public.fn_union_pnl_prove_posthand_escrow(uuid,bigint)'::regprocedure)),
 'completion',md5(pg_get_functiondef('public.fn_ca_process_hand_post_commit_obligations(uuid)'::regprocedure)),
 'lookup',to_regprocedure('smarter_private.original_cash_hand_predecessor(uuid,bigint,timestamptz,uuid)')::text,
 'outcomes',(SELECT md5(jsonb_agg(to_jsonb(o)ORDER BY table_id,hand_number)::text)FROM public.union_pnl_cash_outcomes o),
 'ledger',(SELECT md5(jsonb_agg(to_jsonb(l)ORDER BY id)::text)FROM public.chip_ledger l),
 'certificates',(SELECT md5(jsonb_agg(to_jsonb(c)ORDER BY table_id,hand_number)::text)FROM smarter_private.posthand_escrow_certificates c));"""
before = execute(fingerprint)
execute(rollback)
if execute(fingerprint) != before:
    raise SystemExit('rollback changed original source/data')
execute(body)
execute(body, 'POSTHAND_TEMPORAL_ALREADY_INSTALLED')
execute("""DO $proof$BEGIN
 IF (SELECT md5(jsonb_agg(to_jsonb(o)ORDER BY table_id,hand_number)::text)FROM public.union_pnl_cash_outcomes o)IS NULL THEN RAISE EXCEPTION 'original outcomes missing';END IF;
 IF smarter_private.original_inventory_basis_generation()<>'native-unchanged-generation'THEN RAISE EXCEPTION 'generation changed';END IF;
END$proof$;
""")
# Replacing the owners must not alter any original financial row/certificate.
import json
old, new = json.loads(before.strip().splitlines()[-2]), json.loads(execute(fingerprint).strip().splitlines()[-2])
for key in ['outcomes', 'ledger', 'certificates']:
    if old[key] != new[key]:
        raise SystemExit('installation changed original ' + key)
print('PASS exact concurrent cover, guarded atomic owner install, rollback, metadata/ACL, unchanged generation/originals and refused replay')

# This finite certificate installer uses ordinary aliases beside procedural
# variables. Execute its exact declaration and financial-witness SELECT on
# the maintained synthetic originals: an unassigned record must never shadow
# a SQL relation alias before the certificate loop even starts.
import re
admission = (Path(migration).parents[2] / 'supabase/migrations/20261110012843_certify_eight_original_posthand_escrow_proofs.sql').read_text()
declaration = admission[admission.index('DECLARE ', admission.index('DO $original_eight_admission$')):]
declaration = declaration[:declaration.index('\nBEGIN')]
witness = admission[admission.index(' SELECT jsonb_agg', admission.index('DO $original_eight_admission$')):]
witness = witness[:witness.index(';') + 1]
iteration = re.search(r'FOR (\w+) IN SELECT \*FROM original_eight_admission_expected', admission)[1]
setup = """BEGIN;
CREATE TEMP TABLE original_eight_admission_expected AS
 SELECT p.table_id,p.hand_number FROM public.cash_hand_provenance_receipts p
 JOIN public.union_pnl_cash_outcomes o USING(table_id,hand_number)
 JOIN public.cash_hand_participant_manifests m ON m.id=p.manifest_id
 JOIN public.hand_atomic_commits a ON a.hand_id=p.hand_id LIMIT 1;
"""
def witness_block(declare):
    return setup + 'DO $witness$\n' + declare + '\nBEGIN\n' + witness + "\nIF before_rows IS NULL THEN RAISE EXCEPTION 'native witness selected no original';END IF;\nEND$witness$;ROLLBACK;"
execute(witness_block(re.sub(r'\b' + re.escape(iteration) + r'\b', 'k', declaration)), 'record "k" is not assigned yet')
execute(witness_block(declaration))
print('PASS exact certificate-installer declaration/witness: prior unassigned-record alias fails; maintained source selects original financial witness')
