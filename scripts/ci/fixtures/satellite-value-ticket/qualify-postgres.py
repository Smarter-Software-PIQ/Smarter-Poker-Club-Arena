#!/usr/bin/env python3
"""Real ticket issue assertion, native-asset/split owners and exact admission reader.

All rows are deterministic synthetic fixtures. No production connection or writes.
The unchanged64 source owners are compared as exact pins, not executed here.
"""
import argparse,hashlib,json,os,re,shutil,subprocess,tempfile
from pathlib import Path
ap=argparse.ArgumentParser();ap.add_argument('--pg-bin',type=Path,required=True);ap.add_argument('--scratch',type=Path,required=True);ap.add_argument('--output',type=Path);a=ap.parse_args()
F=Path(__file__).parent;R=F.parents[3];owners=json.loads((F/'actual-owners.json').read_text())['owners'];rows=json.loads((F/'fixture-rows.json').read_text());contract=json.loads((F/'contract.json').read_text())
migration=R/'supabase/migrations/20261109170604_same_value_satellite_ticket_ownership_follows_canonical_admi.sql'
root=Path(tempfile.mkdtemp(prefix='ticket-value-',dir=a.scratch));data=root/'d';started=False
env={k:v for k,v in os.environ.items()if not k.startswith('PG')and k!='DATABASE_URL'};env.update(PGHOST=str(root),PGUSER='postgres',PGDATABASE='postgres',PGSSLMODE='disable',TMPDIR=str(root))
def run(cmd,source=None,error=None):
 p=subprocess.run([str(x)for x in cmd],input=source,text=True,capture_output=True,env=env,timeout=60)
 if error:assert p.returncode and error in p.stderr,(error,p.stdout,p.stderr)
 else:assert p.returncode==0,p.stdout+p.stderr
 return p.stdout.strip()
