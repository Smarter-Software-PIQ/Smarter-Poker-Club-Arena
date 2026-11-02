#!/usr/bin/env python3
"""Exact migration and cancellation in the retained native financial catalog.
Only opening registrations/identities are synthetic. No production URL accepted.
"""
from pathlib import Path
import json, os, tempfile, time
from satellite_qualifier_fixture import module
from tournament_abort_fixture import install_financial_foundation
R=Path(__file__).resolve().parents[2]
F=R/'scripts/ci/fixtures/midway-free-buy-pko'
M=R/'supabase/migrations/20261102154336_midway_promo_funded_bounty_only_free_buys.sql'
O=Path(tempfile.mkdtemp(prefix='mp-evidence-',dir=os.environ.get('TMPDIR')))
E=module(R/'scripts/ci/test-mtt-unlimited.py','midway_full').Execution(
 R,O,Path(os.environ.get('PG_BIN','/opt/homebrew/opt/postgresql@17/bin')),
 Path(os.environ.get('TMPDIR',tempfile.gettempdir())),600,
 socket_parent=Path(os.environ.get('CA_PG_SOCKET_ROOT',os.environ.get('TMPDIR',tempfile.gettempdir()))))
try:
 E.start();d=E.database();install_financial_foundation(E,d,R,O)
 E.sql(d,'ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS payout_depth_percent numeric;',label='current-payout-column')
 sql='SET check_function_bodies=off;'+''.join(json.loads((F/'conversion-preimages.json').read_text()).values())
 E.sql(d,sql,label='inspected-current-preimages')
 E.sql(d,'CREATE TABLE public.tournament_schedules(id uuid,club_id uuid,config jsonb);',label='schedule-column-shapes')
 E.sql(d,"INSERT INTO ca_chip_store_coverage(store,treatment,counted_by,notes) VALUES('union_wallet','counted','union_wallets','the union rake, bbj, promo, insurance and spin reserve wallets') ON CONFLICT DO NOTHING;",label='captured-promo-store-seed')
 E.sql(d,file=F/'full-opening.sql',label='synthetic-opening')
 began=time.monotonic();E.sql(d,file=M,label='exact-candidate-install',seconds=60)
 E.report['install_seconds']=time.monotonic()-began
 assert E.report['install_seconds']<8
 E.sql(d,"""DO $$BEGIN
 IF (SELECT promo_wallet FROM union_wallets WHERE union_id='fade0000-0000-0000-0000-000000000001')<>588
 OR (SELECT bounty_balance FROM tournament_escrow WHERE tournament_id='10000000-0000-0000-0000-000000000001')<>412
 OR (SELECT sum(current_bounty) FROM tournament_players WHERE tournament_id='10000000-0000-0000-0000-000000000001')<>412 THEN
 RAISE EXCEPTION 'Full conversion custody disagrees'; END IF; END $$;""",label='converted-custody')
 before=E.snapshot(d,label='before-cancellation')
 E.sql(d,"""BEGIN;
 SET LOCAL request.jwt.claims='{"role":"service_role"}';
 DO $$DECLARE result jsonb; again jsonb; BEGIN
 result:=atomic_cancel_tournament('10000000-0000-0000-0000-000000000001',NULL);
 again:=atomic_cancel_tournament('10000000-0000-0000-0000-000000000001',NULL);
 IF result->>'fully_settled'<>'true' OR result->>'total_refunded'<>'0' OR result IS DISTINCT FROM again
 OR (SELECT promo_wallet FROM union_wallets WHERE union_id='fade0000-0000-0000-0000-000000000001')<>1000
 OR (SELECT bounty_balance FROM tournament_escrow WHERE tournament_id='10000000-0000-0000-0000-000000000001')<>0
 OR (SELECT count(*) FROM chip_ledger WHERE tournament_id='10000000-0000-0000-0000-000000000001' AND metadata->>'kind'='midway_free_buy_promo_head')<>824 THEN
 RAISE EXCEPTION 'Cancellation did not return exactly the sponsored chips'; END IF;
 END $$;
 SET CONSTRAINTS ALL IMMEDIATE;
 ROLLBACK;""",label='actual-promo-cancellation')
 assert E.snapshot(d,label='after-cancellation')==before
 E.report['passed']=True
 E.report['cases']=['exact migration installs','412 funded conversions','actual cancellation returns only sponsor funds','same receipt replay','full rollback']
finally:
 E.close();(O/'report.json').write_text(json.dumps(E.report,indent=2)+'\n')
print('Midway full native evidence: '+str(O/'report.json'))
