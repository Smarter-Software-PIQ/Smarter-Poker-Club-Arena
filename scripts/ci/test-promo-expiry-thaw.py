#!/usr/bin/env python3
"""Promo expiry in the actual v3 thaw; disposable PostgreSQL, no production access."""
import argparse
import importlib.util
import json
import re
import tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts/ci' / file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

ot = module('promo_thaw_original', 'test-on-time-maintenance-thaw.py')
rt = module('promo_thaw_retired', 'test-thaw-preserves-retired-clubs.py')
MIG = ROOT / 'supabase/migrations/20261116163448_promo_expiry_keeps_its_full_play_through_time_across_mainten.sql'
CHECKS = []
def check(value, message):
    CHECKS.append({'check': message, 'ok': bool(value)})
    ot.require(value, message)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        with tempfile.TemporaryDirectory(prefix='promo-thaw-') as directory:
            c = ot.base.Cluster(directory)
            try:
                c.start()
                c.psql(ot.base.FIXTURE + ot.EXTRA + rt.EXTRA + """
CREATE SCHEMA smarter_private;
CREATE TABLE smarter_private.engine_certified_recoveries(run_key text,announced_at timestamptz,
 raw_maintenance jsonb,ledger_token uuid,release_at timestamptz);
CREATE TABLE public.ca_promo_play_through_grants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 club_id uuid,expires_at timestamptz NOT NULL,closed_at timestamptz);
""")
                c.psql((ot.FIX / 'bypass.sql').read_text() + (ot.FIX / 'authority.sql').read_text())
                c.psql(ot.MIGRATION.read_text())
                c.psql((ROOT / 'supabase/migrations/20261020011548_a_heavy_thaw_releases_on_the_hour_when_nothing_is_left_to_cr.sql').read_text())
                for definition in re.findall(r'EXECUTE \$definition\$(CREATE OR REPLACE FUNCTION .*?)\$definition\$;', rt.MIG.read_text(), re.S):
                    c.psql(definition+';')
                c.psql(ot.base.function_source('20261104232431_certify_scoped_eed_recovery_before_the_original_thaw.sql', 'fn_thaw_platform'))
                for sig, pin in [
                    ('fn_snapshot_maintenance_thaw_targets(timestamptz,numeric)', 'd88e7a1fef47d20d060a7e100599e2fe'),
                    ('fn_credit_maintenance_thaw_targets(timestamptz,numeric)', '3f5859bd21f9e7b35e59ed5337e2afab'),
                    ('fn_thaw_platform(timestamptz,timestamptz,numeric,uuid,text)', '0fa9318d609b741f7c2142b05b325c7b')]:
                    check(c.val("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.%s'::regprocedure" % sig) == pin,
                          'actual installed preimage ' + sig)
                ot.reset(c, 270)
                c.psql("INSERT INTO public.ca_promo_play_through_grants(club_id,expires_at) SELECT 'c1000000-0000-4000-8000-000000000001',freeze_start+interval '60 seconds' FROM public.test_parameters")
                c.psql("INSERT INTO public.engine_maintenance_thaws(freeze_started_at,frozen_seconds,shifted,contract_version) SELECT freeze_start,300,'{}',3 FROM public.test_parameters; SELECT public.fn_snapshot_maintenance_thaw_targets(freeze_start,300) FROM public.test_parameters;")
                check(c.val("SELECT count(*) FROM public.engine_maintenance_thaw_targets WHERE step='promo_expires_at'") == '0',
                      'before source reproduces missing promo deadline target')
                c.psql(MIG.read_text(), error='PROMO_THAW_REQUIRES_QUIESCENT_CUTOVER')
                c.psql('TRUNCATE public.engine_maintenance_break, public.engine_maintenance_thaws,public.engine_maintenance_thaw_targets,public.test_parameters,public.ca_promo_play_through_grants')
                c.psql(MIG.read_text())
                c.psql(MIG.read_text(), error='PROMO_THAW_PREIMAGE_DRIFT')
                check(c.val("SELECT NOT has_function_privilege('authenticated','public.fn_credit_maintenance_thaw_targets(timestamptz,numeric)','EXECUTE')") == 't', 'private worker ACL preserved')
                ot.reset(c, 270)
                c.psql("""
INSERT INTO public.ca_promo_play_through_grants(club_id,expires_at)
 SELECT 'c1000000-0000-4000-8000-000000000001',freeze_start+interval '60 seconds'
 FROM public.test_parameters CROSS JOIN generate_series(1,405);
INSERT INTO public.ca_promo_play_through_grants(club_id,expires_at,closed_at)
 SELECT club_id,freeze_start+delta,closed FROM public.test_parameters CROSS JOIN (VALUES
 ('c1000000-0000-4000-8000-000000000001'::uuid,interval '-1 second',NULL::timestamptz),
 ('c1000000-0000-4000-8000-000000000001'::uuid,interval '60 seconds',now()),
 ('c1000000-0000-4000-8000-000000000002'::uuid,interval '60 seconds',NULL::timestamptz)
 ) excluded(club_id,delta,closed);
CREATE TABLE public.test_promo_before AS SELECT * FROM public.ca_promo_play_through_grants;
""")
                check(ot.call(c, ot.NEXT)['reason'] == 'maintenance_ownership_changed', 'wrong owner cannot shift clocks')
                r = ot.call(c)
                check(not r.get('complete'), 'initial legacy installment keeps release closed')
                check(c.val("SELECT count(*) FROM public.engine_maintenance_thaw_targets WHERE step='promo_expires_at'") == '405', 'only original open unexpired active-club grants snapshotted')
                check(c.val("SELECT count(*) FROM public.ca_promo_play_through_grants a JOIN public.test_promo_before b USING(id) WHERE a.expires_at<>b.expires_at") == '0', 'legacy step cannot pretend promo credit happened')
                r = ot.call(c)
                check(c.val("SELECT count(*) FROM public.engine_maintenance_thaw_targets WHERE step='promo_expires_at' AND credited_seconds=300") == '200', 'initial promo installment bounded to two hundred exact targets')
                check(not r.get('complete') and c.val('SELECT count(*) FROM public.engine_maintenance_break') == '1', 'partial promo installment cannot clear maintenance row')
                for _ in range(12):
                    r = ot.call(c)
                    if r.get('complete'): break
                check(r.get('complete') is True, 'original five-argument owner releases after all promo targets')
                check(c.val("SELECT bool_and(a.expires_at=b.expires_at+CASE WHEN x.target_id IS NULL THEN interval '0' ELSE interval '300 seconds' END) FROM public.ca_promo_play_through_grants a JOIN public.test_promo_before b USING(id) LEFT JOIN public.engine_maintenance_thaw_targets x ON x.target_id=a.id AND x.step='promo_expires_at'") == 't', 'entire freeze preserved once, excluded deadlines unchanged')
                check(c.val("SELECT bool_and(credited_seconds=300) FROM public.engine_maintenance_thaw_targets WHERE step='promo_expires_at'") == 't', 'exact promo receipts fully credited')
                before = c.val('SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM public.ca_promo_play_through_grants g')
                check(ot.call(c)['reason'] == 'release_receipt_recovered', 'completed replay recovers original release receipt')
                check(c.val('SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM public.ca_promo_play_through_grants g') == before, 'replay never credits full duration twice')
                # Independent pre-release installment fixture: never add credit
                # after the original owner's final DELETE.
                ot.reset(c,270)
                c.psql('DROP TABLE public.test_promo_before; CREATE TABLE public.test_promo_before AS SELECT * FROM public.ca_promo_play_through_grants')
                c.psql("INSERT INTO public.engine_maintenance_thaws(freeze_started_at,frozen_seconds,shifted,contract_version) SELECT freeze_start,300,'{}',3 FROM public.test_parameters; SELECT public.fn_snapshot_maintenance_thaw_targets(freeze_start,300) FROM public.test_parameters")
                c.psql("UPDATE public.ca_promo_play_through_grants SET closed_at=clock_timestamp() WHERE id=(SELECT target_id FROM public.engine_maintenance_thaw_targets WHERE step='promo_expires_at' ORDER BY target_id LIMIT 1)")
                for _ in range(3): c.psql("SELECT public.fn_credit_maintenance_thaw_targets(freeze_start,300) FROM public.test_parameters")
                # Same original bounded worker advances only the new suffix.
                c.psql("SELECT public.fn_credit_maintenance_thaw_targets(freeze_start,315) FROM public.test_parameters")
                check(c.val("SELECT count(*) FROM public.engine_maintenance_thaw_targets WHERE step='promo_expires_at' AND credited_seconds=315") == '200', 'tail credit remains bounded to two hundred')
                for _ in range(3): c.psql("SELECT public.fn_credit_maintenance_thaw_targets(freeze_start,315) FROM public.test_parameters")
                check(c.val("SELECT bool_and(a.expires_at=b.expires_at+CASE WHEN a.closed_at IS NULL THEN interval '315 seconds' ELSE interval '0' END) FROM public.ca_promo_play_through_grants a JOIN public.test_promo_before b USING(id) JOIN public.engine_maintenance_thaw_targets x ON x.target_id=a.id AND x.step='promo_expires_at'") == 't', 'tail credits exact fifteen-second suffix')
                check(c.val("SELECT count(*) FROM public.engine_maintenance_break") == '1', 'tail work remains before original release row deletion')
                check(c.val("SELECT count(*) FROM public.ca_promo_play_through_grants a JOIN public.test_promo_before b USING(id) JOIN public.engine_maintenance_thaw_targets x ON x.target_id=a.id WHERE a.closed_at IS NOT NULL AND a.expires_at=b.expires_at") == '1', 'a grant completed after snapshot keeps its terminal expiry unchanged')
                # Empty programme must still emit its zero-count required step.
                c.psql('TRUNCATE public.ca_promo_play_through_grants')
                ot.reset(c,270)
                for _ in range(8):
                    r=ot.call(c)
                    if r.get('complete'): break
                check(r.get('complete') and r['shifted']['promo_expires_at'] == 0, 'zero-grant thaw completes through same owner')
            finally:
                c.stop()
    finally:
        if args.output:
            args.output.mkdir(parents=True, exist_ok=True)
            (args.output/'RESULTS.json').write_text(json.dumps(CHECKS,indent=2)+'\n')

if __name__ == '__main__':
    main()
