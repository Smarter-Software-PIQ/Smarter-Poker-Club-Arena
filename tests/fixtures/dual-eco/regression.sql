CREATE FUNCTION assert_eco(ok boolean,label text)RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label;END IF;RAISE NOTICE 'PASS: %',label;END$$;
CREATE FUNCTION refuses_eco(sql text,expected text)RETURNS boolean LANGUAGE plpgsql AS $$BEGIN EXECUTE sql;RETURN false;EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%'||expected||'%' THEN RAISE;END IF;RETURN true;END$$;
SELECT assert_eco(fn_union_week_start('2026-10-26 07:00Z')='2026-10-26 07:00Z'::timestamptz AND fn_union_week_start('2026-11-02 08:00Z')='2026-11-02 08:00Z'::timestamptz,'actual Pacific book boundary preserves 169-hour DST week');
CREATE TEMP TABLE preview_eco AS SELECT fn_union_eco_components('fade0000-0000-0000-0000-000000000001','2026-10-26 07:00Z','2026-11-02 08:00Z')j;
SELECT assert_eco((SELECT j#>>'{clubs,0,eco_amount}'='-7.00'AND j#>>'{clubs,0,eco_components,0,base}'='-80'AND j#>>'{clubs,0,eco_components,0,amount}'='8.00'AND j#>>'{clubs,0,eco_components,1,base}'='150'AND j#>>'{clubs,0,eco_components,1,amount}'='-15.00'AND j#>'{clubs,0,eco_components,0,record_id}'='null'::jsonb FROM preview_eco),'independent cash/tournament signs, earned rake and preview provenance defeat blended 3.00 result');
SELECT assert_eco(refuses_eco($q$SELECT fn_union_eco_record('fade0000-0000-0000-0000-000000000001','2026-10-26 07:00Z','2026-10-30 07:00Z')$q$,'book_boundary')AND refuses_eco($q$SELECT fn_union_eco_record('fade0000-0000-0000-0000-000000000001','2026-10-26 07:00Z','2026-11-09 08:00Z')$q$,'book_boundary'),'partial and extended duplicate book ranges refused');
SELECT assert_eco((SELECT actor_id IS NULL AND observed_at IS NOT NULL AND authority LIKE 'owner_chat_%'FROM smarter_private.union_eco_v2_terms),'migration authority is observed owner chat, never impersonated authenticated union owner');
SELECT fn_union_eco_record('fade0000-0000-0000-0000-000000000001','2026-10-26 07:00Z','2026-11-02 08:00Z');
CREATE TEMP TABLE original_eco_records AS SELECT jsonb_agg(to_jsonb(c)ORDER BY id)j FROM smarter_private.union_eco_components c;
SELECT assert_eco((SELECT count(*)=2 AND sum(amount)=-7 FROM smarter_private.union_eco_components),'exactly two independently recorded activities');
SELECT fn_union_eco_record('fade0000-0000-0000-0000-000000000001','2026-10-26 07:00Z','2026-11-02 08:00Z');
SELECT assert_eco((SELECT jsonb_agg(to_jsonb(c)ORDER BY id)=(SELECT j FROM original_eco_records)FROM smarter_private.union_eco_components c),'duplicate records preserve IDs, timestamps, amounts and basis bytes');
SELECT assert_eco(refuses_eco('UPDATE smarter_private.union_eco_components SET amount=amount','immutable')AND refuses_eco('DELETE FROM smarter_private.union_eco_components','immutable')AND refuses_eco('TRUNCATE smarter_private.union_eco_components','immutable'),'record update/delete/truncate all refused');
SELECT assert_eco(refuses_eco('UPDATE smarter_private.union_eco_v2_terms SET cash_rate=cash_rate','immutable'),'observed commercial terms cannot be rewritten');
SELECT assert_eco((SELECT eco_amount=-7 AND eco_base IS NULL AND eco_rate IS NULL FROM fn_union_eco_adjustment('fade0000-0000-0000-0000-000000000001','2026-10-26 07:00Z','2026-11-02 08:00Z')),'scalar compatibility sums only; no invented blended base or rate');
INSERT INTO ca_settlements VALUES('union_rakeback_close','fade0000-0000-0000-0000-000000000001','final','fade0000-0000-0000-0000-000000000001:2026-10-26T07:00:00Z..2026-11-02T08:00:00Z','{}');
SELECT fn_union_issue_weekly_invoices('fade0000-0000-0000-0000-000000000001','2026-10-26 07:00Z','2026-11-02 08:00Z',false);
SELECT assert_eco((SELECT count(*)=1 AND bool_and(breakdown->'eco_version'='2'::jsonb AND breakdown->'eco_components'=smarter_private.union_eco_invoice_components('fade0000-0000-0000-0000-000000000001',club_id,'2026-10-26 07:00Z','2026-11-02 08:00Z')->'eco_components'AND (breakdown->>'eco_amount')::numeric=-7)FROM settlement_invoices),'actual issuer quotes both immutable component records');
SELECT set_config('test.uid',md5('native owner')::uuid::text,false);
SELECT fn_union_patch_settings('fade0000-0000-0000-0000-000000000001','{"eco_cash_enabled":true,"eco_cash_rate":0.20,"eco_tournament_enabled":true,"eco_tournament_rate":0.05}','Renamed');
SELECT assert_eco((SELECT settings->'unrelated'='42'::jsonb AND name='Renamed'FROM unions),'owner patch preserves unrelated settings');
SELECT assert_eco((SELECT fn_union_eco_settings('fade0000-0000-0000-0000-000000000001')->>'eco_terms_effective_from' IS NOT NULL),'reload obtains authoritative immutable terms effective timestamp');
SELECT assert_eco((SELECT count(*)=2 AND max(effective_from)=fn_union_week_start(fn_union_week_start(clock_timestamp())+interval '8 days')FROM smarter_private.union_eco_v2_terms),'rate edit appends observed terms effective next canonical book');
SELECT assert_eco(refuses_eco($q$SELECT fn_union_patch_settings('fade0000-0000-0000-0000-000000000001','{"eco_cash_rate":1.1}')$q$,'explicit'),'invalid rate rejected atomically');
SELECT set_config('test.uid',md5('stranger')::uuid::text,false);
SELECT assert_eco(refuses_eco($q$SELECT fn_union_patch_settings('fade0000-0000-0000-0000-000000000001','{}')$q$,'owner required'),'unrelated authenticated user cannot change union settings');
SELECT set_config('test.uid','',false);
SELECT assert_eco((SELECT jsonb_agg(to_jsonb(c)ORDER BY id)=(SELECT j FROM original_eco_records)FROM smarter_private.union_eco_components c),'later settings never restate recorded book');

-- Pure arithmetic uses original certified facts as synthetic boundary inputs.
CREATE TEMP TABLE pure_eco AS SELECT jsonb_build_object('club_id',club_id,'cash_player_pnl',cash_pnl,'tournament_player_pnl',tournament_pnl,'rake_earned',cash_earned+tournament_earned)c,
 jsonb_build_array(jsonb_build_object('club_id',club_id,'game_type','cash','payout',cash_earned),jsonb_build_object('club_id',club_id,'game_type','other','payout',tournament_earned))b,
 (SELECT to_jsonb(t)FROM smarter_private.union_eco_v2_terms t ORDER BY observed_at LIMIT 1)t FROM native_eco_facts;
SELECT assert_eco((SELECT (smarter_private.union_eco_calculate(c,b,t)->>'eco_amount')::numeric=-7 FROM pure_eco),'canonical other tournament family retains separate earned rake');
SELECT assert_eco(refuses_eco($q$SELECT smarter_private.union_eco_calculate(c,jsonb_set(b,'{1,game_type}','"arbitrary"'),t)FROM pure_eco$q$,'canonical_rake_activity'),'unknown activity is never charged as tournament');
SELECT assert_eco((SELECT (smarter_private.union_eco_calculate(c,b,t||'{"cash_rate":0.2,"tournament_rate":0.05}'::jsonb)->>'eco_amount')::numeric=8.5 FROM pure_eco),'independent rates govern independently signed bases');
SELECT assert_eco((SELECT (smarter_private.union_eco_calculate(c,b,t||'{"cash_enabled":false}'::jsonb)->>'eco_amount')::numeric=-15 FROM pure_eco),'disabled cash lane does not disable tournament');
SELECT assert_eco((SELECT (smarter_private.union_eco_calculate(c||'{"cash_player_pnl":20,"tournament_player_pnl":50}'::jsonb,b,t)->>'eco_amount')::numeric=0 FROM pure_eco),'genuine zero profit produces two explicit zero components');
SELECT assert_eco((SELECT (smarter_private.union_eco_calculate(c||'{"cash_player_pnl":19.95,"tournament_player_pnl":49.95}'::jsonb,b,t)->>'eco_amount')::numeric=-0.02 FROM pure_eco),'each negative half-cent rounds before aggregate');
SELECT set_config('test.unqualified','yes',false);
SELECT assert_eco(refuses_eco($q$SELECT fn_union_eco_components('fade0000-0000-0000-0000-000000000001','2026-11-02 08:00Z','2026-11-09 08:00Z')$q$,'union_pnl_basis_uncertified'),'new consumer refuses uncertified original financial source');
SELECT set_config('test.unqualified','',false);

SELECT assert_eco(refuses_eco($q$SELECT fn_union_eco_record('fade0000-0000-0000-0000-000000000001',fn_union_week_start(clock_timestamp()),fn_union_week_start(fn_union_week_start(clock_timestamp())+interval '8 days'))$q$,'book_not_closed'),'current live preview cannot prematurely record a book');
SELECT assert_eco((fn_union_eco_components('fade0000-0000-0000-0000-000000000001',fn_union_week_start(clock_timestamp()),fn_union_week_start(fn_union_week_start(clock_timestamp())+interval '8 days'))#>>'{clubs,0,eco_components,0,status}')='preview','current full-week preview uses governing terms without recording');
CREATE TEMP TABLE governance_eco AS SELECT jsonb_build_object('eco_obligations',jsonb_build_array(jsonb_build_object('union_id','fade0000-0000-0000-0000-000000000001','period_start','2026-10-26 07:00Z','period_end','2026-11-02 08:00Z')))m;
SELECT assert_eco(NOT(SELECT fn_ca_governance_eco_proven(m)FROM governance_eco),'original obligation remains open before finalized book');
INSERT INTO union_accounting_runs VALUES('union','fade0000-0000-0000-0000-000000000001','2026-10-26 07:00Z','2026-11-02 08:00Z','complete','{"success":true,"accounting_version":3}');
SELECT assert_eco(NOT(SELECT fn_ca_governance_eco_proven(m)FROM governance_eco),'original obligation remains open before actual invoice delivery');
UPDATE settlement_invoices SET message_sent=true;
SELECT assert_eco((SELECT fn_ca_governance_eco_proven(m)FROM governance_eco),'original governance accepts finalized book and exact delivered immutable activity records');
\ir governance-regression.sql
SELECT assert_eco((SELECT b#>'{totals,eco_components_complete}'='true'::jsonb AND(b#>>'{totals,cash_eco_amount}')::numeric=8 AND(b#>>'{totals,tournament_eco_amount}')::numeric=-15 FROM(SELECT ca_union_statement_board('fade0000-0000-0000-0000-000000000001','2026-11-02',8)b)x),'actual invoice to board preserves separate immutable activity totals');
UPDATE settlement_invoices SET breakdown=jsonb_set(breakdown,'{eco_components,0,record_id}',to_jsonb(md5('wrong record')::uuid));
SELECT assert_eco(NOT(SELECT fn_ca_governance_eco_proven(m)FROM governance_eco),'wrong invoice component identity cannot close original obligation');

INSERT INTO smarter_private.union_eco_v2_terms(union_id,effective_from,cash_enabled,cash_rate,tournament_enabled,tournament_rate,authority)
VALUES('fade0000-0000-0000-0000-000000000001','2026-11-02 08:00Z',false,.1,false,.1,'synthetic_disabled_book');
INSERT INTO ca_settlements VALUES('union_rakeback_close','fade0000-0000-0000-0000-000000000001','final','fade0000-0000-0000-0000-000000000001:2026-11-02T08:00:00Z..2026-11-09T08:00:00Z','{}');
SELECT assert_eco(refuses_eco($q$SELECT fn_union_issue_weekly_invoices('fade0000-0000-0000-0000-000000000001','2026-11-02 08:00Z','2026-11-09 08:00Z',false)$q$,'activity_records_required'),'disabled v2 preview cannot issue without immutable pair');
SELECT fn_union_eco_record('fade0000-0000-0000-0000-000000000001','2026-11-02 08:00Z','2026-11-09 08:00Z');
SELECT fn_union_issue_weekly_invoices('fade0000-0000-0000-0000-000000000001','2026-11-02 08:00Z','2026-11-09 08:00Z',false);
SELECT assert_eco((SELECT count(*)=2 AND bool_and(NOT enabled AND amount=0)FROM smarter_private.union_eco_components WHERE period_start='2026-11-02 08:00Z'),'disabled v2 records two genuine zeros before invoice issuance');

-- A genuine older scalar book remains authoritative even under the amendment.
INSERT INTO unions VALUES('fade0000-0000-0000-0000-000000000002',md5('native owner')::uuid,'Legacy Union','Preserve','{"eco_enabled":true,"eco_rate":0.1,"eco_base_mode":"club_cash_profit","eco_include_horses":true}');
INSERT INTO union_clubs SELECT 'fade0000-0000-0000-0000-000000000002',id FROM clubs;
INSERT INTO smarter_private.union_eco_v2_terms(union_id,effective_from,cash_enabled,cash_rate,tournament_enabled,tournament_rate,authority)
VALUES('fade0000-0000-0000-0000-000000000002','2026-10-26 07:00Z',true,.1,true,.1,'synthetic_forward_amendment');
INSERT INTO union_eco_ledger(union_id,club_id,period_start,period_end,eco_base,eco_rate,eco_amount,eco_base_mode,cash_players_won,total_rake_generated,rake_earned,include_horses)
SELECT 'fade0000-0000-0000-0000-000000000002',club_id,'2026-11-02 08:00Z','2026-11-09 08:00Z',-30,.1,3,'club_cash_profit',100,70,70,true FROM native_eco_facts;
CREATE TEMP TABLE legacy_eco_bytes AS SELECT to_jsonb(l)j FROM union_eco_ledger l;
INSERT INTO ca_settlements VALUES('union_rakeback_close','fade0000-0000-0000-0000-000000000002','final','fade0000-0000-0000-0000-000000000002:2026-11-02T08:00:00Z..2026-11-09T08:00:00Z','{}');
SELECT fn_union_issue_weekly_invoices('fade0000-0000-0000-0000-000000000002','2026-11-02 08:00Z','2026-11-09 08:00Z',false);
SELECT assert_eco((SELECT count(*)=1 AND bool_and(breakdown->'eco_components'='null'::jsonb AND(breakdown->>'eco_amount')::numeric=3)FROM settlement_invoices WHERE breakdown->>'union_id'='fade0000-0000-0000-0000-000000000002'),'actual issuer preserves authoritative older scalar under later v2 terms');
SELECT assert_eco((SELECT to_jsonb(l)=(SELECT j FROM legacy_eco_bytes)FROM union_eco_ledger l)AND NOT EXISTS(SELECT FROM smarter_private.union_eco_components WHERE union_id='fade0000-0000-0000-0000-000000000002'),'legacy issuer creates no component fiction and leaves scalar record byte-exact');
-- Existing scalar-only callers read launch-clamped and current partial ranges.
INSERT INTO unions VALUES('fade0000-0000-0000-0000-000000000003',md5('native owner')::uuid,'Legacy Preview','Preserve','{"eco_enabled":true,"eco_rate":0.1,"eco_base_mode":"club_cash_profit","eco_include_horses":true}');
INSERT INTO union_clubs SELECT 'fade0000-0000-0000-0000-000000000003',id FROM clubs;
SELECT assert_eco((SELECT count(*)=1 AND bool_and(period_start='2026-10-28 12:00Z'::timestamptz AND period_end='2026-10-30 12:00Z'::timestamptz AND eco_amount=3)FROM fn_union_club_invoice('fade0000-0000-0000-0000-000000000003','2026-10-28 12:00Z','2026-10-30 12:00Z')),'actual legacy invoice reader preserves noncanonical finite accounting range');
-- Preserve the original nested invoice disclosure, not new writer authority.
INSERT INTO club_members SELECT id,md5('native club staff')::uuid,'super_agent'FROM clubs;
SELECT set_config('test.uid',md5('native club staff')::uuid::text,false);
SELECT set_config('test.denied','yes',false);
SELECT assert_eco((SELECT count(*)=1 FROM fn_union_club_invoice('fade0000-0000-0000-0000-000000000001','2026-10-26 07:00Z','2026-11-02 08:00Z')),'actual nested v2 invoice preserves existing union club-staff disclosure');
SELECT assert_eco(fn_union_eco_record('fade0000-0000-0000-0000-000000000001','2026-10-26 07:00Z','2026-11-02 08:00Z')->'success'='false'::jsonb,'club disclosure does not grant ECO recording authority');
SELECT set_config('test.uid',md5('foreign staff')::uuid::text,false);
SELECT assert_eco(refuses_eco($q$SELECT * FROM fn_union_club_invoice('fade0000-0000-0000-0000-000000000001','2026-10-26 07:00Z','2026-11-02 08:00Z')$q$,'not authorized'),'actual nested v2 invoice refuses unrelated authenticated reader');
SELECT set_config('test.uid','',false);
SELECT set_config('test.denied','',false);
