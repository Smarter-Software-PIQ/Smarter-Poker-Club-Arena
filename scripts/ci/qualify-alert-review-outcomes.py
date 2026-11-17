"""Extend the maintained real controller fixture; no production connection."""
import json
from pathlib import Path

def qualify(root,sql,psql,record,incident,tick,now,ok):
    path=root/'tests/fixtures/alert-review-outcomes/preimages.json'
    source=root/'supabase/migrations/20261117185350_verified_alert_outcomes_follow_original_source_identity.sql'
    sql("""CREATE TABLE public.ca_drift_incidents(id uuid PRIMARY KEY,status text,created_at timestamptz,detected_at timestamptz,resolved_at timestamptz,deadline_at timestamptz,closure_basis text,root_cause text,correction_ref text,resolution text,metadata jsonb);
    CREATE TABLE public.financial_alerts(id uuid PRIMARY KEY,source text,created_at timestamptz,resolved boolean,resolved_at timestamptz,context jsonb,resolution text);
    CREATE TABLE public.ca_incident_file_failures(source text,dedupe_key text,classification text,severity text,discrepancy numeric,sqlstate text,message text);
    CREATE TABLE public.sp_daily_metrics(day date,metrics jsonb,attention jsonb,computed_at timestamptz,compute_ms int);
    CREATE TABLE public.sp_daily_digest_runs(day date,status text,sent_at timestamptz);
    CREATE TABLE public.club_rake_daily_user(day date,rake_amount numeric);
    CREATE FUNCTION public.fn_sp_digest_attention(date,jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT '[]'::jsonb$$;
    CREATE FUNCTION public.fn_ca_horse_roster_digest(date) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
    CREATE FUNCTION public.fn_sp_digest_engine_cutover(date) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
    CREATE FUNCTION public.fn_ca_promo_daily_digest(date) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
    """)
    for row in json.loads(path.read_text()):
        sql(row['definition']+';')
    # A concurrently admitted source keeps its existing classification path.
    row=next(row for row in json.loads(path.read_text()) if row['signature']=='fn_operational_alert_mirror_classify()')
    extra_handler="  IF NEW.source='already-supported-extra' THEN NEW.investigation_status:='informational'; NEW.investigation:=jsonb_build_object('rule','existing-source-handler'); RETURN NEW; END IF;\n"
    sql(row['definition'].replace('BEGIN\n','BEGIN\n'+extra_handler,1)+';')
    sql("CREATE TRIGGER a0_operational_alert_mirror_classify BEFORE INSERT ON public.operational_alert_events FOR EACH ROW WHEN(NEW.investigation_status='new' AND NEW.source IN('financial-alerts-backfill','financial-alerts-updates','drift-incidents-backfill','drift-incidents-updates','alertmanager','already-supported-extra')) EXECUTE FUNCTION public.fn_operational_alert_mirror_classify();")
    sql("""CREATE TRIGGER a_operational_alert_investigation_touched BEFORE UPDATE OF investigation,investigation_status ON public.operational_alert_events FOR EACH ROW WHEN(OLD.investigation IS DISTINCT FROM NEW.investigation OR OLD.investigation_status IS DISTINCT FROM NEW.investigation_status) EXECUTE FUNCTION public.fn_operational_alert_investigation_touched();
    CREATE TRIGGER fixture_original_source_resolution AFTER UPDATE ON public.ca_drift_incidents FOR EACH ROW EXECUTE FUNCTION public.fn_ca_incident_resolution_reaches_the_alerts();""")
    def literal(v):return "'"+json.dumps(v).replace("'","''")+"'::jsonb"
    def proof(e):return json.loads(sql(f"SELECT public.fn_sp_original_alert_proof({e})"))
    def report(e):
        item={'rule':'signups_dropped','title':'Historical actual low signups','severity':'warning','alert_event_id':e}
        sql("TRUNCATE sp_daily_metrics;INSERT INTO sp_daily_metrics VALUES('2026-11-16','{\"money\":{\"ledger_rake_utc_day\":0}}',"+literal([item])+",now(),1)")
        return json.loads(sql("SELECT public.fn_sp_daily_digest('2026-11-16',false)"))['attention'][0]
    reviewed=record('sp-daily-digest','review-qualified','DailyDigest.signups_dropped','firing','warning',{})
    review={'review':{'reviewed_at':now(), 'reviewed_by':'isolated original reader','finding':'The original low signup count is accurate; no signup code failure was established.'}}
    sql(f"UPDATE operational_alert_events SET investigation_status='informational',investigation={literal(review)} WHERE id={reviewed}")
    assert not proof(reviewed)['reviewed'] and report(reviewed)['status']=='not_picked_up'
    drift='a0010000-0000-4000-8000-000000000001'
    at=now("- interval '1 minute'")
    sql(f"INSERT INTO ca_drift_incidents VALUES('{drift}','open',now()-interval '2 minutes',now()-interval '2 minutes',NULL,now(),NULL,NULL,NULL,NULL,'{{}}')")
    def notification(d=drift,stamp=at,typ='financial_incident'):
        return {'original_notification':{'id':'a0010000-0000-4000-8000-000000000099','type':typ,'created_at':stamp,'data':{'incident_id':d}}}
    owner_name='financial_incident:fn_ca_orphaned_running_tournaments is critical'
    owner=record('owner-operational-notifications','source-original',owner_name,'firing','critical',notification())
    cause='The authoritative original source transaction was verified complete with its original receipt.'
    sql(f"UPDATE ca_drift_incidents SET status='resolved',resolved_at=clock_timestamp(),closure_basis='verified_remeasured',root_cause='{cause}',correction_ref='PR #11193',resolution='Original durable receipt and zero residual verified' WHERE id='{drift}'")
    assert sql(f"SELECT status FROM operational_alert_events WHERE id={owner}")=='firing'
    metadata=sql("SELECT jsonb_agg(jsonb_build_array(oid,proowner,proacl,proconfig,prosecdef) ORDER BY oid) FROM pg_proc WHERE oid IN("+','.join("'"+row['signature']+"'::regprocedure" for row in json.loads(path.read_text()))+")")
    before_observations=sql(f"SELECT count(*) FROM smarter_private.reliability_observations WHERE inbox_event_id={owner}")
    sql(source.read_text())
    extra=record('already-supported-extra','source-extension','ExistingExtraSource','firing','info',{})
    assert sql(f"SELECT investigation->>'rule' FROM operational_alert_events WHERE id={extra}")=='existing-source-handler'
    assert proof(reviewed)['reviewed'] and not proof(reviewed)['verified']
    assert report(reviewed)['status']=='fixed' and 'no signup code failure' in report(reviewed)['resolution']
    assert sql(f"SELECT status FROM operational_alert_events WHERE id={reviewed}")=='firing'
    ok('explicit informational review is reviewed in the actual digest, never a source recovery or controller resolution')
    assert sql(f"SELECT status FROM operational_alert_events WHERE id={owner}")=='resolved'
    assert proof(owner)['kind']=='original_drift_resolution'
    assert incident(owner_name)=='verifying'
    assert int(sql(f"SELECT count(*) FROM smarter_private.reliability_observations WHERE inbox_event_id={owner}"))==int(before_observations)+1
    tick(now("+ interval '31 minutes'"))
    assert incident(owner_name)=='recovered'
    ok('original pre-install drift proof closes its exact owner mirror once and real intake recovers only after quiet')
    # No blanket informational suppression: automatic mirror labels have no human review witness.
    automatic=record('other','automatic-info','OriginalAutomaticMirror','firing','critical',{})
    sql(f"UPDATE operational_alert_events SET investigation_status='informational',investigation='{{\"rule\":\"mirror_duplicate_of_captured_original\"}}' WHERE id={automatic}")
    assert not proof(automatic)['reviewed'] and report(automatic)['status']=='not_picked_up'
    for bad in [
        {'review':review['review']|{'reviewed_at':'not-a-timestamp'}},
        {'review':review['review']|{'reviewed_at':now("+ interval '1 hour'")}},
        {'review':review['review']|{'finding':'short'}},
        {'review':review['review']|{'reviewed_by':''}},
        ['malformed'],
    ]:
        sql(f"UPDATE operational_alert_events SET investigation={literal(bad)} WHERE id={reviewed}")
        assert not proof(reviewed)['reviewed']
    sql(f"UPDATE operational_alert_events SET investigation={literal(review)} WHERE id={reviewed}")
    sql(f"UPDATE operational_alert_events SET last_received_at=clock_timestamp()+interval '1 second' WHERE id={reviewed}")
    assert not proof(reviewed)['reviewed']
    ok('automatic duplicates, malformed/future/missing review and newer firing remain unreviewed')
    # The future producer uses the same UUID and causal event clock.
    sql(f"UPDATE ca_drift_incidents SET status='open',resolved_at=NULL,detected_at=clock_timestamp()-interval '1 minute' WHERE id='{drift}'")
    fresh=record('owner-operational-notifications','source-future',owner_name,'firing','critical',notification(stamp=now()))
    sql(f"UPDATE ca_drift_incidents SET status='resolved',resolved_at=clock_timestamp(),closure_basis='aged_out_unverified' WHERE id='{drift}'")
    assert sql(f"SELECT status FROM operational_alert_events WHERE id={fresh}")=='firing'
    assert not proof(fresh)['verified']
    original_root=sql(f"SELECT root_cause FROM ca_drift_incidents WHERE id='{drift}'")
    sql(f"UPDATE ca_drift_incidents SET closure_basis='verified_remeasured',root_cause='weak' WHERE id='{drift}'")
    assert sql(f"SELECT status FROM operational_alert_events WHERE id={fresh}")=='firing'
    assert not proof(fresh)['verified']
    sql(f"UPDATE ca_drift_incidents SET status='open',resolved_at=NULL WHERE id='{drift}'")
    root_text="'"+original_root.replace("'","''")+"'"
    sql(f"UPDATE ca_drift_incidents SET status='resolved',resolved_at=clock_timestamp(),root_cause={root_text} WHERE id='{drift}'")
    assert sql(f"SELECT status FROM operational_alert_events WHERE id={fresh}")=='resolved'
    assert incident(owner_name)=='verifying'
    late=record('owner-operational-notifications','source-late',owner_name,'firing','critical',notification(stamp=now("- interval '1 second'")))
    assert sql(f"SELECT status||':'||investigation_status FROM operational_alert_events WHERE id={late}")=='resolved:informational'
    assert proof(late)['verified'] and proof(late)['reference'].startswith('Verified original drift')
    ok('future original source resolution propagates synchronously; age-out stays unknown and late mirrors cannot reopen the resolved source')
    for key,payload in [
        ('foreign',notification('a0010000-0000-4000-8000-000000000002')),
        ('malformed',notification('not-a-uuid')),
        ('wrong-type',notification(typ='something_else')),
        ('old-episode',notification(stamp=now("- interval '1 day'"))),
        ('future-clock',notification(stamp=now("+ interval '1 day'"))),
    ]:
        event=record('owner-operational-notifications',key,owner_name,'firing','critical',payload)
        assert sql(f"SELECT status FROM operational_alert_events WHERE id={event}")=='firing'
        assert not proof(event)['verified']
    assert sql("SELECT count(*) FROM ca_incident_file_failures")=='0'
    assert metadata==sql("SELECT jsonb_agg(jsonb_build_array(oid,proowner,proacl,proconfig,prosecdef) ORDER BY oid) FROM pg_proc WHERE oid IN("+','.join("'"+row['signature']+"'::regprocedure" for row in json.loads(path.read_text()))+")")
    result=psql(['-f',str(source)])
    assert result.returncode!=0 and 'original verified review changed' in result.stderr, result.stderr
    ok('foreign/malformed/wrong type/old or future episode never borrows a resolution; existing function authority preserved; repeated install refuses stale postimage')
