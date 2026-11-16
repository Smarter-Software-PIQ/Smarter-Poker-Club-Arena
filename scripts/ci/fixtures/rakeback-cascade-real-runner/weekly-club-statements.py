exec((F/'weekly-club-statement-preimages.py').read_text())
q("ALTER TABLE ca_club_acct_fact ADD COLUMN IF NOT EXISTS union_id uuid;ALTER TABLE ca_club_acct_fact_journal ADD COLUMN IF NOT EXISTS union_id uuid;UPDATE ca_club_acct_fact SET union_id=rr.u('U') WHERE club_id=rr.u('T');UPDATE ca_club_acct_fact_journal SET union_id=rr.u('U') WHERE club_id=rr.u('T')")
q(next(migrations.glob('20261116205120_*.sql')).read_text())
assert one("""SELECT count(*)>=0 FROM smarter_private.weekly_payout_eligible_scopes(rr.ws(),rr.we())""")=='t'
clock('2026-11-14 18:00:00Z')
q("SELECT rr.club('quiet');")
clock('2026-11-16 18:05:00Z')
q("SELECT rr.club('joined_late');")
q("DELETE FROM union_clubs WHERE club_id=rr.u('quiet');")
before=one("SELECT count(*) FROM chip_ledger")
call="SELECT smarter_private.weekly_club_rakeback_statements(rr.u('U'),rr.we())"
assert json.loads(one(call.replace("rr.we()","rr.we()+interval '7 days'")))['stage']=='awaiting_payout_release'
from concurrent.futures import ThreadPoolExecutor
with ThreadPoolExecutor(max_workers=3) as pool:
    receipts=[json.loads(value) for value in pool.map(one,[call,call,call])]
assert all(result['success'] and result['clubs']==4 for result in receipts),receipts
assert sorted(result['newly_delivered'] for result in receipts)==[0,0,4],receipts
assert one("SELECT count(*) FROM chip_ledger")==before
assert one("SELECT count(*) FROM smarter_private.weekly_club_rakeback_documents WHERE club_id=rr.u('joined_late')")=='0'
assert one("""SELECT count(*)=1 AND bool_and(d.rakeback=0 AND d.fees=0 AND NOT i.chips_transferred AND i.source_ledger_id IS NULL)
 FROM smarter_private.weekly_club_rakeback_documents d JOIN settlement_invoices i ON i.id=d.invoice_id WHERE d.club_id=rr.u('quiet')""")=='t'
assert one("""SELECT bool_and(i.chips_transferred AND l.amount=d.rakeback AND i.invoice_number IS NOT NULL)
 FROM smarter_private.weekly_club_rakeback_documents d JOIN settlement_invoices i ON i.id=d.invoice_id
 JOIN chip_ledger l ON l.id=i.source_ledger_id WHERE d.rakeback>0""")=='t'
assert one("""SELECT bool_and(position('Certified fees:' in m.content)>0 AND position('Union share:' in m.content)>0 AND
   (d.club_id<>rr.u('T') OR position('Club Data player W/L (posted, closing balance pending): 8.75' in m.content)>0))
 FROM smarter_private.weekly_club_rakeback_documents d JOIN accounting_invoice_deliveries h ON h.invoice_id=d.invoice_id
 JOIN social_messages m ON m.id=h.message_id""")=='t'
assert one("""SET request.jwt.claim.role='service_role';
 SELECT bool_and(EXISTS(SELECT FROM public.fn_get_user_conversations(a.recipient_id,p.context_entity_id) x
 WHERE x.conversation_id=m.conversation_id)) FROM smarter_private.weekly_club_rakeback_documents d
 JOIN accounting_invoice_deliveries a ON a.invoice_id=d.invoice_id
 JOIN social_messages m ON m.id=a.message_id JOIN social_conversation_participants p
 ON p.conversation_id=m.conversation_id AND p.user_id=a.recipient_id""")=='t'
count_before=one("SELECT count(*) FROM accounting_invoice_deliveries")
assert json.loads(one(call))['newly_delivered']==0
assert one("SELECT count(*) FROM accounting_invoice_deliveries")==count_before
assert one("""SELECT NOT has_function_privilege('authenticated',
 'smarter_private.weekly_club_rakeback_statements(uuid,timestamptz)','EXECUTE')""")=='t'
