#!/usr/bin/env python3
"""Exercise promo custody through the maintained full PG17 accepted-hand owner.

Reuses its real money authority closure and exact seat-generation fixture.
Only the isolated opening principal is seeded; actual hand acceptance, losses,
envelope, seat writes and response-loss replay execute the real source chain.
"""
import argparse,os,sys,json
from pathlib import Path
root=Path(__file__).resolve().parents[2];sys.path.insert(0,str(root/'scripts/ci'))
from satellite_qualifier_fixture import module
roster=module(root/'scripts/ci/test-accepted-hand-roster.py','custody_roster')
hs=module(root/'scripts/ci/test-hand-submission.py','custody_hs')
native=module(root/'scripts/ci/test-mtt-unlimited.py','custody_native')
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--output',type=Path,required=True);p.add_argument('--pg-bin',type=Path,required=True)
args=p.parse_args()
if sys.platform=='darwin' and not os.environ.get('TMPDIR','').startswith('/Volumes/'):
 raise SystemExit('external TMPDIR required')
out=args.output.resolve();out.mkdir(parents=True,exist_ok=False)
manifest=hs.prepare(root,out)
(out/'current-chain.sql').write_text(roster.current_chain(root))
e=native.Execution(root,out,args.pg_bin.resolve(),Path(os.environ.get('TMPDIR',str(out))),600,
 socket_parent=Path(os.environ.get('TMPDIR',str(out))))
try:
 e.start();db=e.database()
 for f,label in [(out/'foundation.sql','foundation'),(out/'current-authorities.sql','authorities'),(root/'scripts/ci/probes/atomic-terminal-rehearsal-fixture.sql','structural'),(root/roster.SUBMISSION,'submission'),(out/'current-chain.sql','chain'),(root/roster.RAKED_DIAMOND,'diamond'),(root/roster.MIGRATION,'roster')]:
  e.sql(db,file=f,label=label,seconds=180)
 e.sql(db,"""CREATE TABLE IF NOT EXISTS public.ca_declared_money_triggers(table_name text,trigger_name text,note text,PRIMARY KEY(table_name,trigger_name));
 CREATE TABLE IF NOT EXISTS public.accounting_tournament_fee_sources(id uuid DEFAULT gen_random_uuid(),tournament_id uuid,player_id uuid,club_id uuid,rake_credit numeric,charged_at timestamptz,rake_record_id uuid);
 ALTER TABLE public.accounting_tournament_fee_sources ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),ADD COLUMN IF NOT EXISTS rake_record_id uuid;
 ALTER TABLE public.rake_records ADD COLUMN IF NOT EXISTS source text;
 CREATE TABLE IF NOT EXISTS public.tournament_unregistration_receipts(registration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tournament_id uuid,user_id uuid,fees_reversed numeric,fee_reversal_ids uuid[],fee_source_rake_record_ids uuid[]);
 CREATE TABLE IF NOT EXISTS public.tournament_cancellation_receipts(tournament_id uuid PRIMARY KEY,total_rake_before numeric,total_rake_after numeric,fees_reversed numeric,fee_reversal_ids uuid[]);
 """,label='promo-fee-relation')
 original_funding=(root/'supabase/migrations/20260917230925_cash_funding_retains_original_participant_custody.sql').read_text()
 funding_start=original_funding.index('CREATE FUNCTION public.fn_cash_record_original_funding(')
 funding_end=original_funding.index('-- This is a prospective game/roster snapshot',funding_start)
 e.sql(db,original_funding[funding_start:funding_end],label='original-cash-funding-owner')
 for f in sorted((root/'supabase/migrations').glob('*_promo_play_through_*.sql')):e.sql(db,file=f,label=f.stem[:35])
 e.sql(db,file=root/'supabase/migrations/20261116153059_promo_principal_follows_its_original_grant_through_wallet_an.sql',label='custody')
 probe='BEGIN;\n'+(out/'opening.sql').read_text()+(root/roster.FIXTURE).read_text()+'''
UPDATE ca_promo_play_through_settings SET enforced_from=clock_timestamp()-interval '1 second';
SELECT fn_ca_promo_play_through_record_grant('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',50,'club_promo','native-full-hand');
SELECT fn_ca_promo_move_custody('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001','table_stack','88100000-0000-0000-0000-000000000001',50);
DO $$DECLARE r jsonb;BEGIN
 r:=pg_temp.roster_commit(8800007,'88400000-0000-0000-0000-000000000007');
 IF r->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'actual cash hand refused %',r; END IF;
 IF (SELECT remaining FROM ca_promo_play_through_grants WHERE source_ref='native-full-hand') IS DISTINCT FROM 50::numeric THEN RAISE EXCEPTION 'actual hand consumed promo before its fifty unrestricted chips'; END IF;
 IF (SELECT promo_contribution FROM ca_promo_cash_hand_funding WHERE hand_id='88400000-0000-0000-0000-000000000007') IS DISTINCT FROM 0::numeric THEN RAISE EXCEPTION 'actual hand did not retain unrestricted-first funding'; END IF;
 RAISE NOTICE 'CUSTODY ACTUAL ACCEPTED HAND PASS';
 r:=pg_temp.roster_commit(8800007,'88400000-0000-0000-0000-000000000007');
 IF r->>'success' IS DISTINCT FROM 'true' OR (SELECT remaining FROM ca_promo_play_through_grants WHERE source_ref='native-full-hand') IS DISTINCT FROM 50::numeric THEN RAISE EXCEPTION 'actual accepted replay changed principal %',r; END IF;
 RAISE NOTICE 'CUSTODY ACTUAL REPLAY PASS';
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;'''
 e.sql(db,probe,label='actual-accepted-cash-hand',seconds=120)
 e.report['status']='passed'
 e.report['native'].append({'case':'actual-accepted-cash-hand-and-replay','assertions':2})
 inputs=[Path(__file__).resolve(),root/'supabase/migrations/20261116153059_promo_principal_follows_its_original_grant_through_wallet_an.sql',
  root/'scripts/ci/test-accepted-hand-roster.py',root/roster.CAPTURE,root/roster.LIGHTNING,
  root/roster.RETIRED_CASH,root/roster.RAKED_DIAMOND,root/roster.MIGRATION,root/roster.FIXTURE]
 inputs+=sorted((root/'supabase/migrations').glob('*_promo_play_through_*.sql'))
 e.report['source_sha256']={**manifest['source_sha256'],**{str(f.relative_to(root)):roster.sha(f) for f in inputs}}
 print('actual accepted hand and replay passed')
finally:
 e.close();(out/'RESULTS.json').write_text(json.dumps(e.report,indent=2)+'\n')
