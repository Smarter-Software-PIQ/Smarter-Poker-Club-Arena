#!/usr/bin/env python3
"""Real original journal/guard movement proof, reusing the return foundation.
Only pre-existing earning/hold openings are typed. The actual W constructor tags
those accounted chips; every tested money movement uses an original money owner.
No replacement ledger/tally function or notification/constructor sink.
"""
from pathlib import Path
FIRST=Path(__file__).resolve().parents[2]
BOOTSTRAP_PATH=FIRST/'scripts/ci/test-promo-principal-returns.py'
BOOTSTRAP_SOURCE=BOOTSTRAP_PATH.read_text()
prefix=BOOTSTRAP_SOURCE[:BOOTSTRAP_SOURCE.index(' # A cloned original financial closure')]
prefix=prefix.replace('root=Path(__file__).resolve().parents[2]', 'root=Path('+repr(str(FIRST))+')')
prefix=prefix.replace('args=p.parse_args();', "p.add_argument('--w-source',type=Path,default=root/'supabase/migrations/20261116190221_promo_winnings_retain_original_source_until_two_times_paid_f.sql');args=p.parse_args();")
body=r'''
 (out/'return-bootstrap.py').write_text(BOOTSTRAP_SOURCE);remember(out/'return-bootstrap.py')
 def sql(q,label):return e.sql(db,q,label=label)
 def capture_functions(path):
  remember(path)
  sql('SET check_function_bodies=off;',path.stem+'-forward-source-import')
  for row in json.loads(path.read_text()):
   definition=row['definition'];signature=row['signature']
   sql('SET check_function_bodies=off;'+definition+';REVOKE ALL ON FUNCTION public.'+signature+' FROM PUBLIC,anon,authenticated,service_role;',label='actual-'+signature.split('(')[0])
   for grant in (row['acl'] or '').strip('{}').split(','):
    if not grant:continue
    role,rights=grant.split('=',1)
    if rights!='X/postgres':raise RuntimeError('unexpected source ACL '+signature)
    sql('GRANT EXECUTE ON FUNCTION public.'+signature+' TO '+(role or 'PUBLIC')+';',label='acl-'+signature.split('(')[0])
   _,value,_=sql("SELECT md5(pg_get_functiondef('public."+signature+"'::regprocedure))",label='pin-'+signature.split('(')[0])
   if value.strip()!=row['md5']:raise RuntimeError('actual original cash source differs '+signature)
  sql('SET check_function_bodies=on;',path.stem+'-forward-source-import-end')
 felt_mode=root/'tests/fixtures/promo-profit-movements/felt-accounting-mode.json';remember(felt_mode)
 for key,table in [('coverage','ca_chip_store_coverage'),('store_modes','ca_ledger_invariant_store_mode')]:
  rows=json.loads(felt_mode.read_text())[key];cols=list(rows[0]);updates=','.join(c+'=EXCLUDED.'+c for c in cols if c!='store')
  sql('INSERT INTO public.'+table+'('+','.join(cols)+') SELECT '+','.join(cols)+" FROM jsonb_populate_recordset(NULL::public."+table+",'"+json.dumps(rows).replace("'","''")+"'::jsonb) ON CONFLICT(store) DO UPDATE SET "+updates,'actual-captured-felt-'+key)
 relations=root/'tests/fixtures/promo-profit-movements/money-relations.json';remember(relations)
 blacklist=root/'tests/fixtures/promo-profit-movements/blacklist-relation.json';remember(blacklist)
 relation_rows=json.loads(relations.read_text())+json.loads(blacklist.read_text())
 for row in relation_rows:
  name=row['name'];_,exists,_=sql("SELECT to_regclass('public."+name+"') IS NOT NULL",'relation-'+name)
  if exists.strip()=='f':
   sql(table_sql({**row,'constraints':[c for c in row.get('constraints') or [] if c['validated'] and c['type']!='t'],'grants':[],'policies':[]}),label='exact-relation-'+name)
   for c in row.get('constraints') or []:
    if not c['validated']:
     if c['type']!='c' or not c['definition'].endswith(' NOT VALID'):raise RuntimeError('uncaptured unvalidated shape '+name)
     sql('ALTER TABLE public.\"'+name+'\" ADD CONSTRAINT \"'+c['name']+'\" '+c['definition']+';',label='actual-unvalidated-'+name)
  else:
   _,columns,_=sql("SELECT string_agg(attname,',') FROM pg_attribute WHERE attrelid='public."+name+"'::regclass AND attnum>0 AND NOT attisdropped",'columns-'+name)
   have=set(columns.strip().split(','))
   for col in row['columns']:
    if col['name'] in have:continue
    if col['generated'] or col['identity']:raise RuntimeError('uncaptured generated compatibility '+name)
    definition='"'+col['name']+'" '+col['type']+(' DEFAULT '+col['default'] if col['default'] is not None else '')+(' NOT NULL' if col['notnull'] else '')
    sql('ALTER TABLE public."'+name+'" ADD COLUMN '+definition+';',label='actual-column-'+name+'-'+col['name'])
  # Only absent non-FK source constraints/indexes are installed. These are
  # actual empty receipt/session catalogs, never financial writer substitutes.
  for constraint in row.get('constraints') or []:
   if constraint['type'] in('f','t'):continue
   _,found,_=sql("SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public."+name+"'::regclass AND conname='"+constraint['name']+"')",'constraint-'+name)
   if found.strip()=='f':sql('ALTER TABLE public."'+name+'" ADD CONSTRAINT "'+constraint['name']+'" '+constraint['definition']+';',label='actual-constraint-'+name)
  for index in row.get('indexes') or []:
   if index['constraint']:continue
   import re
   index_name=re.search(r'INDEX\s+(?:public\.)?([^ ]+)',index['definition']).group(1)
   _,found,_=sql("SELECT to_regclass('public."+index_name+"') IS NOT NULL",'index-'+name)
   if found.strip()=='f':sql(index['definition']+';',label='actual-index-'+name)
 for row in relation_rows:
  for constraint in row.get('constraints') or []:
   if constraint['type']!='f':continue
   _,found,_=sql("SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public."+row['name']+"'::regclass AND conname='"+constraint['name']+"')",'source-FK-'+row['name'])
   if found.strip()=='f':sql('ALTER TABLE public."'+row['name']+'" ADD CONSTRAINT "'+constraint['name']+'" '+constraint['definition']+';',label='actual-FK-'+row['name'])
 game_columns=root/'tests/fixtures/promo-profit-movements/game-columns.json';remember(game_columns)
 needed={'cash_games':{'cluster_mode','handedness','must_move','template_name','ruleset_snapshot'},'tables':{'is_template','is_vip_only','nit_game','career_percent_min','maintain_hands','role','lifecycle','is_deleted','cluster_id'}}
 for row in json.loads(game_columns.read_text()):
  _,columns,_=sql("SELECT string_agg(attname,',') FROM pg_attribute WHERE attrelid='public."+row['name']+"'::regclass AND attnum>0 AND NOT attisdropped",'game-columns-'+row['name']);have=set(columns.strip().split(','))
  for col in row['columns']:
   if col['name'] in have or col['name'] not in needed[row['name']]:continue
   definition='"'+col['name']+'" '+col['type']+(' DEFAULT '+col['default'] if col['default'] is not None else '')+(' NOT NULL' if col['notnull'] else '')
   sql('ALTER TABLE public."'+row['name']+'" ADD COLUMN '+definition+';',label='actual-game-column-'+col['name'])
 for name in ['money-owners','money-dependencies','admission-dependencies','game-rule-dependency']:
  capture_functions(root/('tests/fixtures/promo-profit-movements/'+name+'.json'))
 pending_triggers=root/'tests/fixtures/promo-profit-movements/pending-triggers.json';remember(pending_triggers)
 seat_triggers=root/'tests/fixtures/promo-profit-movements/seat-triggers.json';remember(seat_triggers)
 for row in json.loads(pending_triggers.read_text())+json.loads(seat_triggers.read_text()):
  if row['enabled']!='O':continue # Existing financial origin-guard closure; no replica opening policy claim.
  _,value,_=sql("SELECT md5(pg_get_functiondef('public."+row['signature']+"'::regprocedure))",'actual-pending-guard-source')
  if value.strip()!=row['function_md5']:raise RuntimeError('actual pending financial guard differs')
  sql('DROP TRIGGER IF EXISTS "'+row['name']+'" ON public.'+row['table_name']+';'+row['definition']+';',label='actual-pending-'+row['name'])
 # Cold source helpers needed by H and actual W shared fee reader. The source
 # qualification retains the same actual owner bytes as the accepted-hand lane.
 sql("ALTER TABLE public.accounting_tournament_fee_sources ADD COLUMN IF NOT EXISTS source_charge_ledger_id uuid,ADD COLUMN IF NOT EXISTS source_entitlement_id uuid;",'exact-current-fee-source-columns')
 fee=root/'supabase/migrations/20261116154831_promo_funded_fees_keep_gross_rake_but_earn_no_commission_or_.sql';remember(fee)
 sql(fee.read_text().split('DO $owners$')[0]+'COMMIT;','actual-eligible-fee-helpers')
 ticket_source=(args.ticket_tree/'supabase/migrations/20261116154719_promo_tickets_require_cashable_wallets_and_keep_entry_source.sql').read_text()
 for start,end in [('CREATE FUNCTION public.fn_ca_promo_finish_event_principal()','-- The ordinary debit already owns'),('CREATE FUNCTION public.fn_ca_promo_roll_event_principal(','-- One original money owner, explicit source')]:
  sql(ticket_source[ticket_source.index(start):ticket_source.index(end)],'actual-H-event-prerequisite')
 ticket_capture=args.ticket_tree/'tests/fixtures/promo-ticket-play-through/additional-owners.json';remember(ticket_capture)
 for row in json.loads(ticket_capture.read_text()):
  if row['signature'].startswith('fn_issue_tournament_ticket_phase2_core_20260831('):sql(row['definition']+';','actual-original-ticket-core')
 start=ticket_source.index('-- One original money owner, explicit source')
 end=ticket_source.index('CREATE OR REPLACE FUNCTION public.fn_issue_tournament_ticket_phase2_core_20260831(',start)
 sql(ticket_source[start:end],'actual-cashable-ticket-owner')
 integrity=root/'supabase/migrations/20261116161707_suspect_promo_chip_dumping_holds_only_attributable_incoming_.sql';remember(integrity)
 import subprocess
 wrapper="import{stalePinGuardSQL}from'./scripts/ci/migration-stale-pins.mjs';let s='';for await(const b of process.stdin)s+=b;process.stdout.write(stalePinGuardSQL(process.argv[1],s,s));"
 guarded=subprocess.run(['node','--input-type=module','-e',wrapper,integrity.name],input=integrity.read_text(),text=True,capture_output=True,check=True,cwd=root).stdout
 sql(guarded,'actual-real-applier-H-source')
 if args.w_source is None:raise RuntimeError('explicit frozen composed W source required')
 source=args.w_source.read_text();snapshot=out/'w-source.sql';snapshot.write_text(source);remember(snapshot)
 core=source.split('-- BEGIN ORIGINAL BBJ WINNINGS SOURCE')[0]
 movement_start=source.index('-- BEGIN ORIGINAL WINNINGS MOVEMENT SOURCE');registration=source.rfind('INSERT INTO public.ca_money_rpc_registry',0,movement_start)
 if registration<0 or 'fn_ca_promo_profit_snapshot_funding' not in source[registration:movement_start]:raise RuntimeError('actual movement registry prerequisite missing')
 movement=source[registration:source.index('-- END ORIGINAL WINNINGS MOVEMENT SOURCE')]
 start=source.index('CREATE FUNCTION public.fn_ca_promo_profit_record_event(p_ledger uuid)');end=source.index(';',source.index('REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_record_event(uuid)',start))+1
 event=source[start:end];selected=core+movement+event+'COMMIT;'
 e.report['selected_W_components']={k:hashlib.sha256(v.encode()).hexdigest() for k,v in [('core',core),('movement',movement),('event_consumer',event)]}
 (out/'selected-W-source.sql').write_text(selected)
 guarded=subprocess.run(['node','--input-type=module','-e',wrapper,args.w_source.name],input=selected,text=True,capture_output=True,check=True,cwd=root).stdout
 sql(guarded,'actual-real-applier-W-source')
 fixture=root/'tests/fixtures/promo-profit-movements/movements.sql';remember(fixture)
 e.sql(db,file=fixture,label='actual-original-W-money-movements',seconds=120)
 e.report['status']='passed';e.report['native'].append({'case':'actual-original-W-money-movements','flows':3,'assertions':sum(1 for line in fixture.read_text().splitlines() if line.lstrip().startswith('IF '))})
 e.report['qualification_limits']=['Pre-existing accounted original earning and review-case opening are typed; actual W constructor and original disbursement/movement owners execute. This proves money movement and custody, not earning/case producers. Selected W core, composed movement registration/block and actual event consumer are qualified; BBJ/nonwallet source blocks and notice delivery are separate. Existing controlled native replica structural opening is not production admin-write policy qualification.']
 e.report['source_sha256']={**manifest['source_sha256'],**tested}
 e.report['current_function_pins']=len(current['functions']);e.report['current_financial_triggers']=len(current['triggers'])
finally:
 e.close();(out/'RESULTS.json').write_text(json.dumps(e.report,indent=2)+'\n')
'''
exec(compile(prefix+body,__file__,'exec'))
