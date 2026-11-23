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
p.add_argument('--profit-root',type=Path,default=ticket_root)
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
 profit_root=proof_profit_root
 for path in [proof_runner,args.ticket_tree/'tests/fixtures/promo-ticket-play-through/generation-money-registry.json',args.ticket_tree/'tests/fixtures/promo-ticket-play-through/generation-owners.json',args.ticket_tree/'tests/fixtures/promo-ticket-play-through/generation-nonwallet-owners.json',args.ticket_tree/'tests/fixtures/promo-ticket-play-through/generation-public-financial.sql']:remember(path)
 e.sql(db,"INSERT INTO public.ca_money_rpc_registry(proname,status,notes) SELECT proname,status,notes FROM jsonb_to_recordset('"+json.dumps(json.loads((args.ticket_tree/'tests/fixtures/promo-ticket-play-through/generation-money-registry.json').read_text())).replace("'","''")+"'::jsonb) AS x(proname text,status text,notes text) ON CONFLICT(proname) DO UPDATE SET status=EXCLUDED.status,notes=EXCLUDED.notes",label='actual-original-source-money-registry')
 for row in json.loads((args.ticket_tree/'tests/fixtures/promo-ticket-play-through/generation-owners.json').read_text())+json.loads((args.ticket_tree/'tests/fixtures/promo-ticket-play-through/generation-nonwallet-owners.json').read_text()):
  if row['proname'] in ('process_tournament_rebuy','fn_ca_process_tournament_chip_purchase_money_v1','fn_ca_pay_closed_target_ticket_in_cash','fn_ca_return_satellite_entitlement_as_ticket'):continue
  e.sql(db,row['definition']+';',label='generation-original-'+row['proname'][:25])
 free_table=re.search(r'CREATE TABLE public[.]ca_promo_free_buy_funding_slices.*?;',ticket,re.S).group(0)
 e.sql(db,free_table,label='actual-cold-freebuy-slice-table')
 e.sql(db,fee_source[fee_source.index('CREATE FUNCTION public.fn_ca_promo_payable_contract('):fee_source.index('DO $owners$')],label='actual-original-payable-contracts')
 # Authentic P/H/W owners are installed in prospective migration order.
 e.sql(db,ticket[ticket.index('CREATE FUNCTION public.fn_ca_promo_finish_event_principal()'):ticket.index('-- The ordinary debit already owns')],label='original-P-terminal-owner')
 e.sql(db,ticket[ticket.index('CREATE FUNCTION public.fn_ca_promo_roll_event_principal('):ticket.index('-- One original money owner, explicit source')],label='original-P-nonwallet-owner')
 ticket_capture=args.ticket_tree/'tests/fixtures/promo-ticket-play-through/additional-owners.json';remember(ticket_capture)
 for row in json.loads(ticket_capture.read_text()):
  if row['signature'].startswith('fn_issue_tournament_ticket_phase2_core_20260831('):e.sql(db,row['definition']+';',label='original-ticket-cash-core')
 e.sql(db,ticket[ticket.index('-- One original money owner, explicit source'):ticket.index('CREATE OR REPLACE FUNCTION public.fn_issue_tournament_ticket_phase2_core_20260831(')],label='original-cashable-ticket-owner')
 bbj=profit_root/'tests/fixtures/promo-profit-bbj/recipient-owner.json';remember(bbj)
 e.sql(db,json.loads(bbj.read_text())['definition']+';',label='actual-BBJ-recipient-preimage')
 import subprocess
 wrapper="import{stalePinGuardSQL}from'./scripts/ci/migration-stale-pins.mjs';let s='';for await(const b of process.stdin)s+=b;process.stdout.write(stalePinGuardSQL(process.argv[1],s,s));"
 for version in ['20261116161707','20261116190221']:
  migration=next((profit_root/'supabase/migrations').glob(version+'_*.sql'));remember(migration)
  guarded=subprocess.run(['node','--input-type=module','-e',wrapper,migration.name],input=migration.read_text(),text=True,capture_output=True,check=True,cwd=profit_root).stdout
  e.sql(db,guarded,label='actual-full-source-'+version,seconds=120)
 generation=proof_migration;remember(generation)
 guarded=subprocess.run(['node','--input-type=module','-e',wrapper,generation.name],input=generation.read_text(),text=True,capture_output=True,check=True,cwd=profit_root).stdout
 e.sql(db,guarded,label='original-generation-source-producer')
 remainder_fix=next((args.ticket_tree/'supabase/migrations').glob('20261117172824_*.sql'));remember(remainder_fix)
 guarded=subprocess.run(['node','--input-type=module','-e',wrapper,remainder_fix.name],input=remainder_fix.read_text(),text=True,capture_output=True,check=True,cwd=profit_root).stdout
 e.sql(db,guarded,label='satellite-remainder-original-earning-source')
 seed=(root/'scripts/ci/probes/bounty-rebuy-generation-atomicity.sql').read_text().split('SET LOCAL session_replication_role=origin;')[0]
 seed+=(args.ticket_tree/'tests/fixtures/promo-ticket-play-through/generation-public-financial.sql').read_text()
 e.sql(db,seed,label='actual-public-pko-entry-and-source',seconds=60)
 terminal_case=args.ticket_tree/'tests/fixtures/promo-ticket-play-through/generation-terminal-cash-refund.sql';remember(terminal_case)
 e.sql(db,file=terminal_case,label='actual-terminal-principal-cash-refund',seconds=60)
 e.report['native'].append({'case':'actual-terminal-principal-cash-refund-safe-refusal','assertions':10,'limit':'Already funded terminal entry and prior refund liability are explicit openings; original fee/terminal loss and immutable financial refusal are actual. No positive postterminal refund claim.'})
 keeps_case=args.ticket_tree/'tests/fixtures/promo-ticket-play-through/refunded-entry-keeps-promo.sql';remember(keeps_case)
 e.sql(db,"DO $$BEGIN IF position('JOIN public.ca_promo_original_entry_loss_basis fs' IN (SELECT prosrc FROM pg_proc WHERE proname='fn_ca_promo_return_spent_event_fee'))=0 OR position('fn_ca_promo_restore_refunded_entry_cost' IN (SELECT prosrc FROM pg_proc WHERE proname='fn_ca_promo_return_spent_event_fee'))=0 THEN RAISE EXCEPTION 'full-stack spent-fee owner lost its restore route or unified loss basis';END IF;END$$;",label='full-stack-refund-owner-shape')
 e.sql(db,file=keeps_case,label='actual-refunded-entry-keeps-promo-with-the-member',seconds=60)
 e.report['native'].append({'case':'actual-refunded-entry-keeps-promo-with-the-member','assertions':13,'limit':'Already funded REGISTERING entry is an explicit opening; fee consumption, exact refund, restore, replay, journals and deferred guards are actual on the full custody, integrity and profit stack.'})
 e.report['status']='passed';e.report['scope']='Actual public PKO P1 plus W1.5 payout and mystery payouts, fresh reentry/rebuy and exact replay under original financial guards; initial source investment/head/accepted hand are explicit openings.'
finally:
 e.report['source_sha256']={**manifest['source_sha256'],**tested}
 e.report['fixture_limits']=current['limits']+['Initial accepted hand, bought head and entry balances are typed openings. The new public bounty payout and new purchase/journal remain original. Actual original public PKO earning-to-W consumer joined; historical source investment is typed, not a new admission proof.']
 e.report['current_function_pins']=len(current['functions']);e.report['current_financial_triggers']=len(current['triggers'])
 e.close();(out/'RESULTS.json').write_text(json.dumps(e.report,indent=2)+'\\n')
'''
exec(compile(prefix+body,str(source),'exec'),{'__file__':str(source),'__name__':'__main__','proof_runner':own,'proof_migration':migration,'proof_profit_root':options.profit_root.resolve()})