def q(s,error=None):return run([a.pg_bin/'psql','-XqAt','-v','ON_ERROR_STOP=1'],'SET check_function_bodies=off;'+s,error)
def lit(v):return "'"+str(v).replace("'","''")+"'"
def owner(n):return next(x for x in owners if n+'('in x['signature'])
def h(sig):return q('SELECT md5(pg_get_functiondef('+lit(sig)+'::regprocedure))')
reader='public.fn_union_pnl_satellite_seat_owner(uuid,uuid)';matcher='smarter_private.original_inventory_proof_sources_match()';cases=[]
regs=rows['union_pnl_inventory_events'];tickets=rows['tournament_tickets'];club=rows['clubs'][0]['id'];reg=regs[0]['row_id'];target=regs[0]['after_row']['tournament_id'];instrument=next(t for t in tickets if t['holder_id']==regs[0]['after_row']['user_id']);ticket=instrument['id'];original=instrument['source_tournament_id'];sat=instrument['source_satellite_id']
call='SELECT '+reader.split('(')[0]+'('+lit(reg)+','+lit(target)+')'
touches='WITH touched(registration_id)AS(VALUES '+','.join('('+lit(e['row_id'])+'::uuid)'for e in regs for _ in range(3))+')SELECT count(*)FROM touched WHERE fn_union_pnl_satellite_seat_owner(registration_id,NULL)IS NULL'
try:
 assert '17.'in run([a.pg_bin/'postgres','--version'])
 run([a.pg_bin/'initdb','-D',data,'-U','postgres','--auth-local=trust','--auth-host=reject','--no-locale','-E','UTF8'])
 with(data/'postgresql.conf').open('a')as f:f.write("\nlisten_addresses=''\nunix_socket_directories='"+str(root)+"'\nshared_buffers='16MB'\n")
 run([a.pg_bin/'pg_ctl','-D',data,'-l',root/'server.log','-w','start']);started=True
 q('CREATE SCHEMA smarter_private;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;'+(F/'bootstrap.sql').read_text())
 for table,rs in rows.items():
  q('INSERT INTO '+table+' SELECT * FROM jsonb_populate_recordset(NULL::'+table+','+lit(json.dumps(rs))+'::jsonb)')
 for x in owners:q(x['definition'])
 q('REVOKE ALL ON FUNCTION '+reader+','+matcher+' FROM PUBLIC,anon,authenticated,service_role')
 for t in tickets:assert q('SELECT fn_ca_assert_satellite_value_ticket('+lit(t['id'])+')')=='chips'
 assert q(call)==''
 assert q(call.replace(lit(reg),lit(regs[1]['row_id'])))==''
 assert q(touches)=='6'
 cases.append('before: legitimate alternate-target value entries unresolved')
 # Use the real installer stale-pin wrapper; a retained old hash must abort both owners.
 js="import{stalePinGuardSQL}from './scripts/ci/migration-stale-pins.mjs';import{readFileSync}from'node:fs';let p=process.argv[1],s=readFileSync(p,'utf8');process.stdout.write(stalePinGuardSQL(p,s,s));"
 guarded=run(['node','--input-type=module','-e',js,migration])
 q("CREATE FUNCTION public.fixture_stale_pin()RETURNS text LANGUAGE sql AS $$SELECT '"+owner('fn_union_pnl_satellite_seat_owner')['md5']+"'::text$$")
 q(guarded,'migration_left_a_stale_pin')
 assert h(reader)==owner('fn_union_pnl_satellite_seat_owner')['md5'] and h(matcher)==owner('original_inventory_proof_sources_match')['md5']
 q('DROP FUNCTION public.fixture_stale_pin()')
 before=q("SELECT jsonb_agg(jsonb_build_array(c.relname,(SELECT count(*)FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0))ORDER BY c.relname)FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r'")
 fingerprint=lambda:q('SELECT md5('+ '||'.join('(SELECT coalesce(jsonb_agg(to_jsonb(x))::text,\'[]\')FROM '+t+' x)'for t in sorted(rows))+')')
 preserved=fingerprint();q(guarded)
 assert h(reader)==contract['after']['reader']and h(matcher)==contract['after']['matcher'];assert fingerprint()==preserved
 assert q(call)==club and q(call.replace(lit(target),'NULL::uuid'))==club
 assert q(call.replace(lit(reg),lit(regs[1]['row_id'])))==club
 assert q(touches)=='0'
 assert q(call.replace(lit(target),lit(sat)))==''
 cases.append('after: two real-owner synthetic40 entries, actual26+10+4split, optional/exact target')
 # Current matcher preserves all64 unrelated exact pins and adds every direct helper.
 pins=lambda s:dict(re.findall(r"\('([^']+)','([a-f0-9]{32})'\)",s))
 oldpins=pins(owner('original_inventory_proof_sources_match')['definition']);newpins=pins(q('SELECT pg_get_functiondef('+lit(matcher)+'::regprocedure)'))
 assert len(oldpins)==65 and len(newpins)==68
 assert all(newpins[k]==v for k,v in oldpins.items()if k!=reader)
 assert newpins[reader]==h(reader)
 for sig in newpins.keys()-oldpins.keys():assert newpins[sig]==h(sig)
 cases.append('68 exact source pins:64 unchanged plus corrected reader and3 real helper hashes')
 # The existing generation source hashes include matcher bytes: no old-generation reuse.
 assert hashlib.md5(owner('original_inventory_proof_sources_match')['definition'].encode()).hexdigest()!=h(matcher)
 entitlement=next(e for e in rows['tournament_refund_entitlements']if e['source_ticket_id']==ticket)
 ledger=entitlement['source_ledger_id'];ent=entitlement['id'];user=instrument['holder_id']
 def denied(name,mutation,error=None):
  result=q('BEGIN;'+mutation+';'+call+';ROLLBACK;',error)
  if not error:assert result=='',(name,result)
  assert q(call)==club,name
  cases.append(name)
 for field,value in [('status',"'issued'"),('holder_id',"'00000000-0000-0000-0000-000000000099'"),('redemption_mode',"'cash'"),('redeemed_at',"'2026-10-02Z'")]:
  denied('ticket '+field,'UPDATE tournament_tickets SET '+field+'='+value+' WHERE id='+lit(ticket))
 for field,value in [('status',"'pending'"),('row_hash','NULL'),('to_entity_id',lit(sat)),('club_id',lit(sat)),('created_at',"'2026-10-02Z'"),('idempotency_key',"'wrong-admission'")]:
  denied('admission ledger '+field,'UPDATE chip_ledger SET '+field+'='+value+' WHERE id='+lit(ledger))
 for field,value in [('registration_id',lit(sat)),('user_id',lit(sat)),('evidence_kind',"'legacy'"),('refund_bounty','9'),('source_ledger_id',lit(sat))]:
  denied('entitlement '+field,'UPDATE tournament_refund_entitlements SET '+field+'='+value+' WHERE id='+lit(ent))
 denied('cross-club nonunion target','UPDATE tournaments SET union_id=NULL,club_id='+lit(sat)+' WHERE id='+lit(target))
 denied('wrong immutable registration club',"UPDATE union_pnl_inventory_events SET after_row=jsonb_set(after_row,'{club_id}',to_jsonb("+lit(sat)+"::text))WHERE row_id="+lit(reg))
 denied('different-value target','UPDATE tournaments SET buy_in_amount=37 WHERE id='+lit(target))
 denied('wrong target split','UPDATE tournaments SET bounty_amount=11 WHERE id='+lit(target))
 denied('diamond target','UPDATE clubs SET asset=\'diamonds\',is_platform=true,union_id=NULL;UPDATE tournaments SET union_id=NULL WHERE id='+lit(target))
 denied('missing admission transaction','DELETE FROM chip_transactions WHERE transaction_type=\'tournament_ticket_entry\'AND metadata->>\'ticket_id\'='+lit(ticket))
 denied('duplicate admission transaction','INSERT INTO chip_transactions SELECT * FROM chip_transactions WHERE transaction_type=\'tournament_ticket_entry\'AND metadata->>\'ticket_id\'='+lit(ticket))
 denied('admission holder metadata',"UPDATE chip_transactions SET metadata=jsonb_set(metadata,'{holder_id}',to_jsonb("+lit(sat)+"::text))WHERE transaction_type='tournament_ticket_entry'AND metadata->>'ticket_id'="+lit(ticket))
 denied('missing source funding','DELETE FROM tournament_participant_funding_receipts WHERE user_id='+lit(user))
 denied('wrong source funding asset',"UPDATE tournament_participant_funding_receipts SET asset='diamonds' WHERE user_id="+lit(user))
 denied('missing original backing','DELETE FROM chip_ledger WHERE category=\'ticket_issue\'AND to_entity_id='+lit(ticket),'VALUE_TICKET_CHIP_BACKING_UNPROVEN')
 denied('wrong original payout','UPDATE tournament_payouts SET amount=39 WHERE id='+lit(next(x['payout_id']for x in rows['tournament_satellite_awards']if x['ticket_id']==ticket)),'VALUE_TICKET_ISSUE_IDENTITY_UNPROVEN')
 # Canonical assertion failures remain explicit; malformed unexpected SQL is not swallowed.
 denied('malformed admission split visible','UPDATE chip_ledger SET metadata=jsonb_set(metadata,\'{entry_prize}\',\'"bad"\')WHERE id='+lit(ledger),'invalid input syntax for type numeric')
 # Unmarked legacy target-only tickets and direct seats preserve their original rules.
 legacy="UPDATE tournament_payouts SET metadata=metadata-'ticket_contract';"
 assert q('BEGIN;'+legacy+call+';ROLLBACK;')==''
 for mode in ['ticket','seat']:
  change=legacy+"UPDATE union_pnl_inventory_events SET after_row=jsonb_set(after_row,'{tournament_id}',to_jsonb("+lit(original)+"::text))WHERE row_id="+lit(reg)+';'
  if mode=='seat':change+='UPDATE tournament_satellite_awards SET delivery_kind=\'seat\',registration_id='+lit(reg)+' WHERE ticket_id='+lit(ticket)+';'
  assert q('BEGIN;'+change+call.replace(lit(target),lit(original))+';ROLLBACK;')==club
  cases.append('strict legacy '+mode+' valid original-target only')
 for role in ['anon','authenticated','service_role']:q('SET ROLE '+role+';'+call,'permission denied')
 q(guarded,'satellite_value_ticket_preimage_changed')
 assert fingerprint()==preserved
 output={'passed':True,'cases':cases,'migration_sha256':hashlib.sha256(migration.read_bytes()).hexdigest(),'hashes':contract['after'],'actual_issue_assertion_asset_and_split':True,'metadata_ACL_preserved_by_installer':True,'stale_pin_atomic_refusal':True,'replay_refused':True,'all_fixture_money_rows_unchanged':True,'limits':'Real unchanged canonical source owners with deterministic synthetic financial rows; all64 unrelated source pins preserved byte-exact, not a full-week execution or real payment.'}
 if a.output:a.output.write_text(json.dumps(output,indent=2)+'\n')
 print(json.dumps(output))
finally:
 if started:run([a.pg_bin/'pg_ctl','-D',data,'-m','fast','-w','stop'])
 shutil.rmtree(root)