case('clubs receive original paid fee statements, including cutoff membership and a zero club; recorded poker W/L is identified, actual audience and original ledgers survive retries')

# When the separate ECO book does finish, its one original billing identity
# remains. A square history row stays unsent; a genuine debt reaches Messenger.
def later_square(club, amount):
    q(f"""
      INSERT INTO settlement_periods(club_id,union_id,period_number,year,start_at,end_at,status)
      VALUES(rr.u('{club}'),rr.u('U'),46,2026,rr.ws(),rr.we(),'processing')
      ON CONFLICT(club_id,union_id,start_at,end_at) DO NOTHING;
      INSERT INTO settlement_invoices(id,club_id,period_id,invoice_type,invoice_number,from_entity_type,
        from_entity_id,to_entity_type,to_entity_id,gross_amount,net_amount,breakdown,status,chips_transferred)
      SELECT rr.u('{club}-square'),club_id,id,'union_weekly_squareup','BALANCE-{club}','union',union_id::text,
        'club',club_id::text,{amount},{amount},jsonb_build_object('union_id',union_id,'club_id',club_id,
        'union_name','Union U','club_name','Club {club}','period_start',rr.ws(),'period_end',rr.we(),
        'rake_generated',d.fees,'rakeback_due',d.rakeback,'outstanding',{amount},'eco_amount',{amount},
        'presettled',0,'direction',CASE WHEN {amount}=0 THEN 'square' ELSE 'union owes club' END),'generated',false
      FROM (SELECT sp.* FROM settlement_periods sp WHERE sp.club_id=rr.u('{club}') AND sp.union_id=rr.u('U')
        AND sp.start_at=rr.ws() AND sp.end_at=rr.we()) p
      CROSS JOIN LATERAL(SELECT doc.fees,doc.rakeback FROM smarter_private.weekly_club_rakeback_documents doc
        WHERE doc.club_id=p.club_id AND doc.union_id=p.union_id AND doc.period_end=p.end_at) d;
    """)
later_square('quiet',0)
assert one("""SELECT NOT coalesce(i.message_sent,false) AND smarter_private.weekly_zero_balance_document(i)
 AND NOT EXISTS(SELECT FROM accounting_invoice_deliveries h WHERE h.invoice_id=i.id)
 FROM settlement_invoices i WHERE i.id=rr.u('quiet-square')""")=='t'
later_square('T',7)
assert one("""SELECT count(*)=2 AND bool_and(position('ECO: 7.00' in m.content)>0 AND position('7.00 Chips' in m.content)>0
 AND position('Rakeback Paid To The Club' in m.content)=0)
 FROM accounting_invoice_deliveries d JOIN social_messages m ON m.id=d.message_id WHERE d.invoice_id=rr.u('T-square')""")=='t'
assert json.loads(one("SELECT public.fn_deliver_accounting_invoice(rr.u('T-square'))"))['new_deliveries']==0
# Historical combined statements are reused only with their exact week and
# actual parties. Missing or extra original audience cannot certify delivery.
q("DELETE FROM smarter_private.weekly_club_rakeback_documents WHERE club_id=rr.u('T')")
assert json.loads(one(call))['newly_delivered']==0
assert one("SELECT invoice_id=rr.u('T-square') FROM smarter_private.weekly_club_rakeback_documents WHERE club_id=rr.u('T')")=='t'
q("DELETE FROM smarter_private.weekly_club_rakeback_documents WHERE club_id=rr.u('T');SELECT rr.person('new_bill_admin');INSERT INTO club_members(club_id,user_id,role,status) VALUES(rr.u('T'),rr.u('new_bill_admin'),'admin','active');")
refused=q(call,check=False)
assert refused.returncode!=0 and 'weekly_club_rakeback_delivery_incomplete' in refused.stderr,refused.stderr
assert one("SELECT count(*) FROM chip_ledger")==before
case('zero ECO creates only its original unsent history; a real nonzero ECO bills once and a historical combined document requires the exact audience')
