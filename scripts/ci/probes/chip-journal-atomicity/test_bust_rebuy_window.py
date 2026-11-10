"""A busted cash seat: the wallet the engine reads is the wallet the rebuy debits,
a rebuy after the seat is released is refused, and a rebuy that raced the
release is returned whole, exactly once (Dan 2026-11-09, bust rebuy window).

Same route as test_rebuy_receipts.py: the real atomic_table_rebuy and
resolve_pending_addon closures from migration history, on the journal fixture,
every case in one transaction that rolls back. The engine's own reads are the
PostgREST queries pinned by aBustedCashSeatGetsTwentySecondsOrNone.law.test.ts;
the SQL below is those queries.
"""
import os,re
from pathlib import Path


def verify_bust_rebuy_window(run):
 here=Path(__file__).resolve().parent;root=here.parents[3]
 def latest(name):
  result=None
  for p in sorted((root/"supabase/migrations").glob("*.sql")):
   s=p.read_text()
   for m in re.finditer(r"CREATE OR REPLACE FUNCTION public\."+name+r"\s*\(",s,re.I):
    t=s[m.start():];b=re.search(r"\bAS\s+(\$[A-Za-z0-9_]*\$)",t,re.I);e=t.find(b.group(1),b.end());result=t[:e+len(b.group(1))]+";"
  if not result:raise RuntimeError("No function: "+name)
  return result
 original=os.environ.get("PGDATABASE","postgres")
 run("CREATE DATABASE bust_rebuy_window_probe");os.environ["PGDATABASE"]="bust_rebuy_window_probe"
 try:
  parser={"__name__":"bust_rebuy_window_parser"}
  source=here/"test_atomicity.py"
  exec(compile(source.read_text().split("\npg=os.environ",1)[0],str(source),"exec"),parser)
  # The live table carries the resolution columns resolve_pending_addon writes.
  pending=("ALTER TABLE table_pending_addons ADD COLUMN created_at timestamptz NOT NULL DEFAULT clock_timestamp(),ADD COLUMN resolved_at timestamptz,ADD COLUMN applied_to_stack numeric,ADD COLUMN refunded numeric;\n"
   # The refund's real wallet credit (atomic_credit_wallet_and_log) runs as
   # written. Its tournament-table branch and its no-seat-club fallback are not
   # reached by a cash refund at a seat that names its club; they are stubs.
   "ALTER TABLE chip_transactions ADD COLUMN IF NOT EXISTS table_id uuid,ADD COLUMN IF NOT EXISTS metadata jsonb;\n"
   "CREATE TABLE IF NOT EXISTS wallet_credit_idempotency(key text PRIMARY KEY,user_id uuid,amount numeric,created_at timestamptz DEFAULT now());\n"
   # The add-on funding application receipt is out of this proof's scope, as in
   # test_deferred_settlement.py; the chips are counted in the wallet itself.
   "CREATE FUNCTION fn_cash_record_funding_application(uuid,numeric,numeric,uuid) RETURNS void LANGUAGE sql AS $$SELECT$$;\n"
   "CREATE FUNCTION fn_ca_raise_drift_incident() RETURNS void LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'not reached by a cash refund';END$$;\n"
   "CREATE FUNCTION fn_player_home_club(uuid,uuid) RETURNS uuid LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'not reached: the seat names its club';END$$;\n")
  fixture=((here/"fixture.sql").read_text()+latest("fn_club_members_ledger_writer")+(here/"rebuy-receipt-fixture.sql").read_text()
   +parser["original_cash_funding_tables"](root)+pending)
  definitions=parser["authoritative_function_closure"](root,fixture,{"atomic_table_rebuy_before_maintenance_announcement_gate","resolve_pending_addon","atomic_credit_wallet_and_log"})
  schema="\n".join(body for _,body in definitions)+latest("atomic_table_rebuy")
  run(fixture+schema)

  N="b0000000-0000-4000-8000-000000000001"  # the table's club: a union host row, no member wallet
  C="b0000000-0000-4000-8000-000000000002"  # the club the seat was bought from
  I="b0000000-0000-4000-8000-000000000003"
  T="b0000000-0000-4000-8000-000000000004"
  K="b0000000-0000-4000-8000-000000000005"
  # Fixture prices: big blind 0.10, so the rebuy minimum is greatest(min_buy_in, 4).
  seed=(f"INSERT INTO clubs(id) VALUES('{N}'),('{C}');"
   f"INSERT INTO club_members(id,user_id,club_id,chip_balance) VALUES('{I}','{I}','{C}',100);"
   f"INSERT INTO tables(id,club_id) VALUES('{T}','{N}');"
   f"INSERT INTO table_seats(table_id,user_id,club_id,seat_number,stack) VALUES('{T}','{I}','{C}',1,0);"
   f"SELECT set_config('test.actor','{I}',true);")
  rebuy=lambda amount="5",key=K:f"atomic_table_rebuy('{I}','{T}',{amount},'{key}')"
  # readSeatWalletBalances: the seat's club, then that club's member row.
  engine_read=(f"(SELECT m.chip_balance FROM table_seats s JOIN club_members m ON m.club_id=s.club_id AND m.user_id=s.user_id"
   f" WHERE s.table_id='{T}' AND s.user_id='{I}' AND s.left_at IS NULL)")
  # The read it replaced: the table's club.
  old_read=f"(SELECT m.chip_balance FROM club_members m WHERE m.club_id='{N}' AND m.user_id='{I}')"
  # The engine's release: the seat row is vacated by the cash-out.
  vacate=f"UPDATE table_seats SET left_at=clock_timestamp() WHERE table_id='{T}' AND user_id='{I}';"
  count=0

  # 1. The wallet the engine judges is the wallet the purchase debits, at a union table.
  run("BEGIN;"+seed+f"""DO $t$ DECLARE before numeric;after numeric;BEGIN
   before:={engine_read};
   IF before IS DISTINCT FROM 100 OR {old_read} IS NOT NULL THEN RAISE EXCEPTION 'engine read % / table-club read %',before,{old_read};END IF;
   PERFORM {rebuy()};
   after:=(SELECT chip_balance FROM club_members WHERE club_id='{C}' AND user_id='{I}');
   IF after<>95 OR (SELECT count(*) FROM club_members WHERE club_id='{N}')<>0 THEN RAISE EXCEPTION 'debited the wrong wallet';END IF;
   IF {engine_read}<>after THEN RAISE EXCEPTION 'engine read and debited wallet disagree';END IF;
  END $t$;ROLLBACK;""");count+=1
  print("PASS union table: the engine reads the seat club wallet the rebuy debits; the table club has none",flush=True)

  # 2. The minimum the engine judges against is the one the purchase enforces.
  #    min_buy_in 2 would hold a wallet of 3; the purchase needs greatest(2, 4) = 4.
  run("BEGIN;"+seed+f"""UPDATE tables SET min_buy_in=2 WHERE id='{T}';UPDATE club_members SET chip_balance=3;
  DO $t$ DECLARE s jsonb;caught int:=0;BEGIN
   s:=(SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(m)) FROM club_members m),(SELECT count(*) FROM table_pending_addons)));
   BEGIN PERFORM {rebuy("3")};EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'BUYIN_BELOW_MINIMUM%' THEN caught:=caught+1;END IF;END;
   BEGIN PERFORM {rebuy("4","b0000000-0000-4000-8000-000000000006")};EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'Insufficient club chips%' THEN caught:=caught+1;END IF;END;
   IF caught<>2 OR s IS DISTINCT FROM jsonb_build_array((SELECT jsonb_agg(to_jsonb(m)) FROM club_members m),(SELECT count(*) FROM table_pending_addons))
    THEN RAISE EXCEPTION 'a wallet under greatest(min_buy_in, 40BB) was able to rebuy (% refusals)',caught;END IF;
   IF (SELECT greatest(coalesce(min_buy_in,0),coalesce(big_blind,0)*40) FROM tables WHERE id='{T}')<>4 THEN RAISE EXCEPTION 'fixture minimum moved';END IF;
  END $t$;ROLLBACK;""");count+=1
  print("PASS the rebuy minimum is greatest(min_buy_in, 40BB): a wallet of 3 cannot rebuy at min_buy_in 2",flush=True)

  # 3. After the window the seat is released, and a rebuy is refused with nothing moved.
  run("BEGIN;"+seed+vacate+f"""DO $t$ DECLARE caught boolean:=false;BEGIN
   BEGIN PERFORM {rebuy()};EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE 'Player not seated%';END;
   IF NOT caught OR (SELECT chip_balance FROM club_members)<>100 OR (SELECT count(*) FROM table_pending_addons)<>0
    OR (SELECT count(*) FROM entry_purchase_idempotency_receipts)<>0 THEN RAISE EXCEPTION 'a released seat bought chips';END IF;
  END $t$;ROLLBACK;""");count+=1
  print("PASS a rebuy after release is refused: no debit, no row, no receipt",flush=True)

  # 4. A rebuy that commits before the release: the vacated seat returns it whole, once.
  run("BEGIN;"+seed+f"SELECT {rebuy()};"+vacate+f"""DO $t$ DECLARE r record;again record;BEGIN
   IF (SELECT chip_balance FROM club_members)<>95 THEN RAISE EXCEPTION 'rebuy did not debit';END IF;
   SELECT * INTO r FROM resolve_pending_addon((SELECT id FROM table_pending_addons),NULL);
   IF r.applied<>0 OR r.refunded<>5 OR (SELECT chip_balance FROM club_members)<>100 THEN RAISE EXCEPTION 'race refund % / %',r.applied,r.refunded;END IF;
   SELECT * INTO again FROM resolve_pending_addon((SELECT id FROM table_pending_addons),NULL);
   IF again.was_resolved OR (SELECT chip_balance FROM club_members)<>100 OR (SELECT sum(stack) FROM table_seats)<>0
    OR (SELECT count(*) FROM wallet_credit_idempotency WHERE key='addon_refund:'||(SELECT id FROM table_pending_addons))<>1
    OR (SELECT count(*) FROM chip_transactions WHERE club_id='{C}' AND transaction_type='addon_refund')<>1
    THEN RAISE EXCEPTION 'race refund was not exactly once into the seat club';END IF;
   IF {rebuy()}<>95 OR (SELECT count(*) FROM table_pending_addons)<>1 THEN RAISE EXCEPTION 'the purchase replay bought again';END IF;
  END $t$;ROLLBACK;""");count+=1
  print("PASS a rebuy racing the release is refunded whole once; resolving again and replaying the key move nothing",flush=True)

  # 5. A rebuy paid in time on a live seat is delivered once and the chips are on the felt.
  run("BEGIN;"+seed+f"SELECT {rebuy()};"+f"""DO $t$ DECLARE r record;again record;BEGIN
   SELECT * INTO r FROM resolve_pending_addon((SELECT id FROM table_pending_addons),NULL);
   IF r.applied<>5 OR r.refunded<>0 OR (SELECT stack FROM table_seats)<>5 OR (SELECT chip_balance FROM club_members)<>95
    THEN RAISE EXCEPTION 'in-time rebuy % / %',r.applied,r.refunded;END IF;
   SELECT * INTO again FROM resolve_pending_addon((SELECT id FROM table_pending_addons),NULL);
   IF again.was_resolved OR (SELECT stack FROM table_seats)<>5 OR (SELECT chip_balance FROM club_members)<>95
    THEN RAISE EXCEPTION 'in-time rebuy delivered twice';END IF;
   IF {rebuy()}<>95 OR (SELECT stack FROM table_seats)<>5 THEN RAISE EXCEPTION 'duplicate request changed the seat';END IF;
  END $t$;ROLLBACK;""");count+=1
  print("PASS an in-time rebuy is charged once and its chips reach the seat once; a duplicate request replays",flush=True)

  # 6. A seat with no club and an unknown wallet are UNKNOWN to the engine, never zero.
  run("BEGIN;"+seed+f"""UPDATE table_seats SET club_id=NULL;DO $t$ BEGIN
   IF (SELECT count(*) FROM table_seats s JOIN club_members m ON m.club_id=s.club_id AND m.user_id=s.user_id WHERE s.table_id='{T}')<>0
    THEN RAISE EXCEPTION 'a seat with no club produced a balance';END IF;
  END $t$;ROLLBACK;""");count+=1
  print("PASS a seat that names no club yields no row (unknown), which holds the window rather than reporting no funds",flush=True)

  # 7. The engine's late-row test reads the database's own stamp.
  run("BEGIN;"+seed+f"SELECT {rebuy()};"+"""DO $t$ BEGIN
   IF (SELECT count(*) FROM table_pending_addons WHERE resolved_at IS NULL AND created_at IS NOT NULL)<>1
    THEN RAISE EXCEPTION 'the pending row carries no purchase stamp';END IF;
  END $t$;ROLLBACK;""");count+=1
  print("PASS the unresolved rebuy row carries the purchase stamp the window is judged by",flush=True)

  print(f"TOTAL bust rebuy window: {count} PostgreSQL cases passed",flush=True)
 finally:
  os.environ["PGDATABASE"]=original;run("DROP DATABASE bust_rebuy_window_probe")
