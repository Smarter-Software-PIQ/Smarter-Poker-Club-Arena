"""Entry hold at its actual acquisition owner, in the existing funded PG fixture."""
import hashlib,json
from pathlib import Path

def qualify(e,db,root,event,table,auth):
 capture=root/'scripts/ci/fixtures/tournament-recovery20/nov3-seat-acquisition-preimage.json'
 row=json.loads(capture.read_text())
 assert hashlib.md5(row['definition'].encode()).hexdigest()==row['md5']
 migration=root/'supabase/migrations/20261103122200_tournament_hold_blocks_all_entry_acquisition.sql'
 old=(root/'supabase/migrations/20261030001305_owner_holds_new_tournament_starts_while_running_events_finis.sql').read_text()
 held=old[old.index('CREATE FUNCTION public.fn_ca_new_tournament_starts_blocked()'):old.index('CREATE OR REPLACE FUNCTION public.fn_ca_launch_tournament_start_refused')].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1)
 body=migration.read_text().replace('\nBEGIN;\n','\n',1).removesuffix('COMMIT;\n')
 setup="BEGIN;CREATE TABLE IF NOT EXISTS public.ca_tournament_start_hold(singleton boolean PRIMARY KEY,operation_id uuid,blocked boolean,reason text,requested_at timestamptz DEFAULT now());INSERT INTO public.ca_tournament_start_hold(singleton,operation_id,blocked,reason) VALUES(true,'01000000-0000-4000-8000-000000000001',true,'qualification owner hold') ON CONFLICT(singleton) DO UPDATE SET blocked=true;"+held+(root/'scripts/ci/fixtures/tournament-recovery20/nov3-launch-started-preimage.sql').read_text()+row['definition']+';'+auth
 call="public.fn_ca_lock_tournament_seat_acquisition('"+event+"','"+table+"','d1000000-0000-4000-8000-000000000001')"
 sql=setup+"CREATE TEMP TABLE hold_money_before AS SELECT smarter_private.tournament_abort_money_snapshot('"+event+"') AS image;CREATE TEMP TABLE hold_before AS SELECT to_jsonb(h) AS image FROM public.ca_tournament_start_hold h;DO $$BEGIN IF ("+call+")->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'baseline existing started entry not admitted';END IF;END$$;"+body+"DO $$BEGIN IF ("+call+")->>'reason' IS DISTINCT FROM 'operator_floor_parked' THEN RAISE EXCEPTION 'existing entry escaped hold';END IF;IF ("+call.replace('d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002')+")->>'reason' IS DISTINCT FROM 'operator_floor_parked' THEN RAISE EXCEPTION 'new entry escaped hold';END IF;IF (SELECT image FROM hold_money_before) IS DISTINCT FROM smarter_private.tournament_abort_money_snapshot('"+event+"') OR (SELECT image FROM hold_before) IS DISTINCT FROM (SELECT to_jsonb(h) FROM public.ca_tournament_start_hold h) THEN RAISE EXCEPTION 'hold changed financial or hold state';END IF;END$$;UPDATE public.ca_tournament_start_hold SET blocked=false;DO $$BEGIN IF ("+call+")->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'released hold did not restore existing admission';END IF;END$$;SELECT md5(pg_get_functiondef('public.fn_ca_lock_tournament_seat_acquisition(uuid,uuid,uuid)'::regprocedure));ROLLBACK;"
 # Execution.sql retains exact SQL and output in the existing evidence directory.
 _,output,_=e.sql(db,sql,label='actual-entry-owner-hold',seconds=60)
 e.report['entry_hold_cases']=['baseline-existing-started-admitted','held-existing-refused','held-new-refused','no-financial-write','unchanged-hold','released-admission-restored']
 e.report['entry_hold_postimage']=output.strip().splitlines()[-1]
 for p in [Path(__file__),capture,migration,root/'scripts/ci/fixtures/tournament-recovery20/nov3-launch-started-preimage.sql']:e.report['source_sha256'][str(p.relative_to(root))]=hashlib.sha256(p.read_bytes()).hexdigest()
