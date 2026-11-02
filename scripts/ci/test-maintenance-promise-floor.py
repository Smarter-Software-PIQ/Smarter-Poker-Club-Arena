#!/usr/bin/env python3
"""Actual old EED client and v3 SQL, private PostgreSQL, no production writes."""
import importlib.util
import json
import re
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('on_time', ROOT/'scripts/ci/test-on-time-maintenance-thaw.py')
ot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ot)
MIG = ROOT/'supabase/migrations/20261102121000_maintenance_thaw_honors_the_original_announced_release_bound.sql'
FIX = ROOT/'scripts/ci/fixtures/maintenance-promise'

def call(c, token=ot.TOKEN):
    return c.rpc("public.fn_thaw_platform((select freeze_start-interval '2 minutes'+interval '1 millisecond' from test_parameters),(select freeze_start from test_parameters),300,'%s','old EED qualification')" % token)

def reset(c, elapsed=270):
    ot.reset(c, elapsed)
    c.psql("update engine_maintenance_break set announced_at=announced_at+interval '1 millisecond';")

def finish(c, token=ot.TOKEN):
    results=[]
    for _ in range(40):
        r=call(c,token); results.append(r)
        if r.get('complete'): return results
        ot.require(r.get('ok') and r.get('retryable'), 'committed installment recoverable')
    raise AssertionError('bounded thaw did not complete')

