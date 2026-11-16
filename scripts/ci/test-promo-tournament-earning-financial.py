#!/usr/bin/env python3
"""Run the existing public PKO/mystery proof on the maintained real journal closure.

Reuses the original returns fixture bootstrap through its explicit bust seed
boundary. Missing or changed bootstrap boundaries refuse rather than replacing
financial owners or guards. No production access or W allocation claim.
"""
import argparse,sys
from pathlib import Path
own=Path(__file__).resolve();ticket_root=own.parents[2]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--output',type=Path,required=True);p.add_argument('--pg-bin',type=Path,required=True)
p.add_argument('--financial-root',type=Path,default=ticket_root)
p.add_argument('--migration',type=Path,default=ticket_root/'supabase/migrations/20261116200638_tournament_winnings_retain_original_earning_generation_and_c.sql')
p.add_argument('--custody-migration',type=Path)
options=p.parse_args();source=options.financial_root.resolve()/'scripts/ci/test-promo-principal-returns.py'
if not source.is_file():raise SystemExit('maintained original returns financial bootstrap is required: '+str(source))
extra=['--custody-migration',str(options.custody_migration.resolve())] if options.custody_migration else []
sys.argv=[str(source),'--output',str(options.output.resolve()),'--pg-bin',str(options.pg_bin.resolve()),'--ticket-tree',str(ticket_root)]+extra
migration=options.migration.resolve()
text=source.read_text();marker=" seed=(root/'scripts/ci/probes/bounty-rebuy-generation-atomicity.sql').read_text().split('SET LOCAL session_replication_role=origin;')[0]"
if text.count(marker)!=1:raise SystemExit('maintained original bust bootstrap boundary changed')
prefix=text[:text.index(marker)]
body='''
 db=bust_db
 for path in [proof_runner,args.ticket_tree/'tests/fixtures/promo-ticket-play-through/generation-money-registry.json',args.ticket_tree/'tests/fixtures/promo-ticket-play-through/generation-owners.json',args.ticket_tree/'tests/fixtures/promo-ticket-play-through/generation-nonwallet-owners.json',args.ticket_tree/'tests/fixtures/promo-ticket-play-through/generation-public-financial.sql']:remember(path)
 e.sql(db,"INSERT INTO public.ca_money_rpc_registry(proname,status,notes) SELECT proname,status,notes FROM jsonb_to_recordset('"+json.dumps(json.loads((args.ticket_tree/'tests/fixtures/promo-ticket-play-through/generation-money-registry.json').read_text())).replace("'","''")+"'::jsonb) AS x(proname text,status text,notes text) ON CONFLICT(proname) DO UPDATE SET status=EXCLUDED.status,notes=EXCLUDED.notes",label='actual-original-source-money-registry')
 for row in json.loads((args.ticket_tree/'tests/fixtures/promo-ticket-play-through/generation-owners.json').read_text())+json.loads((args.ticket_tree/'tests/fixtures/promo-ticket-play-through/generation-nonwallet-owners.json').read_text()):
  if row['proname'] in ('process_tournament_rebuy','fn_ca_process_tournament_chip_purchase_money_v1','fn_ca_pay_closed_target_ticket_in_cash','fn_ca_return_satellite_entitlement_as_ticket'):continue
  e.sql(db,row['definition']+';',label='generation-original-'+row['proname'][:25])
 free_table=re.search(r'CREATE TABLE public[.]ca_promo_free_buy_funding_slices.*?;',ticket,re.S).group(0)
 e.sql(db,free_table,label='actual-cold-freebuy-slice-table')
 generation=proof_migration;remember(generation)
 e.sql(db,file=generation,label='original-generation-source-producer')
 seed=(root/'scripts/ci/probes/bounty-rebuy-generation-atomicity.sql').read_text().split('SET LOCAL session_replication_role=origin;')[0]
 seed+=(args.ticket_tree/'tests/fixtures/promo-ticket-play-through/generation-public-financial.sql').read_text()
 e.sql(db,seed,label='actual-public-pko-entry-and-source',seconds=60)
 e.report['status']='passed';e.report['scope']='Actual public PKO and mystery payouts, fresh reentry/rebuy and exact replay under original financial guards; initial head/accepted-hand source is an explicit opening.'
finally:
 e.report['source_sha256']={**manifest['source_sha256'],**tested}
 e.report['fixture_limits']=current['limits']+['Initial accepted hand, bought head and entry balances are typed openings. The new public bounty payout and new purchase/journal remain original. No W allocation proof claimed.']
 e.report['current_function_pins']=len(current['functions']);e.report['current_financial_triggers']=len(current['triggers'])
 e.close();(out/'RESULTS.json').write_text(json.dumps(e.report,indent=2)+'\\n')
'''
exec(compile(prefix+body,str(source),'exec'),{'__file__':str(source),'__name__':'__main__','proof_runner':own,'proof_migration':migration})
