"""Actual pre-activation mystery cache retirement, never a production repair."""
from tournament_abort_native import sql_file, SERVICE
from equal_share_native_cases import snapshot

def seed(e, db, event):
    # Only the historical elimination scene is synthetic. Existing entries,
    # banks, prior award, settlement, fees and credits remain the real doors.
    sql_file(e, db, 'mystery-retirement-scene', "BEGIN;SET LOCAL session_replication_role=replica;"
        "INSERT INTO auth.users(id) SELECT ('ec790000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid FROM generate_series(1,78) i;"
        "INSERT INTO public.users(id,username) SELECT ('ec790000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'mystery_retired_'||i FROM generate_series(1,78) i;"
        "INSERT INTO public.profiles(id,username,display_name) SELECT ('ec790000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'mystery_retired_'||i,'Native retired mystery player' FROM generate_series(1,78) i;"
        "UPDATE public.tournaments SET is_mystery_bounty=true,is_pko=false,"
        "mystery_bounty_stage='pending',mystery_bounty_regular_pool_percent=0 WHERE id='"+event+"';"
        "INSERT INTO public.tournament_players SELECT (jsonb_populate_record(NULL::public.tournament_players,"
        "to_jsonb(p)||jsonb_build_object('id',('ec780000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,"
        "'user_id',('ec790000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,"
        "'status','eliminated','chips',0,'current_bounty',12,'eliminated_at',now(),"
        "'position',i+2,'prize',0,'elimination_sequence',nextval('public.tournament_player_elimination_sequence')))).* "
        "FROM (SELECT * FROM public.tournament_players WHERE tournament_id='"+event+"' ORDER BY id LIMIT 1) p "
        "CROSS JOIN generate_series(1,78) i;COMMIT;")

def qualify(e, db, root, event, op, money_hash, migration):
    call="public.fn_ca_settle_tournament_abort_equal_share('"+op+"','"+event+"','"+money_hash+"')"
    before=snapshot(e,db,'mystery-retirement-before')
    def refuse(label, setup='', reason='equal_share_roster_retirement_incomplete'):
        reviewed_call=call.replace("'"+money_hash+"'", "(SELECT quiescence->>'money_hash' FROM smarter_private.tournament_abort_targets WHERE tournament_id='"+event+"')")
        sql_file(e,db,label,"BEGIN;"+SERVICE+setup+"DO $$DECLARE refused boolean:=false;BEGIN BEGIN PERFORM "+reviewed_call+";"
            "EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'"+reason+"' THEN RAISE;END IF;"
            "refused:=true;END;IF NOT refused THEN RAISE EXCEPTION 'expected retirement refusal absent';END IF;END$$;ROLLBACK;")
        assert snapshot(e,db,label+'-unchanged')==before
    refuse('mystery-retirement-before-fix-refused')
    e.sql(db,file=migration,label='exact-mystery-retirement-migration')
    proof=next(line.removeprefix('-- @live-proof: ') for line in migration.read_text().splitlines() if line.startswith('-- @live-proof: '))
    _,out,_=e.sql(db,'SELECT '+proof+';',label='mystery-retirement-exact-live-proof')
    assert out.strip()=='t'
    for label,change in [
        ('legacy-half', 'mystery_bounty_regular_pool_percent=50'),
        ('active-phase', "mystery_bounty_stage='active'"),
        ('non-mystery', 'is_mystery_bounty=false'),
        ('pko', 'is_pko=true,is_mystery_bounty=false'),
    ]:
        refuse('mystery-retirement-'+label, "SET LOCAL session_replication_role=replica;UPDATE public.tournaments SET "+change+" WHERE id='"+event+"';SET LOCAL session_replication_role=origin;")
    # A fresh synthetic review witnesses the inconsistent chip row; the cache
    # correction must not erase the chips merely because the status is final.
    for value,label in [('1','positive-chips'),('NULL','null-chips')]:
        setup="SET LOCAL session_replication_role=replica;UPDATE public.tournament_players SET chips="+value+" WHERE id='ec780000-0000-4000-8000-000000000001';UPDATE smarter_private.tournament_abort_targets SET money_snapshot=smarter_private.tournament_abort_money_snapshot('"+event+"') WHERE tournament_id='"+event+"';UPDATE smarter_private.tournament_abort_targets SET quiescence=jsonb_set(quiescence,'{money_hash}',to_jsonb(md5(money_snapshot::text))) WHERE tournament_id='"+event+"';SET LOCAL session_replication_role=origin;"
        refuse('mystery-retirement-'+label,setup)
    refuse('mystery-retirement-earned-claim', "SET LOCAL session_replication_role=replica;INSERT INTO public.tournament_obligations(tournament_id,kind,place,user_id,amount_owed,amount_paid) VALUES('"+event+"','place',1,'d1000000-0000-4000-8000-000000000001',0.01,0);SET LOCAL session_replication_role=origin;", 'operator_abort_current_owner_or_boundary_changed')
    e.report.setdefault('cases',[]).extend(['mystery78-before-refusal','mystery78-legacy-half-refused','mystery78-active-refused','mystery78-non-mystery-refused','mystery78-pko-refused','mystery78-positive-chips-refused','mystery78-null-chips-refused','mystery78-earned-claim-refused'])

def verify(e, db, event, receipt):
    original=[p for p in receipt['pre_abort_roster'] if p['id'].startswith('ec780000-')]
    assert len(original)==78 and all(p['current_bounty']==12 and p['chips']==0 for p in original)
    after=snapshot(e,db,'mystery-retirement-after')
    for old in original:
        new=next(p for p in after['tournament_players'] if p['id']==old['id'])
        assert new['current_bounty']==0 and new['chips']==0
        assert {k:v for k,v in old.items() if k not in ('current_bounty','terminal_closed_at','updated_at')}=={k:v for k,v in new.items() if k not in ('current_bounty','terminal_closed_at','updated_at')}
    e.report.setdefault('cases',[]).append('mystery78-original-elimination-history-preserved')
