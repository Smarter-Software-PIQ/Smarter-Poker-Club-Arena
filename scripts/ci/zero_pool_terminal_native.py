"""Zero ordinary-pool settlement through the retained real terminal authority.

This isolates the two November 5 cash-branch defects. It does not qualify PKO
bounty funding, final-two awards or engine hand continuity.
"""
from pathlib import Path
import hashlib
import json

EVENT='d3000000-0000-4000-8000-000000000002'
WINNER='d1000000-0000-4000-8000-000000000001'
FIRST='20261105203911_a_zero_prize_pool_pko_settles_with_no_place_ladder.sql'
SECOND='20261105215135_a_zero_prize_pko_returns_its_zero_winner_line.sql'
PREFIX="BEGIN;SET LOCAL ROLE service_role;SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true),set_config('request.jwt.claim.role','service_role',true);"
CALL="SELECT public.fn_complete_tournament_terminal('"+EVENT+"','"+WINNER+"','places');"


def opening(root):
    text=(root/'scripts/ci/fixtures/ordinary-terminal-transport/mtt-opening.sql').read_text()
    changes={
      "'Cancellation Entrant Target',100,0,1000":"'Cancellation Entrant Target',0,0,1000",
      "')<>100 THEN RAISE EXCEPTION 'funding mismatch'":"')<>0 THEN RAISE EXCEPTION 'funding mismatch'",
      "AND gross=100 AND refund_fee=0 AND refund_prize=100)<>3":"AND gross>0)<>0",
      "')<>300 THEN RAISE EXCEPTION 'three real entries not funded'":"')<>0 THEN RAISE EXCEPTION 'free entries unexpectedly funded'",
    }
    for before,after in changes.items():
        if text.count(before)!=1:raise AssertionError('zero-pool opening seam changed: '+before)
        text=text.replace(before,after)
    # Registration's zero-charge branch creates roster entries, not fake paid
    # refund entitlements. Open the zero escrow using its actual authority.
    text+=f"\nSELECT public.fn_ca_escrow_apply('{EVENT}','Native zero-entry escrow opening');\n"
    text+=f"""DO $$BEGIN
 IF (SELECT count(*) FROM public.tournament_players WHERE tournament_id='{EVENT}')<>3
 OR EXISTS(SELECT 1 FROM public.tournament_refund_entitlements WHERE tournament_id='{EVENT}')
 OR EXISTS(SELECT 1 FROM public.wallet_transactions WHERE related_entity_id='{EVENT}')
 THEN RAISE EXCEPTION 'zero-charge registration did not preserve its no-payment contract';END IF;END$$;
"""
    return text


