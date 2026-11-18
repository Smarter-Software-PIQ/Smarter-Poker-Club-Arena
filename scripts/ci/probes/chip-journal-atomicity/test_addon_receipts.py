"""Add-on receipts: one debit, one landing and one original receipt per key.

The cash add-on door the engine calls for a player and for the Horse session
rotator is public.atomic_table_addon. Its duplicate-request guarantee comes
from the shared purchase receipt and its money from the real add-on core, so
this case runs both as written in migration history: the identical request
again (a lost reply), the receipt answering after the seat or wallet moved on,
the original key refused for another amount, table or landing, a later key
bounded by the table maximum, whole-or-nothing failure, and two real sessions
contending on one key.

Same route as test_rebuy_receipts.py. The base fixture's two-line add-on stub
is replaced by the real core for this case only.
"""
import os,re,json,subprocess
from pathlib import Path


def verify_addon_receipts(run):
 here=Path(__file__).resolve().parent;root=here.parents[3]
 def latest(name):
  result=None
  for p in sorted((root/"supabase/migrations").glob("*.sql")):
   if p.name<"20260908024909":continue
   s=p.read_text()
   for m in re.finditer(r"CREATE OR REPLACE FUNCTION public\."+name+r"\s*\(",s,re.I):
    t=s[m.start():];b=re.search(r"\bAS\s+(\$[A-Za-z0-9_]*\$)",t,re.I);e=t.find(b.group(1),b.end());result=t[:e+len(b.group(1))]+";"
  if not result:raise RuntimeError("No function: "+name)
  return result
 original=os.environ.get("PGDATABASE","postgres")
 run("CREATE DATABASE addon_receipt_probe");os.environ["PGDATABASE"]="addon_receipt_probe"
 try:
  parser={"__name__":"addon_receipt_parser"}
  source=here/"test_atomicity.py"
  exec(compile(source.read_text().split("\npg=os.environ",1)[0],str(source),"exec"),parser)
  # The rebuy fixture already owns the shared purchase-receipt helpers and the
  # member journal trigger. The add-on door adds only its historical key table.
  # The shared base fixture stubs the add-on core to its two balance moves. This
  # case owns the real body, wallet journal and funding receipt, so the stub goes.
  base,removed=re.subn(r"CREATE OR REPLACE FUNCTION atomic_table_addon_before_maintenance_announcement_gate\(.*?\$\$;","",(here/"fixture.sql").read_text(),flags=re.S)
  if removed!=1:raise RuntimeError("The base fixture no longer carries exactly one add-on stub")
  fixture=base+latest("fn_club_members_ledger_writer")+(here/"rebuy-receipt-fixture.sql").read_text()+"CREATE TABLE table_addon_idempotency(key text PRIMARY KEY,user_id uuid,table_id uuid,amount numeric,applied_to_seat boolean);\n"+parser["original_cash_funding_tables"](root)
  definitions=parser["authoritative_function_closure"](root,fixture,{"atomic_table_addon_before_maintenance_announcement_gate"})
  schema="\n".join(body for _,body in definitions)+latest("atomic_table_addon")
  run(fixture+schema)
  C="b0000000-0000-4000-8000-000000000001";I="b0000000-0000-4000-8000-000000000002";T="b0000000-0000-4000-8000-000000000003";U="b0000000-0000-4000-8000-000000000004"
  # One member with 100 chips seated with 5 at two tables of one club; table maximum 20.
  seed=f"INSERT INTO clubs(id) VALUES('{C}');INSERT INTO club_members(id,user_id,club_id) VALUES('{I}','{I}','{C}');INSERT INTO tables(id,club_id,max_buy_in) VALUES('{T}','{C}',20),('{U}','{C}',20);INSERT INTO table_seats(table_id,user_id,club_id,seat_number,stack) VALUES('{T}','{I}','{C}',1,5),('{U}','{I}','{C}',1,5);SELECT set_config('test.actor','{I}',true);"
  call=lambda table=T,amount="5",direct="true",key="original":f"atomic_table_addon('{I}','{table}',{amount},{direct},'{key}')"
  names=["club_members","table_seats","table_addon_idempotency","table_pending_addons","wallet_transactions","chip_ledger","entry_purchase_idempotency_receipts","cash_participant_funding_receipts"]
  state="jsonb_build_array("+",".join(f"(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM {n} t)" for n in names)+")"
  once=f"(SELECT chip_balance FROM club_members)=95 AND (SELECT count(*) FROM wallet_transactions)=1 AND (SELECT count(*) FROM chip_ledger)=1 AND (SELECT count(*) FROM entry_purchase_idempotency_receipts WHERE key_domain='cash_addon')=1 AND (SELECT count(*) FROM table_addon_idempotency)=1 AND (SELECT count(*) FROM cash_participant_funding_receipts WHERE operation_kind='addon' AND operation_key='original' AND funding_club_id='{C}' AND amount=5 AND balance_before=100 AND balance_after=95)=1"
  landed=lambda direct:f"(SELECT stack FROM table_seats WHERE table_id='{T}')={'10' if direct=='true' else '5'} AND (SELECT stack FROM table_seats WHERE table_id='{U}')=5 AND (SELECT count(*) FROM table_pending_addons)={'0' if direct=='true' else '1'}"
  count=0
  for direct in ["true","false"]:
   # One original purchase, then the identical request again after its reply was lost.
   run("BEGIN;"+seed+f"""DO $t$ DECLARE r numeric;s jsonb;BEGIN r:={call(direct=direct)};
    IF r<>95 OR NOT ({once}) OR NOT ({landed(direct)}) THEN RAISE EXCEPTION 'Incorrect add-on transaction';END IF;
    SELECT {state} INTO s;r:={call(direct=direct)};
    IF r<>95 OR s IS DISTINCT FROM {state} THEN RAISE EXCEPTION 'Add-on replay changed state';END IF;
    END $t$;ROLLBACK;""");count+=2
   # The replay answers from the original receipt, never from whatever the seat or wallet holds now.
   for mutation in [f"UPDATE table_seats SET stack=1 WHERE table_id='{T}';",f"UPDATE table_seats SET left_at=now() WHERE table_id='{T}';",f"UPDATE club_members SET chip_balance=40 WHERE user_id='{I}';"]:
    run("BEGIN;"+seed+f"SELECT {call(direct=direct)};"+mutation+f"""DO $t$ DECLARE r numeric;s jsonb;BEGIN SELECT {state} INTO s;r:={call(direct=direct)};
     IF r<>95 OR s IS DISTINCT FROM {state} THEN RAISE EXCEPTION 'Receipt was replaced by current state';END IF;END $t$;ROLLBACK;""");count+=1
  # The original key is bound to its exact request: another amount, table or landing is refused whole.
  for request in [call(amount="6"),call(U),call(direct="false")]:
   run("BEGIN;"+seed+f"SELECT {call()};"+f"""DO $t$ DECLARE s jsonb;caught boolean:=false;BEGIN SELECT {state} INTO s;
    BEGIN PERFORM {request};EXCEPTION WHEN SQLSTATE '22023' THEN caught:=true;END;
    IF NOT caught OR s IS DISTINCT FROM {state} THEN RAISE EXCEPTION 'Changed add-on admitted under the original key';END IF;
    END $t$;ROLLBACK;""");count+=1
  # A LATER request under a new key is a new purchase (the Horse rotator mints one per
  # invocation). After the original landed, the table maximum admits only what room is left.
  run("BEGIN;"+seed+f"SELECT {call(amount='15')};"+f"""DO $t$ DECLARE s jsonb;caught boolean:=false;BEGIN SELECT {state} INTO s;
   BEGIN PERFORM {call(amount='15',key='later')};EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE 'BUYIN_ABOVE_MAX%';END;
   IF NOT caught OR s IS DISTINCT FROM {state} OR (SELECT chip_balance FROM club_members)<>85 OR (SELECT stack FROM table_seats WHERE table_id='{T}')<>20
    THEN RAISE EXCEPTION 'A later key bought past the table maximum';END IF;
   END $t$;ROLLBACK;""");count+=1
  for table in ["club_members","chip_ledger","table_pending_addons","wallet_transactions","entry_purchase_idempotency_receipts","cash_participant_funding_receipts"]:
   run("BEGIN;"+seed+f"""CREATE FUNCTION addon_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN {'IF TG_OP=\'INSERT\' THEN RETURN NEW;END IF;' if table=='entry_purchase_idempotency_receipts' else ''} RAISE EXCEPTION 'injected failure' USING ERRCODE='XX001';END $f$;
    CREATE TRIGGER addon_fault BEFORE INSERT OR UPDATE ON {table} FOR EACH ROW EXECUTE FUNCTION addon_fault();
    DO $t$ DECLARE s jsonb;caught boolean:=false;BEGIN SELECT {state} INTO s;
     BEGIN PERFORM {call(direct='false')};EXCEPTION WHEN SQLSTATE 'XX001' THEN caught:=true;END;
     IF NOT caught OR s IS DISTINCT FROM {state} THEN RAISE EXCEPTION 'Partial add-on';END IF;
    END $t$;ROLLBACK;""");count+=1
  # Two real sessions: the second contends on the original key before the first commits.
  # Each committed case ends by dropping the schema, so every case after the first reloads it.
  for index,(name,second,direct,conflict) in enumerate([("direct replay",call(),"true",False),("queued replay",call(direct="false"),"false",False),("amount conflict",call(amount="6"),"true",True)]):
   if index: run(fixture.replace("CREATE SCHEMA auth;","").replace("CREATE FUNCTION auth.uid()","CREATE OR REPLACE FUNCTION auth.uid()")+schema)
   params=dict(name="add-on purchase "+name,setup=seed,actor=f"SELECT set_config('test.actor','{I}',true);",first=call(direct=direct),second=second,numericReceipt=True,
    verify=f"DO $t$ BEGIN IF NOT ({once}) OR NOT ({landed(direct)}) THEN RAISE EXCEPTION 'Concurrent add-on changed state';END IF;END $t$;",
    cleanup="DROP SCHEMA public CASCADE;DROP SCHEMA IF EXISTS smarter_private CASCADE;CREATE SCHEMA public;")
   if conflict:params["conflict"]=True
   r=subprocess.run([os.environ["PGNODE"],str(here/"test_transaction_concurrency.mjs")],input=json.dumps(params),text=True,capture_output=True)
   if r.returncode:raise RuntimeError(r.stderr)
   print(r.stdout.strip(),flush=True);count+=1
  print(f"TOTAL add-on purchase receipts: {count} passing cases",flush=True)
 finally:
  os.environ["PGDATABASE"]=original;run("DROP DATABASE addon_receipt_probe")


if __name__=="__main__":
 here=Path(__file__).resolve().parent
 def run(sql,database=None):
  env=dict(os.environ,PGDATABASE=database) if database else None
  r=subprocess.run([os.environ['PGNODE'],str(here/'postgres-runtime/query.mjs')],input=sql,text=True,capture_output=True,env=env)
  if r.returncode: raise RuntimeError(r.stderr)
  return r.stdout
 verify_addon_receipts(run)