def main():
    with tempfile.TemporaryDirectory(prefix='promise-') as directory:
        c=ot.base.Cluster(directory)
        try:
            c.start(); c.psql(ot.base.FIXTURE+ot.EXTRA)
            c.psql((ot.FIX/'bypass.sql').read_text()+(ot.FIX/'authority.sql').read_text())
            c.psql((ROOT/'supabase/migrations/20261018172103_prepare_the_certified_thaw_before_the_advertised_hour.sql').read_text())
            c.psql((ROOT/'supabase/migrations/20261020011548_a_heavy_thaw_releases_on_the_hour_when_nothing_is_left_to_cr.sql').read_text())
            c.psql('CREATE TABLE public.engine_leader(id boolean PRIMARY KEY,engine_version text,instance_id text,heartbeat_at timestamptz);')
            reset(c)
            old=finish(c)
            ot.require(float(old[-1]['effective_frozen_seconds'])==300, 'old authority reproduces shortened announced promise')
            historical=c.val('select to_jsonb(t)::text from engine_maintenance_thaws t')
            c.psql(MIG.read_text(),error='PROMISED_RELEASE_REQUIRES_QUIESCENT_CUTOVER')
            # Fixture time travel only, preserve a complete historical receipt for replay.
            c.psql("update engine_maintenance_thaws set release_target_at=clock_timestamp()-interval '1 minute';")
            historical=c.val('select to_jsonb(t)::text from engine_maintenance_thaws t')
            c.psql(MIG.read_text())
            ot.require(c.val('select to_jsonb(t)::text from engine_maintenance_thaws t')==historical, 'installation does not repair historical receipts')
            ot.require(call(c)['reason']=='release_receipt_recovered', 'historical complete receipt still recoverable without replay')
            c.psql(MIG.read_text(),error='PROMISED_RELEASE_PREIMAGE_DRIFT')
            for sig in [ot.SIG,'public.fn_engine_maintenance_promise_proof()']:
                ot.require(c.val("select (not has_function_privilege('anon','%s','execute') and not has_function_privilege('authenticated','%s','execute') and has_function_privilege('service_role','%s','execute'))::text"%(sig,sig,sig))=='true','service only '+sig)
            contract=c.rpc('public.fn_engine_maintenance_promise_proof()')
            ot.require(contract['schema']=='maintenance-promise-floor/v1' and contract['thawDefinitionMd5']=='cb733d7201725719813ffd1b1e099b1b' and contract['maintenance'] is None, 'actual read-only contract reports installed definition')
            reset(c,100)
            ot.require(call(c)['reason']=='maintenance_break_not_due','early preparation refused')
            ot.require(c.val('select count(*) from engine_maintenance_thaws')=='0','early request writes no checkpoint')
            reset(c)
            source=(ROOT/'scripts/ci/test-on-time-maintenance-thaw.py').read_text()
            seed=re.search(r'c.psql\(r"""\n(INSERT INTO public.tournaments.*?)"""\)',source,re.S).group(1)
            c.psql(seed)
            deadlines=re.search(r'CREATE TABLE public.test_deadlines_before AS\n(.*?);\nCREATE TRIGGER',source,re.S).group(1)
            c.psql('CREATE VIEW public.test_deadlines_after AS '+deadlines+';')
            money=ot.fingerprint(c)
            ot.require(call(c,ot.NEXT)['reason']=='maintenance_ownership_changed','competitor refused')
            first=call(c)
            ot.require(not first['complete'],'actual committed partial checkpoint')
            ot.require(c.val("select (frozen_seconds=300.001)::text from engine_maintenance_thaws")=='true','initial checkpoint credits original promise')
            # Replacement/rollback adopts the same raw row, just as the deployed store does.
            c.psql("update engine_maintenance_break set ownership_token='%s'"%ot.NEXT)
            ot.require(call(c)['reason']=='maintenance_ownership_changed','retired process refused after adoption')
            results=finish(c,ot.NEXT)
            final=results[-1]
            ot.require(c.val('select count(distinct step) from engine_maintenance_thaw_targets')=='15','all fifteen deadline families exercised')
            ot.require(c.val('select bool_and(credited_seconds=300.001)::text from engine_maintenance_thaw_targets')=='true','all targets credit exactly actual 300.001 seconds')
            ot.require(c.val("select (release_target_at=due_at+interval '1 millisecond' and frozen_seconds=300.001)::text from engine_maintenance_thaws cross join test_parameters")=='true','release equals original announcement plus seven minutes')
            ot.require(c.val("select bool_and(a.at=b.at+interval '300.001 seconds')::text from test_deadlines_after a join test_deadlines_before b using(kind,id)")=='true','each deadline receives full actual duration once')
            ot.require(c.val("select bool_and(t.level_started_at is not distinct from (case when t.on_break or b.level_started_at is null then b.level_started_at else b.level_started_at+interval '300.001 seconds' end))::text from tournaments t join test_level_before b using(id)")=='true','level credit preserves independent pauses and null clocks')
            ot.require(c.val("select bool_and((disconnect_states->'player'->>'reconnectDeadlineMs')::numeric=extract(epoch from freeze_start+interval '360.001 seconds')*1000)::text from (select disconnect_states from engine_presence_parked union all select disconnect_states from hand_state_snapshots) r cross join test_parameters")=='true','both reconnect clock families receive full actual duration')
            ot.require(ot.fingerprint(c)==money,'money and roster unchanged')
            clocks=c.val('select jsonb_agg(to_jsonb(d) order by kind,id)::text from test_deadlines_after d')
            replay=call(c,ot.NEXT)
            ot.require(replay['reason']=='release_receipt_recovered','lost acknowledgement recovers exact receipt')
            ot.require(c.val('select jsonb_agg(to_jsonb(d) order by kind,id)::text from test_deadlines_after d')==clocks,'duplicate recovery credits nothing twice')
            ot.require(ot.fingerprint(c)==money,'duplicate recovery preserves money and roster')
            ot.require(c.val('select (fn_platform_frozen() and fn_entry_purchases_frozen())::text')=='true','both real restrictions retain promised floor')
            c.psql('INSERT INTO public.tournament_players(tournament_id,user_id) SELECT id,gen_random_uuid() FROM public.tournaments LIMIT 1',error='PLATFORM_FROZEN')
            payload={'results':results,'replay':replay,'announcedAt':c.val("select extract(epoch from freeze_start-interval '2 minutes'+interval '1 millisecond')*1000 from test_parameters")}
            fixture=Path(directory)/'responses.json';fixture.write_text(json.dumps(payload))
            subprocess.run(['node','--experimental-transform-types',str(FIX/'old-client.mjs'),str(fixture)],check=True)
            seconds=float(c.val("select greatest(0,extract(epoch from due_at+interval '1 millisecond'-clock_timestamp())) from test_parameters"))
            time.sleep(seconds+0.02)
            ot.require(c.val('select (not fn_platform_frozen() and not fn_entry_purchases_frozen())::text')=='true','restrictions release after original promise')
            # Late/interrupted suffix uses the existing conservative rebase, never an early floor.
            reset(c,301)
            late=finish(c)
            ot.require(float(late[-1]['effective_frozen_seconds'])>301,'late recovery credits actual elapsed pause')
            ot.require(c.val("select (release_target_at>=announced_at+interval '7 minutes')::text from engine_maintenance_thaws")=='true','late recovery cannot shorten promise')
            print('PASS maintenance promise PostgreSQL and immutable old client qualification')
        finally:c.stop()

if __name__=='__main__':main()