def qualify(e,root,template,output):
    paths=[Path(__file__),root/'scripts/ci/fixtures/ordinary-terminal-transport/mtt-opening.sql',
           root/'supabase/migrations'/FIRST,root/'supabase/migrations'/SECOND]
    hashes={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    db=e.database(template)
    def sql(label,text,check=True,database=None):
        return e.sql(database or db,text,label='zero-pool-'+label,check=check)
    script=output/'zero-pool-opening.sql';script.write_text(opening(root))
    e.sql(db,file=script,label='zero-pool-real-free-registration',seconds=90)
    # Whole financial relations, not merely sums that could hide offsetting
    # writes. Terminal status/receipt/zero escrow closure are checked separately.
    money_tables=['clubs','club_members','club_wallets','union_wallets','chip_ledger',
      'wallet_transactions','tournament_payouts','tournament_obligations',
      'tournament_guarantee_overlays','wallet_credit_idempotency']
    def money(database=None):
        terms=[]
        for name in money_tables:
            # The terminal's zero-amount rake path touches the club timestamp;
            # every other field, including its treasury, must stay identical.
            row="to_jsonb(x)-'updated_at'" if name=='clubs' else 'to_jsonb(x)'
            terms.extend(["'"+name+"'","(SELECT coalesce(jsonb_agg("+row+" ORDER BY ("+row+")::text),'[]'::jsonb) FROM public."+name+" x)"])
        _,out,_=sql('money','SELECT jsonb_build_object('+','.join(terms)+');',database=database)
        return json.loads(out.strip())
    before=money()
    def refusal(label,expected,database=None,call=CALL,state='23514'):
        target=database or db
        original=e.snapshot(target,'zero-'+label+'-before')
        code,_,err=sql(label,'\\set VERBOSITY verbose\n'+PREFIX+call+'COMMIT;',False,target)
        if code!=3 or ('ERROR:  '+state+':') not in err or expected not in err:raise AssertionError(label+' did not refuse as expected: '+err)
        if e.snapshot(target,'zero-'+label+'-after')!=original:raise AssertionError(label+' changed state')
    refusal('original-empty-ladder','derived an empty ladder')
    e.sql(db,file=root/'supabase/migrations'/FIRST,label='zero-pool-first-exact-migration')
    refusal('first-fix-partial-result','cash authority returned a partial result',state='P0404')
    e.sql(db,file=root/'supabase/migrations'/SECOND,label='zero-pool-second-exact-migration')

    # An unfinalized pool may legitimately be finalized by the real guarantee
    # authority. Missing required guarantee funding must instead refuse. This
    # intentionally invalid fixture has no funding bank, and never moves money.
    invalid=e.database(db)
    sql('unfunded-opening',f"BEGIN;SET LOCAL session_replication_role=replica;UPDATE public.tournaments SET prize_pool_finalized=false,guaranteed_prize=1,club_id=NULL WHERE id='{EVENT}';COMMIT;",database=invalid)
    refusal('unfunded-unfinalized-pool','atomic_guarantee_funding_aborted',invalid,
      f"SELECT public.fn_settle_tournament_places('{EVENT}','{WINNER}');",state='P0404')
    e.discard(invalid)

    # A genuinely funded positive pool whose bubble reserve consumes its
    # entire ladder must still fail the empty-ladder guard. Only the malformed
    # bubble configuration is synthetic; entries/escrow are the real paid path.
    positive=e.database(template)
    e.sql(positive,file=paths[1],label='zero-pool-positive-real-paid-registration',seconds=90)
    for migration in [FIRST,SECOND]:e.sql(positive,file=root/'supabase/migrations'/migration,label='zero-pool-positive-'+migration[:14])
    sql('positive-empty-opening',f"BEGIN;SET LOCAL session_replication_role=replica;UPDATE public.tournaments SET bubble_protection=true,buy_in_amount=prize_pool WHERE id='{EVENT}';COMMIT;",database=positive)
    refusal('positive-empty-ladder','derived an empty ladder',positive,
      f"SELECT public.fn_settle_tournament_places('{EVENT}','{WINNER}');")
    e.discard(positive)

    original=e.snapshot(db,'zero-green-before')
    sql('green-rollback',PREFIX+CALL+'ROLLBACK;')
    if e.snapshot(db,'zero-green-rollback')!=original:raise AssertionError('successful zero terminal rollback changed state')
    _,out,_=sql('green-commit',PREFIX+CALL+'COMMIT;')
    receipts=[json.loads(line) for line in out.splitlines() if line.startswith('{') and 'receipt_version' in line]
    if len(receipts)!=1:raise AssertionError('zero terminal receipt absent')
    receipt=receipts[0]
    expected=[{'place':1,'user_id':WINNER,'amount':0}]
    if receipt.get('status')!='COMPLETED' or receipt.get('winner_amount')!=0 or receipt.get('payouts')!=expected or receipt.get('cash',{}).get('payouts')!=expected:
        raise AssertionError('zero terminal winner line differs')
    if money()!=before:raise AssertionError('zero terminal moved money or created a monetary obligation')
    sql('terminal-readback',f"""DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id='{EVENT}' AND status='COMPLETED')
 OR (SELECT count(*) FROM public.tournament_terminal_settlements WHERE tournament_id='{EVENT}')<>1
 OR EXISTS(SELECT 1 FROM public.table_seats s JOIN public.tables t ON t.id=s.table_id WHERE t.tournament_id='{EVENT}' AND s.left_at IS NULL)
 OR NOT EXISTS(SELECT 1 FROM public.tournament_escrow WHERE tournament_id='{EVENT}' AND closed_at IS NOT NULL AND prize_balance=0 AND bounty_balance=0 AND fee_balance=0)
 THEN RAISE EXCEPTION 'zero terminal storage or closure differs';END IF;END$$;""")
    settled=e.snapshot(db,'zero-settled')
    _,replayed,_=sql('replay',PREFIX+CALL+'COMMIT;')
    replay=[json.loads(line) for line in replayed.splitlines() if line.startswith('{') and 'receipt_version' in line]
    if replay!=receipts or e.snapshot(db,'zero-replayed')!=settled:raise AssertionError('zero terminal replay changed stored outcome')
    e.report['zero_pool_terminal']={'passed':True,'original_empty_ladder_red':True,
      'first_fix_partial_result_red':True,'exact_second_fix_green':True,'zero_winner_line':expected,
      'no_money_writes':True,'rollback_unchanged':True,'replay_unchanged':True,
      'positive_empty_ladder_refused':True,'unfunded_unfinalized_refused':True,
      'limits':['Actual ordinary cash terminal branch with synthetic final roster/seat topology.',
                'No PKO bounty funding, final-two award, or full current engine continuity claim.',
                'Unfinalized alone is not a refusal: the actual guarantee authority can finalize it.']}
    e.discard(db)
    return hashes
